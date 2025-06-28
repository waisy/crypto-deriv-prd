class Position {
  constructor(userId, side, size, entryPrice, leverage) {
    this.userId = userId;
    this.side = side; // 'long' or 'short'
    this.size = size;
    this.avgEntryPrice = entryPrice;
    this.leverage = leverage;
    this.unrealizedPnL = 0;
    this.initialMargin = 0;
    this.maintenanceMargin = 0;
    this.liquidationPrice = 0;
    this.timestamp = Date.now();
    this.adlScore = 0;
  }

  addSize(additionalSize, price) {
    // Input validation
    if (additionalSize <= 0 || price <= 0) {
      throw new Error('Invalid size or price for adding to position');
    }

    // Calculate new average entry price
    const totalValue = (this.size * this.avgEntryPrice) + (additionalSize * price);
    this.size += additionalSize;
    this.avgEntryPrice = totalValue / this.size;
  }

  reduceSize(reductionSize, price) {
    // Input validation
    if (reductionSize <= 0 || price <= 0) {
      throw new Error('Invalid size or price for reducing position');
    }
    
    if (reductionSize > this.size) {
      throw new Error('Cannot reduce position by more than current size');
    }

    // Calculate realized PnL for the portion being closed
    let realizedPnL = 0;
    if (this.side === 'long') {
      realizedPnL = (price - this.avgEntryPrice) * reductionSize;
    } else {
      realizedPnL = (this.avgEntryPrice - price) * reductionSize;
    }

    this.size -= reductionSize;
    
    // Average entry price stays the same when reducing
    return realizedPnL;
  }

  closePosition(price) {
    if (price <= 0) {
      throw new Error('Invalid price for closing position');
    }

    const realizedPnL = this.reduceSize(this.size, price);
    return realizedPnL;
  }

  updatePnL(currentPrice) {
    if (currentPrice <= 0) {
      throw new Error('Invalid current price for PnL calculation');
    }

    if (this.side === 'long') {
      this.unrealizedPnL = (currentPrice - this.avgEntryPrice) * this.size;
    } else {
      this.unrealizedPnL = (this.avgEntryPrice - currentPrice) * this.size;
    }
  }

  getPositionValue() {
    return this.size * this.avgEntryPrice;
  }

  getNotionalValue(currentPrice) {
    return this.size * currentPrice;
  }

  getRoE() {
    // Improved validation and calculation
    if (this.initialMargin === 0 || this.initialMargin === null || this.initialMargin === undefined) {
      return 0;
    }
    return (this.unrealizedPnL / this.initialMargin) * 100;
  }

  // Fixed ADL score calculation
  calculateADLScore(totalBalance) {
    if (totalBalance <= 0) {
      return 0;
    }

    // ADL should only apply to profitable positions
    if (this.unrealizedPnL <= 0) {
      this.adlScore = 0;
      return this.adlScore;
    }

    // Calculate profit percentage based on initial margin (more accurate for leveraged positions)
    const profitPercentage = this.unrealizedPnL / this.initialMargin;
    
    // Calculate effective leverage: position notional / (available balance + unrealized PnL)
    const adjustedBalance = Math.max(totalBalance + this.unrealizedPnL, 1); // Prevent division by zero
    const effectiveLeverage = this.getPositionValue() / adjustedBalance;
    
    // ADL score = profit percentage * effective leverage
    // Higher scores get deleveraged first
    this.adlScore = profitPercentage * effectiveLeverage;
    return this.adlScore;
  }

  // Check if position is still open
  isOpen() {
    return this.size > 0;
  }

  // Get position direction multiplier for calculations
  getDirectionMultiplier() {
    return this.side === 'long' ? 1 : -1;
  }

  toJSON() {
    return {
      userId: this.userId,
      side: this.side,
      size: this.size,
      avgEntryPrice: this.avgEntryPrice, // Fixed property name
      leverage: this.leverage,
      unrealizedPnL: this.unrealizedPnL,
      initialMargin: this.initialMargin,
      maintenanceMargin: this.maintenanceMargin,
      liquidationPrice: this.liquidationPrice,
      timestamp: this.timestamp,
      positionValue: this.getPositionValue(),
      roe: this.getRoE(),
      adlScore: this.adlScore,
      isOpen: this.isOpen()
    };
  }
}

module.exports = { Position }; 