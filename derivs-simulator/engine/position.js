const { Decimal } = require('decimal.js');

class Position {
  constructor(userId, side, size, entryPrice, leverage) {
    this.userId = userId;
    this.side = side; // 'long' or 'short'
    this.size = new Decimal(size);
    this.avgEntryPrice = new Decimal(entryPrice);
    this.leverage = leverage;
    this.unrealizedPnL = new Decimal(0);
    this.initialMargin = new Decimal(0);
    this.maintenanceMargin = new Decimal(0);
    this.liquidationPrice = new Decimal(0);
    this.timestamp = Date.now();
    this.adlScore = 0;
  }

  addSize(additionalSize, price) {
    const decAdditionalSize = new Decimal(additionalSize);
    const decPrice = new Decimal(price);

    if (decAdditionalSize.isNegative() || decAdditionalSize.isZero() || decPrice.isNegative() || decPrice.isZero()) {
      throw new Error('Invalid size or price for adding to position');
    }

    const totalValue = this.size.times(this.avgEntryPrice).plus(decAdditionalSize.times(decPrice));
    this.size = this.size.plus(decAdditionalSize);
    this.avgEntryPrice = totalValue.dividedBy(this.size);
  }

  reduceSize(reductionSize, price) {
    const decReductionSize = new Decimal(reductionSize);
    const decPrice = new Decimal(price);

    if (decReductionSize.isNegative() || decReductionSize.isZero() || decPrice.isNegative() || decPrice.isZero()) {
      throw new Error('Invalid size or price for reducing position');
    }
    
    if (decReductionSize.greaterThan(this.size)) {
      throw new Error('Cannot reduce position by more than current size');
    }

    let realizedPnL;
    if (this.side === 'long') {
      realizedPnL = decPrice.minus(this.avgEntryPrice).times(decReductionSize);
    } else {
      realizedPnL = this.avgEntryPrice.minus(decPrice).times(decReductionSize);
    }

    // Calculate margin to release proportionally
    const marginToRelease = this.initialMargin.times(decReductionSize.dividedBy(this.size));
    this.initialMargin = this.initialMargin.minus(marginToRelease);

    this.size = this.size.minus(decReductionSize);
    
    return realizedPnL;
  }

  closePosition(price) {
    const decPrice = new Decimal(price);
    if (decPrice.isNegative() || decPrice.isZero()) {
      throw new Error('Invalid price for closing position');
    }

    const realizedPnL = this.reduceSize(this.size, decPrice);
    this.initialMargin = new Decimal(0);
    return realizedPnL;
  }

  updatePnL(currentPrice) {
    const decCurrentPrice = new Decimal(currentPrice);
    if (decCurrentPrice.isNegative() || decCurrentPrice.isZero()) {
      throw new Error('Invalid current price for PnL calculation');
    }

    if (this.side === 'long') {
      this.unrealizedPnL = decCurrentPrice.minus(this.avgEntryPrice).times(this.size);
    } else {
      this.unrealizedPnL = this.avgEntryPrice.minus(decCurrentPrice).times(this.size);
    }
  }

  getPositionValue() {
    return this.size.times(this.avgEntryPrice);
  }

  getNotionalValue(currentPrice) {
    return this.size.times(new Decimal(currentPrice));
  }

  getRoE() {
    if (this.initialMargin.isZero() || this.initialMargin === null || this.initialMargin === undefined) {
      return new Decimal(0);
    }
    return this.unrealizedPnL.dividedBy(this.initialMargin).times(100);
  }

  calculateBankruptcyPrice() {
    // Margin-based calculation: more robust than leverage-based
    // Bankruptcy price is where total loss equals initial margin
    const marginPerUnit = this.initialMargin.dividedBy(this.size);
    
    if (this.side === 'long') {
      // For long: bankruptcy price = entry price - (margin per unit)
      return this.avgEntryPrice.minus(marginPerUnit);
    } else {
      // For short: bankruptcy price = entry price + (margin per unit)  
      return this.avgEntryPrice.plus(marginPerUnit);
    }
  }

  calculateADLScore(totalBalance) {
    const decTotalBalance = new Decimal(totalBalance);
    if (decTotalBalance.isNegative() || decTotalBalance.isZero()) {
      return 0;
    }

    if (this.unrealizedPnL.isNegative() || this.unrealizedPnL.isZero()) {
      this.adlScore = 0;
      return this.adlScore;
    }

    const profitPercentage = this.unrealizedPnL.dividedBy(this.initialMargin);
    
    const adjustedBalance = decTotalBalance.plus(this.unrealizedPnL);
    if (adjustedBalance.isZero()) return 0; // Prevent division by zero

    const effectiveLeverage = this.getPositionValue().dividedBy(adjustedBalance);
    
    this.adlScore = profitPercentage.times(effectiveLeverage).toNumber();
    return this.adlScore;
  }

  isOpen() {
    return this.size.greaterThan(0);
  }

  getDirectionMultiplier() {
    return this.side === 'long' ? 1 : -1;
  }

  toJSON() {
    return {
      userId: this.userId,
      side: this.side,
      size: this.size.toString(),
      avgEntryPrice: this.avgEntryPrice.toString(),
      leverage: this.leverage,
      unrealizedPnL: this.unrealizedPnL.toString(),
      initialMargin: this.initialMargin.toString(),
      maintenanceMargin: this.maintenanceMargin.toString(),
      liquidationPrice: this.liquidationPrice.toString(),
      bankruptcyPrice: this.calculateBankruptcyPrice().toString(),
      timestamp: this.timestamp,
      positionValue: this.getPositionValue().toString(),
      roe: this.getRoE().toString(),
      adlScore: this.adlScore,
      isOpen: this.isOpen()
    };
  }
}

module.exports = { Position }; 