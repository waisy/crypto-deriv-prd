const { Decimal } = require('decimal.js');

class User {
  constructor(id, name, initialBalance) {
    this.id = id;
    this.name = name;
    this.totalBalance = new Decimal(initialBalance);
    this.availableBalance = new Decimal(initialBalance);
    this.usedMargin = new Decimal(0);
    this.unrealizedPnL = new Decimal(0);
    this.leverage = 10; // Default 10x leverage
    this.totalPnL = new Decimal(0);
  }

  updateBalance(amount) {
    const decAmount = new Decimal(amount);
    this.availableBalance = this.availableBalance.plus(decAmount);
    this.totalBalance = this.totalBalance.plus(decAmount);
  }

  updatePnL(unrealizedPnL) {
    this.unrealizedPnL = new Decimal(unrealizedPnL);
  }

  getMarginRatio() {
    if (this.usedMargin.isZero()) return Infinity;
    return this.availableBalance.plus(this.unrealizedPnL).dividedBy(this.usedMargin).times(100).toNumber();
  }

  getEquity() {
    return this.totalBalance.plus(this.unrealizedPnL);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      totalBalance: this.totalBalance.toNumber(),
      availableBalance: this.availableBalance.toNumber(),
      usedMargin: this.usedMargin.toNumber(),
      unrealizedPnL: this.unrealizedPnL.toNumber(),
      leverage: this.leverage,
      totalPnL: this.totalPnL.toNumber(),
      marginRatio: this.getMarginRatio(),
      equity: this.getEquity().toNumber()
    };
  }
}

module.exports = { User }; 