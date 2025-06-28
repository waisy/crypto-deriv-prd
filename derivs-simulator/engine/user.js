class User {
  constructor(id, name, initialBalance) {
    this.id = id;
    this.name = name;
    this.totalBalance = initialBalance;
    this.availableBalance = initialBalance;
    this.usedMargin = 0;
    this.unrealizedPnL = 0;
    this.leverage = 10; // Default 10x leverage
    this.totalPnL = 0;
  }

  updateBalance(amount) {
    this.availableBalance += amount;
    this.totalBalance += amount;
  }

  updatePnL(unrealizedPnL) {
    this.unrealizedPnL = unrealizedPnL;
  }

  getMarginRatio() {
    if (this.usedMargin === 0) return Infinity;
    return ((this.availableBalance + this.unrealizedPnL) / this.usedMargin) * 100;
  }

  getEquity() {
    return this.totalBalance + this.unrealizedPnL;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      totalBalance: this.totalBalance,
      availableBalance: this.availableBalance,
      usedMargin: this.usedMargin,
      unrealizedPnL: this.unrealizedPnL,
      leverage: this.leverage,
      totalPnL: this.totalPnL,
      marginRatio: this.getMarginRatio(),
      equity: this.getEquity()
    };
  }
}

module.exports = { User }; 