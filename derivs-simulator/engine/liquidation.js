const { Decimal } = require('decimal.js');

class LiquidationEngine {
  constructor(matchingEngine = null, orderBook = null, marginCalculator = null, adlEngine = null) {
    this.liquidationFeeRate = new Decimal(0.005); // 0.5% liquidation fee
    this.insuranceFund = new Decimal(1000000); // $1M insurance fund
    this.matchingEngine = matchingEngine;
    this.orderBook = orderBook;
    this.marginCalculator = marginCalculator;
    this.adlEngine = adlEngine;
    this.liquidationQueue = [];
    this.isProcessingQueue = false;
    
    // Insurance fund history tracking
    this.insuranceFundHistory = [{
      timestamp: Date.now(),
      type: 'initialization',
      amount: new Decimal(0),
      balance: this.insuranceFund,
      description: 'Initial insurance fund balance'
    }];
    this.liquidationHistory = [];
  }

  manualAdjustment(amount, description) {
    const decAmount = new Decimal(amount);
    const type = decAmount.isPositive() ? 'deposit' : 'withdrawal';
    this.insuranceFund = this.insuranceFund.plus(decAmount);

    this.recordInsuranceFundChange({
      type: `manual_${type}`,
      amount: decAmount,
      balance: this.insuranceFund,
      description: description || 'Manual fund adjustment'
    });
    
    console.log(`Manual insurance fund adjustment: ${type} of $${decAmount.abs()}. New balance: $${this.insuranceFund}`);
    return { success: true, newBalance: this.insuranceFund.toString() };
  }

  // Set references to matching engine and order book (for dependency injection)
  setReferences(matchingEngine, orderBook, marginCalculator, adlEngine) {
    this.matchingEngine = matchingEngine;
    this.orderBook = orderBook;
    this.marginCalculator = marginCalculator;
    this.adlEngine = adlEngine;
  }

  shouldLiquidate(position, currentPrice) {
    // Use MarginCalculator for consistent logic
    if (this.marginCalculator) {
      return this.marginCalculator.shouldLiquidate(position, currentPrice);
    }
    
    // Fallback calculation if marginCalculator not available
    const liquidationPrice = this.calculateLiquidationPrice(position);
    
    if (position.side === 'long') {
      return currentPrice <= liquidationPrice;
    } else {
      return currentPrice >= liquidationPrice;
    }
  }

  // DEPRECATED: Use MarginCalculator.calculateLiquidationPrice instead
  calculateLiquidationPrice(position) {
    if (this.marginCalculator) {
      return this.marginCalculator.calculateLiquidationPrice(position);
    }
    
    // Fallback calculation - should be removed once marginCalculator is always available
    const { avgEntryPrice, leverage, side } = position;
    const mmr = 0.005; // 0.5% maintenance margin rate

    if (side === 'long') {
      return avgEntryPrice * (1 - 1/leverage + mmr);
    } else {
      return avgEntryPrice * (1 + 1/leverage - mmr);
    }
  }

  // NEW: Real liquidation with market order execution
  async liquidate(position, currentPrice, allPositions, forceMode = false) {
    const decCurrentPrice = new Decimal(currentPrice);
    const liquidationFee = position.size.times(decCurrentPrice).times(this.liquidationFeeRate);
    const bankruptcyPrice = this.calculateBankruptcyPrice(position);
    
    let preLiquidationLoss;
    if (position.side === 'long') {
      preLiquidationLoss = Decimal.max(0, position.avgEntryPrice.minus(decCurrentPrice).times(position.size));
    } else {
      preLiquidationLoss = Decimal.max(0, decCurrentPrice.minus(position.avgEntryPrice).times(position.size));
    }

    let liquidationResult = {
      positionId: position.userId,
      userId: position.userId,
      side: position.side,
      size: position.size,
      entryPrice: position.avgEntryPrice,
      initialMargin: position.initialMargin,
      bankruptcyPrice,
      preLiquidationLoss,
      liquidationFee,
      timestamp: Date.now(),
      method: 'unknown',
      executionPrice: decCurrentPrice,
      slippage: new Decimal(0),
      fills: [],
      totalExecuted: new Decimal(0),
      remainingBalance: new Decimal(0),
      insuranceFundLoss: new Decimal(0)
    };

    try {
      if (this.matchingEngine && this.orderBook && !forceMode) {
        liquidationResult = await this.executeRealLiquidation(position, liquidationResult);
      } else {
        liquidationResult = this.executeFallbackLiquidation(position, decCurrentPrice, liquidationResult);
      }

      this.updateInsuranceFund(liquidationResult, allPositions);

      return liquidationResult;

    } catch (error) {
      console.error(`Liquidation failed for ${position.userId}:`, error);
      return this.executeFallbackLiquidation(position, decCurrentPrice, liquidationResult);
    }
  }

