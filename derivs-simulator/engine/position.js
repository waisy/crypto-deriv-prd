class Position {
  constructor(userId, side, size, entryPrice, leverage) {
    this.userId = userId;
    this.side = side; // 'long' or 'short'
    this.size = size;
    this.entryPrice = entryPrice;
    this.leverage = leverage;
    this.unrealizedPnL = 0;
    this.initialMargin = 0;
    this.maintenanceMargin = 0;
    this.liquidationPrice = 0;
    this.timestamp = Date.now();
    this.adlScore = 0;
  }

  addSize(additionalSize, price) {
    // Calculate new average entry price
    const totalValue = (this.size * this.entryPrice) + (additionalSize * price);
    this.size += additionalSize;
    this.entryPrice = totalValue / this.size;
  }

  updatePnL(currentPrice) {
    if (this.side === 'long') {
      this.unrealizedPnL = (currentPrice - this.entryPrice) * this.size;
    } else {
      this.unrealizedPnL = (this.entryPrice - currentPrice) * this.size;
    }
  }

  getPositionValue() {
    return this.size * this.entryPrice;
  }

  getNotionalValue(currentPrice) {
    return this.size * currentPrice;
  }

  getRoE() {
    if (this.initialMargin === 0) return 0;
    return (this.unrealizedPnL / this.initialMargin) * 100;
  }

  // Calculate ADL score for auto-deleveraging
  calculateADLScore(totalBalance) {
    const profitPercentage = this.unrealizedPnL / this.getPositionValue();
    const effectiveLeverage = this.getPositionValue() / (totalBalance + this.unrealizedPnL);
    this.adlScore = profitPercentage * effectiveLeverage;
    return this.adlScore;
  }

  toJSON() {
    return {
      userId: this.userId,
      side: this.side,
      size: this.size,
      entryPrice: this.entryPrice,
      leverage: this.leverage,
      unrealizedPnL: this.unrealizedPnL,
      initialMargin: this.initialMargin,
      maintenanceMargin: this.maintenanceMargin,
      liquidationPrice: this.liquidationPrice,
      timestamp: this.timestamp,
      positionValue: this.getPositionValue(),
      roe: this.getRoE(),
      adlScore: this.adlScore
    };
  }
}

module.exports = { Position }; 