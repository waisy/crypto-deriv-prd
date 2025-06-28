class LiquidationEngine {
  constructor(matchingEngine = null, orderBook = null, marginCalculator = null) {
    this.liquidationFeeRate = 0.005; // 0.5% liquidation fee
    this.insuranceFund = 1000000; // $1M insurance fund
    this.matchingEngine = matchingEngine;
    this.orderBook = orderBook;
    this.marginCalculator = marginCalculator;
    this.liquidationQueue = [];
    this.isProcessingQueue = false;
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
    
    liquidationResult.method = 'market_order';
    liquidationResult.fills = liquidationOrder.fills || [];
    liquidationResult.totalExecuted = liquidationOrder.filledSize || 0;
    
    if (liquidationResult.totalExecuted > 0) {
      liquidationResult.executionPrice = liquidationOrder.avgFillPrice || liquidationResult.executionPrice;
      liquidationResult.slippage = Math.abs(liquidationResult.executionPrice - liquidationResult.executionPrice) / liquidationResult.executionPrice;
    }

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

  // NEW: Fixed insurance fund calculation
  updateInsuranceFund(liquidationResult) {
    const { remainingBalance, liquidationFee, totalExecuted, executionPrice, side, entryPrice } = liquidationResult;
    
    // Insurance fund gains liquidation fees
    this.insuranceFund += liquidationFee;
    
    // Insurance fund only pays if user balance goes negative
    if (remainingBalance === 0) {
      let actualLoss;
      if (side === 'long') {
        actualLoss = Math.max(0, (entryPrice - executionPrice) * totalExecuted);
      } else {
        actualLoss = Math.max(0, (executionPrice - entryPrice) * totalExecuted);
      }
      
      // Only pay out if loss exceeds initial margin (bankruptcy situation)
      const position = { initialMargin: liquidationResult.initialMargin || 0 };
      if (actualLoss > position.initialMargin) {
        const shortfall = actualLoss - position.initialMargin;
        this.insuranceFund -= shortfall;
        liquidationResult.insuranceFundLoss = shortfall;
      }
    }
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
}

module.exports = { LiquidationEngine }; 