  async executeRealLiquidation(position, liquidationResult) {
    const liquidationSide = position.side === 'long' ? 'sell' : 'buy';
    
    const liquidationOrder = {
      id: `liq_${Date.now()}_${position.userId}`,
      userId: 'liquidation_engine', // Special liquidation user
      side: liquidationSide,
      originalSize: position.size,
      remainingSize: position.size,
      filledSize: 0,
      price: null, // Market order
      avgFillPrice: 0,
      type: 'market',
      leverage: 1,
      timestamp: Date.now(),
      lastUpdateTime: Date.now(),
      status: 'NEW',
      timeInForce: 'IOC', // Immediate or Cancel
      fills: [],
      totalValue: 0,
      commission: 0,
      marginReserved: 0,
      isLiquidation: true // Special flag
    };

    const matches = this.matchingEngine.match(liquidationOrder);
    
    const totalExecuted = new Decimal(liquidationOrder.filledSize || 0);
    liquidationResult.fills = liquidationOrder.fills || [];
    liquidationResult.totalExecuted = totalExecuted;
    
    if (totalExecuted.isZero()) {
      console.log(`No market liquidity for liquidation - falling back to insurance fund execution at mark price`);
      return this.executeFallbackLiquidation(position, liquidationResult.executionPrice, liquidationResult);
    }
    
    const avgExecutionPrice = new Decimal(liquidationOrder.avgFillPrice || liquidationResult.executionPrice);
    liquidationResult.method = 'market_order';
    liquidationResult.executionPrice = avgExecutionPrice;
    liquidationResult.slippage = avgExecutionPrice.minus(liquidationResult.executionPrice).abs().dividedBy(liquidationResult.executionPrice);

    const executedValue = totalExecuted.times(avgExecutionPrice);
    const liquidationFeeActual = executedValue.times(this.liquidationFeeRate);
    
    let totalLoss;
    if (position.side === 'long') {
      totalLoss = position.avgEntryPrice.minus(avgExecutionPrice).times(totalExecuted);
    } else {
      totalLoss = avgExecutionPrice.minus(position.avgEntryPrice).times(totalExecuted);
    }
    liquidationResult.remainingBalance = Decimal.max(0, position.initialMargin.minus(totalLoss).minus(liquidationFeeActual));

    return liquidationResult;
  }

  executeFallbackLiquidation(position, currentPrice, liquidationResult) {
    const decCurrentPrice = new Decimal(currentPrice);
    const positionValue = position.size.times(decCurrentPrice);
    const liquidationFee = positionValue.times(this.liquidationFeeRate);
    
    let totalLoss;
    if (position.side === 'long') {
      totalLoss = Decimal.max(0, position.avgEntryPrice.minus(decCurrentPrice).times(position.size));
    } else {
      totalLoss = Decimal.max(0, decCurrentPrice.minus(position.avgEntryPrice).times(position.size));
    }
    
    liquidationResult.method = 'mark_price';
    liquidationResult.totalExecuted = position.size;
    liquidationResult.remainingBalance = Decimal.max(0, position.initialMargin.minus(totalLoss).minus(liquidationFee));
    liquidationResult.liquidationFee = liquidationFee;

    return liquidationResult;
  }

