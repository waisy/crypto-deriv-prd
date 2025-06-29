const { Decimal } = require('decimal.js');

class User {
  constructor(id, name, initialBalance) {
    this.id = id;
    this.name = name;
    this.availableBalance = new Decimal(initialBalance);
    this.usedMargin = new Decimal(0);
    this.unrealizedPnL = new Decimal(0);
    this.leverage = 10; // Default 10x leverage
    this.totalPnL = new Decimal(0);
  }

  getTotalBalance() {
    return this.availableBalance.plus(this.usedMargin);
  }

  updateAvailableBalance(amount) {
    const decAmount = new Decimal(amount);
    this.availableBalance = this.availableBalance.plus(decAmount);
  }

  deposit(amount) {
    const decAmount = new Decimal(amount);
    this.availableBalance = this.availableBalance.plus(decAmount);
  }

  withdraw(amount) {
    const decAmount = new Decimal(amount);
    if (decAmount.greaterThan(this.availableBalance)) {
      throw new Error('Insufficient available balance for withdrawal');
    }
    this.availableBalance = this.availableBalance.minus(decAmount);
  }

  updatePnL(unrealizedPnL) {
    this.unrealizedPnL = new Decimal(unrealizedPnL);
  }

  getMarginRatio() {
    if (this.usedMargin.isZero()) return null;
    return this.availableBalance.plus(this.unrealizedPnL).dividedBy(this.usedMargin).times(100);
  }

  getEquity() {
    return this.getTotalBalance().plus(this.unrealizedPnL);
  }

  toJSON() {
    const marginRatio = this.getMarginRatio();
    return {
      id: this.id,
      name: this.name,
      totalBalance: this.getTotalBalance().toString(),
      availableBalance: this.availableBalance.toString(),
      usedMargin: this.usedMargin.toString(),
      unrealizedPnL: this.unrealizedPnL.toString(),
      leverage: this.leverage,
      totalPnL: this.totalPnL.toString(),
      marginRatio: marginRatio ? marginRatio.toString() : 'N/A',
      equity: this.getEquity().toString()
    };
  }
}

module.exports = { User }; 