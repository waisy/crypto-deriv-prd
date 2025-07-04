import { Decimal } from 'decimal.js';

// Type definitions
export type TradeSide = 'buy' | 'sell';
export type TradeType = 'normal' | 'liquidation' | 'adl';
export type PositionSide = 'long' | 'short';

export interface TradeOptions {
  id?: string;
  timestamp?: number;
  fee?: Decimal;
  leverage?: number;
  orderId?: string | null;
  counterparty?: string | null;
  tradeType?: TradeType;
  markPrice?: Decimal | null;
  indexPrice?: Decimal | null;
}

export interface TradeJSON {
  id: string;
  userId: string;
  side: TradeSide;
  size: string;
  price: string;
  timestamp: number;
  fee: string;
  leverage: number;
  orderId: string | null;
  counterparty: string | null;
  tradeType: TradeType;
  markPrice: string | null;
  indexPrice: string | null;
  notionalValue: string;
  direction: number;
}

export class Trade {
  public readonly id: string;
  public readonly userId: string;
  public readonly side: TradeSide;
  public readonly size: Decimal;
  public readonly price: Decimal;
  public readonly timestamp: number;
  public readonly fee: Decimal;
  public readonly leverage: number;
  public readonly orderId: string | null;
  public readonly counterparty: string | null;
  public readonly tradeType: TradeType;
  public readonly markPrice: Decimal | null;
  public readonly indexPrice: Decimal | null;
  public readonly notionalValue: Decimal;
  public readonly direction: number;

  constructor(
    userId: string,
    side: TradeSide,
    size: Decimal,
    price: Decimal,
    options: TradeOptions = {}
  ) {
    // Validate required parameters
    if (!userId || typeof userId !== 'string') {
      throw new Error('Trade requires valid userId');
    }
    if (!['buy', 'sell'].includes(side)) {
      throw new Error('Trade side must be "buy" or "sell"');
    }
    if (!size || (Decimal.isDecimal(size) ? size.lte(0) : (typeof size === 'number' ? size <= 0 : parseFloat(size) <= 0))) {
      throw new Error('Trade size must be positive');
    }
    if (!price || (Decimal.isDecimal(price) ? price.lte(0) : (typeof price === 'number' ? price <= 0 : parseFloat(price) <= 0))) {
      throw new Error('Trade price must be positive');
    }

    // Core trade properties
    this.id = options.id || `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.userId = userId;
    this.side = side;
    this.size = new Decimal(size);
    this.price = new Decimal(price);
    this.timestamp = options.timestamp || Date.now();
    
    // Optional properties
    this.fee = new Decimal(options.fee || 0);
    this.leverage = options.leverage || 1;
    this.orderId = options.orderId || null;
    this.counterparty = options.counterparty || null;
    this.tradeType = options.tradeType || 'normal';
    
    // Market context
    this.markPrice = options.markPrice ? new Decimal(options.markPrice) : null;
    this.indexPrice = options.indexPrice ? new Decimal(options.indexPrice) : null;
    
    // Calculated properties
    this.notionalValue = this.size.times(this.price);
    this.direction = side === 'buy' ? 1 : -1; // +1 for long, -1 for short
  }

  // Static factory methods for common trade types
  static createNormalTrade(
    userId: string,
    side: TradeSide,
    size: Decimal,
    price: Decimal,
    options: TradeOptions = {}
  ): Trade {
    return new Trade(userId, side, size, price, {
      ...options,
      tradeType: 'normal'
    });
  }

  static createLiquidationTrade(
    userId: string,
    side: TradeSide,
    size: Decimal,
    price: Decimal,
    options: TradeOptions = {}
  ): Trade {
    return new Trade(userId, side, size, price, {
      ...options,
      tradeType: 'liquidation'
    });
  }

  static createADLTrade(
    userId: string,
    side: TradeSide,
    size: Decimal,
    price: Decimal,
    options: TradeOptions = {}
  ): Trade {
    return new Trade(userId, side, size, price, {
      ...options,
      tradeType: 'adl'
    });
  }

  // Helper methods
  isLong(): boolean {
    return this.side === 'buy';
  }

  isShort(): boolean {
    return this.side === 'sell';
  }

  isLiquidation(): boolean {
    return this.tradeType === 'liquidation';
  }

  isADL(): boolean {
    return this.tradeType === 'adl';
  }

  // Get the signed size (positive for buy, negative for sell)
  getSignedSize(): Decimal {
    return this.side === 'buy' ? this.size : this.size.negated();
  }

  // Get the signed notional value
  getSignedNotional(): Decimal {
    return this.side === 'buy' ? this.notionalValue : this.notionalValue.negated();
  }

  // Calculate the impact on position size
  getPositionSizeImpact(): Decimal {
    return this.getSignedSize();
  }

  // Calculate PnL if this trade closes a position at entry price
  calculatePnL(entryPrice: Decimal): Decimal {
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
  wouldIncrease(currentSide: PositionSide | null): boolean {
    if (!currentSide) return true; // No existing position
    return (currentSide === 'long' && this.side === 'buy') ||
           (currentSide === 'short' && this.side === 'sell');
  }

  wouldDecrease(currentSide: PositionSide | null): boolean {
    if (!currentSide) return false; // No existing position to decrease
    return (currentSide === 'long' && this.side === 'sell') ||
           (currentSide === 'short' && this.side === 'buy');
  }

  // Validation method
  validate(): string[] | null {
    const errors: string[] = [];
    
    if (!this.userId) errors.push('Missing userId');
    if (!['buy', 'sell'].includes(this.side)) errors.push('Invalid side');
    if (this.size.lte(0)) errors.push('Size must be positive');
    if (this.price.lte(0)) errors.push('Price must be positive');
    if (this.fee.lt(0)) errors.push('Fee cannot be negative');
    
    return errors.length === 0 ? null : errors;
  }

  // Serialization
  toJSON(): TradeJSON {
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
  static fromJSON(data: TradeJSON): Trade {
    return new Trade(data.userId, data.side, new Decimal(data.size), new Decimal(data.price), {
      id: data.id,
      timestamp: data.timestamp,
      fee: data.fee ? new Decimal(data.fee) : undefined,
      leverage: data.leverage,
      orderId: data.orderId,
      counterparty: data.counterparty,
      tradeType: data.tradeType,
      markPrice: data.markPrice ? new Decimal(data.markPrice) : null,
      indexPrice: data.indexPrice ? new Decimal(data.indexPrice) : null
    });
  }

  // String representation for debugging
  toString(): string {
    return `Trade(${this.id}: ${this.userId} ${this.side} ${this.size} @ ${this.price})`;
  }
} 