  updateInsuranceFund(liquidationResult, allPositions) {
    const { remainingBalance, liquidationFee, totalExecuted, executionPrice, side, entryPrice, initialMargin, userId, bankruptcyPrice } = liquidationResult;
    
    console.log(`Updating insurance fund - Liquidation fee: $${liquidationFee.toFixed(2)}, totalExecuted: ${totalExecuted}, remainingBalance: $${remainingBalance.toFixed(2)}`);
    
    this.insuranceFund = this.insuranceFund.plus(liquidationFee);
    
    this.recordInsuranceFundChange({
      type: 'liquidation_fee',
      amount: liquidationFee,
      balance: this.insuranceFund,
      description: `Liquidation fee from ${userId}`
    });
    
    console.log(`Insurance fund gains fee: $${liquidationFee.toFixed(2)}, new balance: $${this.insuranceFund.toString()}`);
    
    if (remainingBalance.isZero()) {
      const bankruptPosition = { side, avgEntryPrice: bankruptcyPrice };
      let actualLoss;
      if (side === 'long') {
        actualLoss = Decimal.max(0, new Decimal(entryPrice).minus(executionPrice).times(totalExecuted));
      } else {
        actualLoss = Decimal.max(0, new Decimal(executionPrice).minus(entryPrice).times(totalExecuted));
      }
      
      console.log(`User balance is zero - actualLoss: $${actualLoss.toFixed(2)}, initialMargin: $${(initialMargin || 0).toFixed(2)}`);
      
      const decInitialMargin = new Decimal(initialMargin || 0);
      if (actualLoss.greaterThan(decInitialMargin)) {
        const shortfall = actualLoss.minus(decInitialMargin);
        
        if (this.insuranceFund.gte(shortfall)) {
          // Insurance fund can cover the entire loss
          this.insuranceFund = this.insuranceFund.minus(shortfall);
          liquidationResult.insuranceFundLoss = shortfall;
          
          this.recordInsuranceFundChange({
            type: 'bankruptcy_payout',
            amount: shortfall.negated(),
            balance: this.insuranceFund,
            description: `Bankruptcy coverage for ${userId}. Shortfall: $${shortfall.toFixed(2)}`
          });
          
        } else {
          // Insurance fund is insufficient, trigger ADL
          const insurancePayout = this.insuranceFund;
          const adlAmount = shortfall.minus(insurancePayout);
          
          this.insuranceFund = new Decimal(0);
          liquidationResult.insuranceFundLoss = insurancePayout;
          
          this.recordInsuranceFundChange({
            type: 'bankruptcy_payout_drained',
            amount: insurancePayout.negated(),
            balance: this.insuranceFund,
            description: `Insurance fund drained for ${userId}. Payout: $${insurancePayout.toFixed(2)}, ADL required for $${adlAmount.toFixed(2)}`
          });
          
          if (this.adlEngine) {
            console.log(`ADL triggered for shortfall of $${adlAmount.toFixed(2)}`);
            const adlResult = this.adlEngine.executeADL(allPositions, adlAmount, bankruptPosition);
            liquidationResult.adlResult = adlResult;
          } else {
            console.error("ADL Engine not available! System is at risk.");
            // In a real system, this would be a critical alert
          }
        }
      }
    }
    
    this.recordLiquidationEvent(liquidationResult);
  }

  // Record insurance fund balance changes
  recordInsuranceFundChange(change) {
    this.insuranceFundHistory.push({
      timestamp: Date.now(),
      ...change
    });
  }

  // Record detailed liquidation events
  recordLiquidationEvent(liquidationResult) {
    // Sanitize for JSON conversion if Decimal objects are used
    const sanitizedResult = { ...liquidationResult };
    for (const key in sanitizedResult) {
      if (sanitizedResult[key] instanceof Decimal) {
        sanitizedResult[key] = sanitizedResult[key].toString();
      }
    }
    this.liquidationHistory.push(sanitizedResult);
  }

  calculateBankruptcyPrice(position) {
    if (this.marginCalculator) {
      return this.marginCalculator.calculateBankruptcyPrice(position);
    }
    // Fallback
    const { side } = position;
    const avgEntryPrice = new Decimal(position.avgEntryPrice);
    const leverage = new Decimal(position.leverage);
    if (side === 'long') {
      return avgEntryPrice.times(new Decimal(1).minus(new Decimal(1).div(leverage)));
    } else {
      return avgEntryPrice.times(new Decimal(1).plus(new Decimal(1).div(leverage)));
    }
  }

  // NEW: Queue-based liquidation processing
  addToLiquidationQueue(position, priority = 'normal') {
    const exists = this.liquidationQueue.some(item => item.position.userId === position.userId);
    if (!exists) {
      this.liquidationQueue.push({ position, priority, timestamp: Date.now() });
      if (priority === 'high') {
        this.liquidationQueue.sort((a, b) => (b.priority === 'high') - (a.priority === 'high'));
      }
      console.log(`Added position for ${position.userId} to liquidation queue.`);
    }
  }

  // NEW: Process liquidation queue
  async processLiquidationQueue() {
    if (this.isProcessingQueue || this.liquidationQueue.length === 0) {
      return;
    }
    this.isProcessingQueue = true;
    console.log(`Processing liquidation queue with ${this.liquidationQueue.length} items.`);

    const item = this.liquidationQueue.shift();
    if (item) {
      try {
        const currentPrice = this.getCurrentMarkPrice();
        if (this.shouldLiquidate(item.position, currentPrice)) {
          console.log(`Executing liquidation from queue for ${item.position.userId}`);
          await this.liquidate(item.position, currentPrice);
        } else {
          console.log(`Position for ${item.position.userId} no longer requires liquidation.`);
        }
      } catch (error) {
        console.error(`Error processing liquidation queue for ${item.position.userId}:`, error);
        // Re-queue on failure
        this.liquidationQueue.unshift(item);
      }
    }

    this.isProcessingQueue = false;
    // Process next item
    if (this.liquidationQueue.length > 0) {
      this.processLiquidationQueue();
    }
  }

