const { Decimal } = require('decimal.js');

class Trade {
  constructor(userId, side, size, price, options = {}) {
    // Validate required parameters
    if (!userId || typeof userId !== 'string') {
      throw new Error('Trade requires valid userId');
    }
    if (!['buy', 'sell'].includes(side)) {
      throw new Error('Trade side must be "buy" or "sell"');
    }
    if (!size || (Decimal.isDecimal(size) ? size.lte(0) : size <= 0)) {
      throw new Error('Trade size must be positive');
    }
    if (!price || (Decimal.isDecimal(price) ? price.lte(0) : price <= 0)) {
      throw new Error('Trade price must be positive');
    }

    // Core trade properties
    this.id = options.id || `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.userId = userId;
    this.side = side; // 'buy' or 'sell'
    this.size = new Decimal(size);
    this.price = new Decimal(price);
    this.timestamp = options.timestamp || Date.now();
    
    // Optional properties
    this.fee = new Decimal(options.fee || 0);
    this.leverage = options.leverage || 1;
    this.orderId = options.orderId || null;
    this.counterparty = options.counterparty || null;
    this.tradeType = options.tradeType || 'normal'; // 'normal', 'liquidation', 'adl'
    
    // Market context
    this.markPrice = options.markPrice ? new Decimal(options.markPrice) : null;
    this.indexPrice = options.indexPrice ? new Decimal(options.indexPrice) : null;
    
    // Calculated properties
    this.notionalValue = this.size.times(this.price);
    this.direction = side === 'buy' ? 1 : -1; // +1 for long, -1 for short
  }

  // Static factory methods for common trade types
  static createNormalTrade(userId, side, size, price, options = {}) {
    return new Trade(userId, side, size, price, {
      ...options,
      tradeType: 'normal'
    });
  }

  static createLiquidationTrade(userId, side, size, price, options = {}) {
    return new Trade(userId, side, size, price, {
      ...options,
      tradeType: 'liquidation'
    });
  }

  static createADLTrade(userId, side, size, price, options = {}) {
    return new Trade(userId, side, size, price, {
      ...options,
      tradeType: 'adl'
    });
  }

  // Helper methods
  isLong() {
    return this.side === 'buy';
  }

  isShort() {
    return this.side === 'sell';
  }

  isLiquidation() {
    return this.tradeType === 'liquidation';
  }

  isADL() {
    return this.tradeType === 'adl';
  }

  // Get the signed size (positive for buy, negative for sell)
  getSignedSize() {
    return this.side === 'buy' ? this.size : this.size.negated();
  }

  // Get the signed notional value
  getSignedNotional() {
    return this.side === 'buy' ? this.notionalValue : this.notionalValue.negated();
  }

  // Calculate the impact on position size
  getPositionSizeImpact() {
    return this.getSignedSize();
  }

  // Calculate PnL if this trade closes a position at entry price
  calculatePnL(entryPrice) {
    const decEntryPrice = new Decimal(entryPrice);
    if (this.side === 'sell') {
      // Selling: PnL = (sell price - entry price) * size
      return this.price.minus(decEntryPrice).times(this.size);
    } else {
      // Buying to close short: PnL = (entry price - buy price) * size
      return decEntryPrice.minus(this.price).times(this.size);
    }
  }

  // Check if this trade would increase or decrease a position
  wouldIncrease(currentSide) {
    if (!currentSide) return true; // No existing position
    return (currentSide === 'long' && this.side === 'buy') ||
           (currentSide === 'short' && this.side === 'sell');
  }

  wouldDecrease(currentSide) {
    if (!currentSide) return false; // No existing position to decrease
    return (currentSide === 'long' && this.side === 'sell') ||
           (currentSide === 'short' && this.side === 'buy');
  }

  // Validation method
  validate() {
    const errors = [];
    
    if (!this.userId) errors.push('Missing userId');
    if (!['buy', 'sell'].includes(this.side)) errors.push('Invalid side');
    if (this.size.lte(0)) errors.push('Size must be positive');
    if (this.price.lte(0)) errors.push('Price must be positive');
    if (this.fee.lt(0)) errors.push('Fee cannot be negative');
    
    return errors.length === 0 ? null : errors;
  }

  // Serialization
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      side: this.side,
      size: this.size.toString(),
      price: this.price.toString(),
      timestamp: this.timestamp,
      fee: this.fee.toString(),
      leverage: this.leverage,
      orderId: this.orderId,
      counterparty: this.counterparty,
      tradeType: this.tradeType,
      markPrice: this.markPrice ? this.markPrice.toString() : null,
      indexPrice: this.indexPrice ? this.indexPrice.toString() : null,
      notionalValue: this.notionalValue.toString(),
      direction: this.direction
    };
  }

  // Create from JSON
  static fromJSON(data) {
    return new Trade(data.userId, data.side, data.size, data.price, {
      id: data.id,
      timestamp: data.timestamp,
      fee: data.fee,
      leverage: data.leverage,
      orderId: data.orderId,
      counterparty: data.counterparty,
      tradeType: data.tradeType,
      markPrice: data.markPrice,
      indexPrice: data.indexPrice
    });
  }

  // String representation for debugging
  toString() {
    return `Trade(${this.id}: ${this.userId} ${this.side} ${this.size} @ ${this.price})`;
  }
}

module.exports = { Trade }; 