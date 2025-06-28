class LiquidationEngine {
  constructor(matchingEngine = null, orderBook = null, marginCalculator = null) {
    this.liquidationFeeRate = 0.005; // 0.5% liquidation fee
    this.insuranceFund = 1000000; // $1M insurance fund
    this.matchingEngine = matchingEngine;
    this.orderBook = orderBook;
    this.marginCalculator = marginCalculator;
    this.liquidationQueue = [];
    this.isProcessingQueue = false;
    
    // Insurance fund history tracking
    this.insuranceFundHistory = [{
      timestamp: Date.now(),
      type: 'initialization',
      amount: 0,
      balance: this.insuranceFund,
      description: 'Initial insurance fund balance'
    }];
    this.liquidationHistory = [];
  }

  // Set references to matching engine and order book (for dependency injection)
  setReferences(matchingEngine, orderBook, marginCalculator) {
    this.matchingEngine = matchingEngine;
    this.orderBook = orderBook;
    this.marginCalculator = marginCalculator;
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
  async liquidate(position, currentPrice, forceMode = false) {
    const liquidationFee = position.size * currentPrice * this.liquidationFeeRate;
    const bankruptcyPrice = this.calculateBankruptcyPrice(position);
    
    // Calculate pre-liquidation losses (for insurance fund calculation)
    let preLiquidationLoss;
    if (position.side === 'long') {
      preLiquidationLoss = Math.max(0, (position.avgEntryPrice - currentPrice) * position.size);
    } else {
      preLiquidationLoss = Math.max(0, (currentPrice - position.avgEntryPrice) * position.size);
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
      executionPrice: currentPrice,
      slippage: 0,
      fills: [],
      totalExecuted: 0,
      remainingBalance: 0,
      insuranceFundLoss: 0
    };

    try {
      // Attempt real market order execution if matching engine available
      if (this.matchingEngine && this.orderBook && !forceMode) {
        liquidationResult = await this.executeRealLiquidation(position, liquidationResult);
      } else {
        // Fallback to mark price liquidation (legacy method)
        liquidationResult = this.executeFallbackLiquidation(position, currentPrice, liquidationResult);
      }

      // Update insurance fund based on actual execution
      this.updateInsuranceFund(liquidationResult);

      return liquidationResult;

    } catch (error) {
      console.error(`Liquidation failed for ${position.userId}:`, error);
      // Emergency fallback
      return this.executeFallbackLiquidation(position, currentPrice, liquidationResult);
    }
  }

  // NEW: Execute liquidation through real market orders
  async executeRealLiquidation(position, liquidationResult) {
    const liquidationSide = position.side === 'long' ? 'sell' : 'buy';
    
    // Create liquidation market order
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

    // Execute through matching engine
    const matches = this.matchingEngine.match(liquidationOrder);
    
    liquidationResult.fills = liquidationOrder.fills || [];
    liquidationResult.totalExecuted = liquidationOrder.filledSize || 0;
    
    // If no market execution occurred (no opposing orders), fall back to insurance fund execution
    if (liquidationResult.totalExecuted === 0) {
      console.log(`No market liquidity for liquidation - falling back to insurance fund execution at mark price`);
      return this.executeFallbackLiquidation(position, liquidationResult.executionPrice, liquidationResult);
    }
    
    // Market execution successful
    liquidationResult.method = 'market_order';
    liquidationResult.executionPrice = liquidationOrder.avgFillPrice || liquidationResult.executionPrice;
    liquidationResult.slippage = Math.abs(liquidationResult.executionPrice - liquidationResult.executionPrice) / liquidationResult.executionPrice;

    // Calculate remaining balance based on actual execution
    const executedValue = liquidationResult.totalExecuted * liquidationResult.executionPrice;
    const liquidationFeeActual = executedValue * this.liquidationFeeRate;
    
    if (position.side === 'long') {
      const totalLoss = (position.avgEntryPrice - liquidationResult.executionPrice) * liquidationResult.totalExecuted;
      liquidationResult.remainingBalance = Math.max(0, position.initialMargin - totalLoss - liquidationFeeActual);
    } else {
      const totalLoss = (liquidationResult.executionPrice - position.avgEntryPrice) * liquidationResult.totalExecuted;
      liquidationResult.remainingBalance = Math.max(0, position.initialMargin - totalLoss - liquidationFeeActual);
    }

    return liquidationResult;
  }

  // Fallback liquidation at mark price (original method, improved)
  executeFallbackLiquidation(position, currentPrice, liquidationResult) {
    const positionValue = position.size * currentPrice;
    const liquidationFee = positionValue * this.liquidationFeeRate;
    
    // Calculate losses
    let totalLoss;
    if (position.side === 'long') {
      totalLoss = Math.max(0, (position.avgEntryPrice - currentPrice) * position.size);
    } else {
      totalLoss = Math.max(0, (currentPrice - position.avgEntryPrice) * position.size);
    }
    
    // Remaining balance after liquidation
    const remainingBalance = Math.max(0, position.initialMargin - totalLoss - liquidationFee);
    
    liquidationResult.method = 'mark_price';
    liquidationResult.totalExecuted = position.size;
    liquidationResult.remainingBalance = remainingBalance;
    liquidationResult.liquidationFee = liquidationFee;

    return liquidationResult;
  }

  // NEW: Fixed insurance fund calculation with history tracking
  updateInsuranceFund(liquidationResult) {
    const { remainingBalance, liquidationFee, totalExecuted, executionPrice, side, entryPrice, initialMargin, userId } = liquidationResult;
    
    console.log(`Updating insurance fund - Liquidation fee: $${liquidationFee.toFixed(2)}, totalExecuted: ${totalExecuted}, remainingBalance: $${remainingBalance.toFixed(2)}`);
    
    // Insurance fund gains liquidation fees
    const oldBalance = this.insuranceFund;
    this.insuranceFund += liquidationFee;
    
    // Record liquidation fee collection
    this.recordInsuranceFundChange({
      type: 'liquidation_fee',
      amount: liquidationFee,
      balance: this.insuranceFund,
      description: `Liquidation fee from ${userId} (${side} ${totalExecuted} BTC @ $${executionPrice})`
    });
    
    console.log(`Insurance fund gains fee: $${liquidationFee.toFixed(2)}, new balance: $${this.insuranceFund.toFixed(2)}`);
    
    // Insurance fund only pays if user balance goes negative
    if (remainingBalance === 0) {
      let actualLoss;
      if (side === 'long') {
        actualLoss = Math.max(0, (entryPrice - executionPrice) * totalExecuted);
      } else {
        actualLoss = Math.max(0, (executionPrice - entryPrice) * totalExecuted);
      }
      
      console.log(`User balance is zero - actualLoss: $${actualLoss.toFixed(2)}, initialMargin: $${(initialMargin || 0).toFixed(2)}`);
      
      // Only pay out if loss exceeds initial margin (bankruptcy situation)
      if (actualLoss > (initialMargin || 0)) {
        const shortfall = actualLoss - (initialMargin || 0);
        this.insuranceFund -= shortfall;
        liquidationResult.insuranceFundLoss = shortfall;
        
        // Record insurance fund payout
        this.recordInsuranceFundChange({
          type: 'bankruptcy_payout',
          amount: -shortfall,
          balance: this.insuranceFund,
          description: `Bankruptcy payout for ${userId} (shortfall: $${shortfall.toFixed(2)})`
        });
        
        console.log(`Insurance fund pays shortfall: $${shortfall.toFixed(2)}, new balance: $${this.insuranceFund.toFixed(2)}`);
      }
    }
    
    // Record complete liquidation event
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
    const liquidationRecord = {
      id: `liq_${liquidationResult.timestamp}_${liquidationResult.userId}`,
      timestamp: liquidationResult.timestamp,
      userId: liquidationResult.userId,
      side: liquidationResult.side,
      size: liquidationResult.size,
      entryPrice: liquidationResult.entryPrice,
      executionPrice: liquidationResult.executionPrice,
      liquidationPrice: this.calculateLiquidationPrice({ 
        avgEntryPrice: liquidationResult.entryPrice, 
        side: liquidationResult.side,
        leverage: liquidationResult.initialMargin ? (liquidationResult.size * liquidationResult.entryPrice) / liquidationResult.initialMargin : 1
      }),
      bankruptcyPrice: liquidationResult.bankruptcyPrice,
      method: liquidationResult.method,
      liquidationFee: liquidationResult.liquidationFee,
      remainingBalance: liquidationResult.remainingBalance,
      insuranceFundContribution: liquidationResult.liquidationFee,
      insuranceFundLoss: liquidationResult.insuranceFundLoss || 0,
      netInsuranceFundImpact: liquidationResult.liquidationFee - (liquidationResult.insuranceFundLoss || 0),
      fills: liquidationResult.fills || [],
      slippage: liquidationResult.slippage || 0
    };
    
    this.liquidationHistory.push(liquidationRecord);
  }

  calculateBankruptcyPrice(position) {
    // Use MarginCalculator for consistent logic
    if (this.marginCalculator) {
      return this.marginCalculator.calculateBankruptcyPrice(position);
    }
    
    // Fallback calculation
    const { avgEntryPrice, leverage, side } = position;

    if (side === 'long') {
      return avgEntryPrice * (1 - 1/leverage);
    } else {
      return avgEntryPrice * (1 + 1/leverage);
    }
  }

  // NEW: Queue-based liquidation processing
  addToLiquidationQueue(position, priority = 'normal') {
    const queueItem = {
      position,
      priority, // 'urgent', 'normal', 'partial'
      timestamp: Date.now(),
      attempts: 0,
      maxAttempts: 3
    };
    
    this.liquidationQueue.push(queueItem);
    this.liquidationQueue.sort((a, b) => {
      // Sort by priority, then by timestamp
      const priorityOrder = { urgent: 0, normal: 1, partial: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return a.timestamp - b.timestamp;
    });
    
    this.processLiquidationQueue();
  }

  // NEW: Process liquidation queue
  async processLiquidationQueue() {
    if (this.isProcessingQueue || this.liquidationQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    try {
      while (this.liquidationQueue.length > 0) {
        const queueItem = this.liquidationQueue.shift();
        queueItem.attempts++;
        
        try {
          const currentPrice = this.getCurrentMarkPrice();
          const result = await this.liquidate(queueItem.position, currentPrice);
          console.log(`Liquidation completed for ${queueItem.position.userId}`);
        } catch (error) {
          console.error(`Liquidation attempt ${queueItem.attempts} failed:`, error);
          
          if (queueItem.attempts < queueItem.maxAttempts) {
            // Re-queue with delay
            setTimeout(() => {
              this.liquidationQueue.unshift(queueItem);
            }, 1000 * queueItem.attempts); // Exponential backoff
          } else {
            console.error(`Liquidation failed permanently for ${queueItem.position.userId}`);
          }
        }
      }
    } finally {
      this.isProcessingQueue = false;
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
    
    const liquidation = this.liquidate(partialPosition, currentPrice, true); // Force mode for partials
    
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
    return this.insuranceFund;
  }

  // Check if system is at risk (insurance fund low)
  isSystemAtRisk() {
    return this.insuranceFund < 100000; // $100k threshold
  }

  // NEW: Get current mark price (helper for queue processing)
  getCurrentMarkPrice() {
    // This should be injected or accessed from exchange
    return 45000; // Fallback price
  }

  // NEW: Get liquidation queue status
  getQueueStatus() {
    return {
      queueLength: this.liquidationQueue.length,
      isProcessing: this.isProcessingQueue,
      urgent: this.liquidationQueue.filter(item => item.priority === 'urgent').length,
      normal: this.liquidationQueue.filter(item => item.priority === 'normal').length,
      partial: this.liquidationQueue.filter(item => item.priority === 'partial').length
    };
  }

  // Get insurance fund history
  getInsuranceFundHistory() {
    return {
      currentBalance: this.insuranceFund,
      history: this.insuranceFundHistory.slice().reverse(), // Most recent first
      liquidations: this.liquidationHistory.slice().reverse(), // Most recent first
      summary: this.getInsuranceFundSummary()
    };
  }

  // Get insurance fund performance summary
  getInsuranceFundSummary() {
    const totalLiquidations = this.liquidationHistory.length;
    const totalFeesCollected = this.liquidationHistory.reduce((sum, liq) => sum + liq.liquidationFee, 0);
    const totalPayouts = this.liquidationHistory.reduce((sum, liq) => sum + liq.insuranceFundLoss, 0);
    const netGain = totalFeesCollected - totalPayouts;
    
    const methodBreakdown = this.liquidationHistory.reduce((acc, liq) => {
      acc[liq.method] = (acc[liq.method] || 0) + 1;
      return acc;
    }, {});

    const sideBreakdown = this.liquidationHistory.reduce((acc, liq) => {
      acc[liq.side] = (acc[liq.side] || 0) + 1;
      return acc;
    }, {});

    return {
      totalLiquidations,
      totalFeesCollected,
      totalPayouts,
      netGain,
      profitability: totalFeesCollected > 0 ? (netGain / totalFeesCollected * 100) : 0,
      averageFeePerLiquidation: totalLiquidations > 0 ? totalFeesCollected / totalLiquidations : 0,
      methodBreakdown,
      sideBreakdown,
      initialBalance: 1000000,
      currentBalance: this.insuranceFund,
      totalGrowth: this.insuranceFund - 1000000,
      growthPercentage: ((this.insuranceFund - 1000000) / 1000000) * 100
    };
  }
}

module.exports = { LiquidationEngine }; 