  // NEW: Partial liquidation support
  partialLiquidate(position, currentPrice, reductionPercentage = 0.5) {
    if (reductionPercentage <= 0 || reductionPercentage > 1) {
      throw new Error('Invalid reduction percentage');
    }

    const originalSize = position.size;
    const liquidationSize = originalSize * reductionPercentage;
    const remainingSize = originalSize - liquidationSize;
    
    // Create partial position for liquidation
    const partialPosition = {
      ...position,
      size: liquidationSize,
      initialMargin: position.initialMargin * reductionPercentage
    };
    
    const liquidation = this.liquidate(partialPosition, currentPrice, [], true); // Force mode for partials
    
    // Update the original position
    position.size = remainingSize;
    position.initialMargin *= (1 - reductionPercentage);
    
    return {
      ...liquidation,
      type: 'partial',
      originalSize,
      liquidationSize,
      remainingSize,
      reductionPercentage
    };
  }

  getInsuranceFundBalance() {
    return this.insuranceFund.toString();
  }

  // Check if system is at risk (insurance fund low)
  isSystemAtRisk() {
    return this.insuranceFund.lessThan(100000); // $100k threshold
  }

  // NEW: Get current mark price (helper for queue processing)
  getCurrentMarkPrice() {
    // In a real system, this would come from an oracle or the exchange's mark price module
    return this.matchingEngine ? (this.matchingEngine.exchange.markPrice || 0) : 0;
  }

  // NEW: Get liquidation queue status
  getQueueStatus() {
    return {
      isProcessing: this.isProcessingQueue,
      queueSize: this.liquidationQueue.length,
      queue: this.liquidationQueue.map(item => ({
        userId: item.position.userId,
        priority: item.priority,
        timestamp: item.timestamp
      }))
    };
  }

  // Get insurance fund history
  getInsuranceFundHistory() {
    return {
      currentBalance: this.insuranceFund.toString(),
      history: this.insuranceFundHistory.map(item => ({
        ...item,
        amount: item.amount.toString(),
        balance: item.balance.toString()
      })).slice().reverse(),
      liquidations: this.liquidationHistory.map(liq => {
        const sanitized = {};
        for(const key in liq) {
            sanitized[key] = (liq[key] instanceof Decimal) ? liq[key].toString() : liq[key];
        }
        return sanitized;
      }).slice().reverse(),
    };
  }

  // Get insurance fund performance summary
  getInsuranceFundSummary() {
    const initialBalance = new Decimal(1000000);
    const totalDeposits = this.insuranceFundHistory
      .filter(h => h.type === 'manual_deposit')
      .reduce((sum, h) => sum.plus(h.amount), new Decimal(0));
    
    const totalWithdrawals = this.insuranceFundHistory
      .filter(h => h.type === 'manual_withdrawal')
      .reduce((sum, h) => sum.plus(h.amount.abs()), new Decimal(0));

    const totalFees = this.insuranceFundHistory
      .filter(h => h.type === 'liquidation_fee')
      .reduce((sum, h) => sum.plus(h.amount), new Decimal(0));

    const totalPayouts = this.insuranceFundHistory
      .filter(h => h.type === 'bankruptcy_payout')
      .reduce((sum, h) => sum.plus(h.amount.abs()), new Decimal(0));

    const sideBreakdown = this.liquidationHistory.reduce((acc, liq) => {
      acc[liq.side] = (acc[liq.side] || 0) + liq.size;
      return acc;
    }, {});

    const totalGrowth = this.insuranceFund.minus(initialBalance);
    const growthPercentage = initialBalance.isZero() ? new Decimal(0) : totalGrowth.dividedBy(initialBalance).times(100);

    const summary = {
      initialBalance: initialBalance.toString(),
      currentBalance: this.insuranceFund.toString(),
      totalDeposits: totalDeposits.toString(),
      totalWithdrawals: totalWithdrawals.toString(),
      totalFeesCollected: totalFees.toString(),
      totalPayouts: totalPayouts.toString(),
      netOperationalGain: totalFees.minus(totalPayouts).toString(),
      totalLiquidations: this.liquidationHistory.length,
      sideBreakdown,
      totalGrowth: totalGrowth.toString(),
      growthPercentage: growthPercentage.toString()
    };
    
    // Additional fields expected by the frontend
    summary.averageFeePerLiquidation = summary.totalLiquidations > 0 ? summary.totalFeesCollected / summary.totalLiquidations : 0;
    summary.netGain = summary.netOperationalGain;
    summary.profitability = summary.totalFeesCollected > 0 ? (summary.netGain / summary.totalFeesCollected) * 100 : 0;
    summary.methodBreakdown = this.liquidationHistory.reduce((acc, liq) => {
        acc[liq.method] = (acc[liq.method] || 0) + 1;
        return acc;
    }, {});

    return summary;
  }
}

module.exports = { LiquidationEngine }; 