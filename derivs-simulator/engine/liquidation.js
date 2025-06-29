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
    
    // Log initial insurance fund balance
    console.log('🏛️'.repeat(20));
    console.log('🏛️ INSURANCE FUND INITIALIZED');
    console.log(`🏛️ INITIAL BALANCE: $${this.insuranceFund.toLocaleString()}`);
    console.log('🏛️'.repeat(20));
    
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
    const oldBalance = this.insuranceFund;
    
    console.log('🔧'.repeat(25));
    console.log('🔧 MANUAL INSURANCE FUND ADJUSTMENT');
    console.log('🔧'.repeat(25));
    console.log(`📊 Current balance: $${oldBalance.toLocaleString()}`);
    console.log(`🔄 ${type.toUpperCase()}: $${decAmount.abs().toLocaleString()}`);
    console.log(`📝 Reason: ${description || 'Manual fund adjustment'}`);
    
    this.insuranceFund = this.insuranceFund.plus(decAmount);
    
    console.log(`📊 New balance: $${this.insuranceFund.toLocaleString()}`);
    console.log(`📈 Net change: $${decAmount.toLocaleString()}`);
    console.log('🔧'.repeat(25));

    this.recordInsuranceFundChange({
      type: `manual_${type}`,
      amount: decAmount,
      balance: this.insuranceFund,
      description: description || 'Manual fund adjustment'
    });
    
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
    console.log('='.repeat(60));
    console.log(`🔥 STARTING LIQUIDATION PROCESS for ${position.userId}`);
    console.log('='.repeat(60));
    
    const decCurrentPrice = new Decimal(currentPrice);
    const liquidationFee = position.size.times(decCurrentPrice).times(this.liquidationFeeRate);
    const bankruptcyPrice = this.calculateBankruptcyPrice(position);
    
    console.log(`📊 LIQUIDATION DETAILS:`, {
      userId: position.userId,
      positionSide: position.side,
      positionSize: position.size.toString(),
      entryPrice: position.avgEntryPrice.toString(),
      currentPrice: decCurrentPrice.toString(),
      bankruptcyPrice: bankruptcyPrice.toString(),
      initialMargin: position.initialMargin.toString(),
      unrealizedPnL: position.unrealizedPnL.toString(),
      forceMode
    });
    
    let preLiquidationLoss;
    if (position.side === 'long') {
      preLiquidationLoss = Decimal.max(0, position.avgEntryPrice.minus(decCurrentPrice).times(position.size));
    } else {
      preLiquidationLoss = Decimal.max(0, decCurrentPrice.minus(position.avgEntryPrice).times(position.size));
    }
    
    console.log(`💸 Pre-liquidation loss: $${preLiquidationLoss.toString()}`);
    console.log(`🏛️ Current insurance fund balance: $${this.insuranceFund.toString()}`);
    
    // Calculate user position totals
    let userLongs = new Decimal(0);
    let userShorts = new Decimal(0);
    let userLongPnL = new Decimal(0);
    let userShortPnL = new Decimal(0);
    
    for (const pos of allPositions.values()) {
      const size = new Decimal(pos.size);
      
      // Handle PnL calculation for both types of positions
      let pnl;
      if (typeof pos.calculateUnrealizedPnL === 'function') {
        pnl = pos.calculateUnrealizedPnL(decCurrentPrice);
      } else if (pos.unrealizedPnL) {
        pnl = new Decimal(pos.unrealizedPnL);
      } else {
        // Calculate PnL manually if neither method is available
        const entryPrice = new Decimal(pos.avgEntryPrice || pos.entryPrice);
        pnl = pos.side === 'long' 
          ? decCurrentPrice.minus(entryPrice).times(size)
          : entryPrice.minus(decCurrentPrice).times(size);
      }

      if (pos.side === 'long') {
        userLongs = userLongs.plus(size);
        userLongPnL = userLongPnL.plus(pnl);
      } else {
        userShorts = userShorts.plus(size);
        userShortPnL = userShortPnL.plus(pnl);
      }
    }

    console.log(`📊 PRE-LIQUIDATION ZERO-SUM CHECK:`, {
      quantities: {
        long: userLongs.toString(),
        short: userShorts.toString(),
        difference: userLongs.minus(userShorts).toString()
      },
      pnl: {
        long: userLongPnL.toString(),
        short: userShortPnL.toString(),
        total: userLongPnL.plus(userShortPnL).toString()
      }
    });

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
        console.log(`📋 ATTEMPTING LIQUIDATION VIA ORDER BOOK`);
        liquidationResult = await this.executeRealLiquidation(position, liquidationResult);
      } else {
        console.log(`📋 USING FALLBACK LIQUIDATION MODE (forceMode: ${forceMode})`);
        liquidationResult = this.executeFallbackLiquidation(position, decCurrentPrice, liquidationResult);
      }

      console.log(`📋 LIQUIDATION METHOD RESULT:`, {
        method: liquidationResult.method,
        totalExecuted: liquidationResult.totalExecuted.toString(),
        executionPrice: liquidationResult.executionPrice.toString(),
        fills: liquidationResult.fills.length
      });

      console.log(`🏛️ UPDATING INSURANCE FUND...`);
      this.updateInsuranceFund(liquidationResult, allPositions);

      console.log(`✅ LIQUIDATION PROCESS COMPLETED for ${position.userId}`);
      console.log('='.repeat(60));
      return liquidationResult;

    } catch (error) {
      console.error(`❌ Liquidation failed for ${position.userId}:`, error);
      console.log(`🔄 FALLING BACK TO MARK PRICE LIQUIDATION`);
      const fallbackResult = this.executeFallbackLiquidation(position, decCurrentPrice, liquidationResult);
      this.updateInsuranceFund(fallbackResult, allPositions);
      return fallbackResult;
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
    console.log(`🚨 EXECUTING FALLBACK LIQUIDATION (Insurance Fund Mode)`);
    console.log(`   This is where the position might "disappear" - we need to track this carefully!`);
    
    // CRITICAL FIX: Use bankruptcy price instead of current market price
    const bankruptcyPrice = liquidationResult.bankruptcyPrice;
    const decBankruptcyPrice = new Decimal(bankruptcyPrice);
    const positionValue = position.size.times(decBankruptcyPrice);
    const liquidationFee = positionValue.times(this.liquidationFeeRate);
    
    console.log(`💼 FALLBACK LIQUIDATION CALCULATION:`, {
      positionSide: position.side,
      positionSize: position.size.toString(),
      entryPrice: position.avgEntryPrice.toString(),
      bankruptcyPrice: decBankruptcyPrice.toString(),
      currentMarketPrice: currentPrice.toString(),
      executionPrice: decBankruptcyPrice.toString(),
      positionValue: positionValue.toString(),
      liquidationFee: liquidationFee.toString()
    });
    
    let totalLoss;
    if (position.side === 'long') {
      totalLoss = Decimal.max(0, position.avgEntryPrice.minus(decBankruptcyPrice).times(position.size));
    } else {
      totalLoss = Decimal.max(0, decBankruptcyPrice.minus(position.avgEntryPrice).times(position.size));
    }
    
    console.log(`💸 CALCULATED LOSS: $${totalLoss.toString()}`);
    console.log(`⚠️  CRITICAL: Position of ${position.side} ${position.size.toString()} BTC will be REMOVED from the system`);
    console.log(`⚠️  CRITICAL: This breaks zero-sum invariant unless position is transferred to liquidation engine!`);
    
    liquidationResult.method = 'bankruptcy_price';
    liquidationResult.executionPrice = decBankruptcyPrice;
    liquidationResult.totalExecuted = position.size;
    liquidationResult.remainingBalance = Decimal.max(0, position.initialMargin.minus(totalLoss).minus(liquidationFee));
    liquidationResult.liquidationFee = liquidationFee;

    return liquidationResult;
  }

  updateInsuranceFund(liquidationResult, allPositions) {
    console.log(`💰 INSURANCE FUND UPDATE PROCESS STARTING`);
    const { remainingBalance, liquidationFee, totalExecuted, executionPrice, side, entryPrice, initialMargin, userId, bankruptcyPrice } = liquidationResult;
    
    console.log(`📊 INSURANCE FUND UPDATE INPUTS:`, {
      userId,
      side,
      totalExecuted: totalExecuted.toString(),
      executionPrice: executionPrice.toString(),
      entryPrice: entryPrice.toString(),
      liquidationFee: liquidationFee.toString(),
      remainingBalance: remainingBalance.toString(),
      initialMargin: (initialMargin || 0).toString(),
      currentInsuranceFund: this.insuranceFund.toString()
    });
    
    // STEP 1: Collect liquidation fee (this is profit for insurance fund)
    console.log(`📈 STEP 1: Adding liquidation fee to insurance fund`);
    console.log(`   Fee amount: $${liquidationFee.toString()}`);
    console.log(`   Fund before: $${this.insuranceFund.toString()}`);
    
    const oldFundBalance = this.insuranceFund;
    this.insuranceFund = this.insuranceFund.plus(liquidationFee);
    
    console.log('💰💰💰 INSURANCE FUND INCREASE 💰💰💰');
    console.log(`💰 BEFORE: $${oldFundBalance.toLocaleString()}`);
    console.log(`💰 FEE COLLECTED: +$${liquidationFee.toLocaleString()}`);
    console.log(`💰 AFTER: $${this.insuranceFund.toLocaleString()}`);
    console.log('💰💰💰💰💰💰💰💰💰💰💰💰💰💰💰💰💰💰💰💰💰💰💰');
    
    this.recordInsuranceFundChange({
      type: 'liquidation_fee',
      amount: liquidationFee,
      balance: this.insuranceFund,
      description: `Liquidation fee from ${userId}`
    });
    
    // STEP 2: Check if user's margin is exhausted (bankruptcy situation)
    console.log(`📉 STEP 2: Checking if user is bankrupt (remainingBalance = 0)`);
    console.log(`   Remaining balance: $${remainingBalance.toString()}`);
    
    if (remainingBalance.isZero()) {
      console.log(`🚨 USER IS BANKRUPT - Insurance fund must cover losses beyond margin`);
      console.log(`⚠️  CRITICAL MOMENT: This is where the accounting gets tricky!`);
      const bankruptPosition = { side, avgEntryPrice: bankruptcyPrice };
      let actualLoss;
      if (side === 'long') {
        actualLoss = Decimal.max(0, new Decimal(entryPrice).minus(executionPrice).times(totalExecuted));
      } else {
        actualLoss = Decimal.max(0, new Decimal(executionPrice).minus(entryPrice).times(totalExecuted));
      }
      
      console.log(`💸 BANKRUPTCY LOSS CALCULATION:`, {
        entryPrice: entryPrice.toString(),
        executionPrice: executionPrice.toString(),
        totalExecuted: totalExecuted.toString(),
        actualLoss: actualLoss.toString(),
        initialMargin: (initialMargin || 0).toString()
      });
      
      const decInitialMargin = new Decimal(initialMargin || 0);
      console.log(`🔍 CHECKING IF LOSS EXCEEDS MARGIN:`);
      console.log(`   Actual loss: $${actualLoss.toString()}`);
      console.log(`   Initial margin: $${decInitialMargin.toString()}`);
      console.log(`   Loss > Margin: ${actualLoss.greaterThan(decInitialMargin)}`);
      
      if (actualLoss.greaterThan(decInitialMargin)) {
        const shortfall = actualLoss.minus(decInitialMargin);
        console.log(`💔 SHORTFALL DETECTED: $${shortfall.toString()}`);
        console.log(`⚠️  This shortfall must be covered by insurance fund or ADL`);
        
        if (this.insuranceFund.gte(shortfall)) {
          console.log(`✅ INSURANCE FUND CAN COVER SHORTFALL`);
          console.log(`   Fund balance: $${this.insuranceFund.toString()}`);
          console.log(`   Shortfall: $${shortfall.toString()}`);
          
          // Insurance fund can cover the entire loss
          const fundBeforePayout = this.insuranceFund;
          this.insuranceFund = this.insuranceFund.minus(shortfall);
          liquidationResult.insuranceFundLoss = shortfall;
          
          console.log('🔥🔥🔥 INSURANCE FUND DECREASE 🔥🔥🔥');
          console.log(`🔥 BEFORE: $${fundBeforePayout.toLocaleString()}`);
          console.log(`🔥 BANKRUPTCY PAYOUT: -$${shortfall.toLocaleString()}`);
          console.log(`🔥 AFTER: $${this.insuranceFund.toLocaleString()}`);
          console.log(`🔥 REASON: User ${userId} bankrupt - covering shortfall`);
          
          this.recordInsuranceFundChange({
            type: 'bankruptcy_payout',
            amount: shortfall.negated(),
            balance: this.insuranceFund,
            description: `Bankruptcy coverage for ${userId}. Shortfall: $${shortfall.toString()}`
          });
          
        } else {
          // Insurance fund is insufficient, trigger ADL
          console.log(`❌ INSURANCE FUND INSUFFICIENT FOR SHORTFALL`);
          const insurancePayout = this.insuranceFund;
          const adlAmount = shortfall.minus(insurancePayout);
          
          console.log(`🔥 TRIGGERING ADL MECHANISM`);
          console.log(`   Fund balance: $${this.insuranceFund.toString()}`);
          console.log(`   Required: $${shortfall.toString()}`);
          console.log(`   Fund will pay: $${insurancePayout.toString()}`);
          console.log(`   ADL must cover: $${adlAmount.toString()}`);
          
          const fundBeforeDraining = this.insuranceFund;
          this.insuranceFund = new Decimal(0);
          liquidationResult.insuranceFundLoss = insurancePayout;
          liquidationResult.adlSocializationRequired = adlAmount;
          
          console.log('💀💀💀 INSURANCE FUND DRAINED 💀💀💀');
          console.log(`💀 BEFORE: $${fundBeforeDraining.toLocaleString()}`);
          console.log(`💀 FINAL PAYOUT: -$${insurancePayout.toLocaleString()}`);
          console.log(`💀 AFTER: $${this.insuranceFund.toLocaleString()} (DRAINED!)`);
          console.log(`💀 REASON: User ${userId} bankrupt - fund insufficient`);
          console.log(`💀 ADL REQUIRED FOR: $${adlAmount.toLocaleString()}`);
          console.log('💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀');
          
          this.recordInsuranceFundChange({
            type: 'bankruptcy_payout_drained',
            amount: insurancePayout.negated(),
            balance: this.insuranceFund,
            description: `Insurance fund drained for ${userId}. Payout: $${insurancePayout.toString()}, ADL required for $${adlAmount.toString()}`
          });
        }
      } else {
        console.log(`✅ User margin covers all losses - no insurance fund payout needed`);
        // Return remaining margin to user's available balance
        liquidationResult.marginToReturn = remainingBalance;
      }
    } else {
      console.log(`✅ User has remaining balance - no bankruptcy situation`);
    }
    
    // FINAL STEP: Record the liquidation event
    console.log(`📝 RECORDING LIQUIDATION EVENT`);
    this.recordLiquidationEvent(liquidationResult);
    
    // FINAL INSURANCE FUND STATUS SUMMARY
    console.log('🏛️'.repeat(25));
    console.log('🏛️ INSURANCE FUND FINAL STATUS');
    console.log('🏛️'.repeat(25));
    console.log(`💰 FINAL BALANCE: $${this.insuranceFund.toLocaleString()}`);
    
    const fundHealthStatus = this.insuranceFund.greaterThan(500000) ? 'HEALTHY' : 
                           this.insuranceFund.greaterThan(100000) ? 'CAUTION' :
                           this.insuranceFund.greaterThan(0) ? 'CRITICAL' : 'DRAINED';
    
    console.log(`📊 FUND STATUS: ${fundHealthStatus}`);
    console.log(`📈 NET CHANGE THIS LIQUIDATION: ${liquidationFee.minus(liquidationResult.insuranceFundLoss || 0).toLocaleString()}`);
    console.log(`🔢 TOTAL HISTORY ENTRIES: ${this.insuranceFundHistory.length}`);
    console.log('🏛️'.repeat(25));
    
    console.log(`💰 INSURANCE FUND UPDATE COMPLETED`);
    
    return liquidationResult;
  }

  // Record insurance fund balance changes
  recordInsuranceFundChange(change) {
    const timestamp = Date.now();
    const changeRecord = {
      timestamp,
      ...change
    };
    
    this.insuranceFundHistory.push(changeRecord);
    
    // PROMINENT INSURANCE FUND LOGGING
    console.log('💰'.repeat(30));
    console.log('🏛️  INSURANCE FUND BALANCE CHANGE  🏛️');
    console.log('💰'.repeat(30));
    console.log(`📅 Time: ${new Date(timestamp).toISOString()}`);
    console.log(`📋 Type: ${change.type.toUpperCase()}`);
    console.log(`📝 Description: ${change.description}`);
    
    if (change.amount.isPositive()) {
      console.log(`📈 FUND INCREASE: +$${change.amount.toLocaleString()}`);
    } else if (change.amount.isNegative()) {
      console.log(`📉 FUND DECREASE: $${change.amount.toLocaleString()}`);
    } else {
      console.log(`⚪ NO CHANGE: $${change.amount.toLocaleString()}`);
    }
    
    console.log(`🏛️  NEW BALANCE: $${change.balance.toLocaleString()}`);
    
    // Risk assessment
    if (change.balance.lessThan(100000)) {
      console.log(`🚨 WARNING: Insurance fund below $100k!`);
    } else if (change.balance.lessThan(500000)) {
      console.log(`⚠️  CAUTION: Insurance fund below $500k`);
    } else {
      console.log(`✅ Fund status: Healthy`);
    }
    
    console.log('💰'.repeat(30));
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
    
    // Calculate net insurance fund impact (fees gained - losses paid out)
    const liquidationFee = new Decimal(sanitizedResult.liquidationFee || 0);
    const insuranceFundLoss = new Decimal(sanitizedResult.insuranceFundLoss || 0);
    sanitizedResult.netInsuranceFundImpact = liquidationFee.minus(insuranceFundLoss).toString();
    
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

    // Calculate additional fields with proper Decimal arithmetic before converting to strings
    const netOperationalGain = totalFees.minus(totalPayouts);
    const averageFeePerLiquidation = this.liquidationHistory.length > 0 ? 
      totalFees.dividedBy(this.liquidationHistory.length) : new Decimal(0);
    const profitability = totalFees.greaterThan(0) ? 
      netOperationalGain.dividedBy(totalFees).times(100) : new Decimal(0);

    const summary = {
      initialBalance: initialBalance.toString(),
      currentBalance: this.insuranceFund.toString(),
      totalDeposits: totalDeposits.toString(),
      totalWithdrawals: totalWithdrawals.toString(),
      totalFeesCollected: totalFees.toString(),
      totalPayouts: totalPayouts.toString(),
      netOperationalGain: netOperationalGain.toString(),
      totalLiquidations: this.liquidationHistory.length,
      sideBreakdown,
      totalGrowth: totalGrowth.toString(),
      growthPercentage: growthPercentage.toString(),
      averageFeePerLiquidation: averageFeePerLiquidation.toString(),
      netGain: netOperationalGain.toString(),
      profitability: profitability.toString(),
      methodBreakdown: this.liquidationHistory.reduce((acc, liq) => {
        acc[liq.method] = (acc[liq.method] || 0) + 1;
        return acc;
      }, {})
    };

    return summary;
  }
}

module.exports = { LiquidationEngine }; 