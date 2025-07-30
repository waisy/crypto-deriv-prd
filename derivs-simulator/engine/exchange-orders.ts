import { Decimal } from 'decimal.js';
import { OrderData, TradeMatch, OrderResult, LogLevel } from './exchange-types';
import { User } from './user';
import { Position } from './position';
import { Trade } from './trade';
import { MatchingEngine } from './matching';
import { MarginCalculator } from './margin';
import { OrderBook } from './orderbook';

export class ExchangeOrderManager {
  constructor(
    private matchingEngine: MatchingEngine,
    private marginCalculator: MarginCalculator,
    private orderBook: OrderBook,
    private log: (level: LogLevel, message: string, data?: any) => void
  ) {}

  public async placeOrder(
    orderData: OrderData,
    users: Map<string, User>,
    positions: Map<string, Position>,
    riskLimits: any,
    validateRiskLimits: (userId: string, side: 'buy' | 'sell', size: number, price: number, leverage: number, riskLimits: any, existingPosition?: Position) => void,
    currentMarkPrice: Decimal
  ): Promise<OrderResult> {
    const { userId, side, size, price, orderType, leverage } = orderData;
    
    const user = users.get(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    validateRiskLimits(userId, side, size, price, leverage || user.leverage, riskLimits, positions.get(userId));

    if (leverage) {
      user.leverage = leverage;
    }

    const decSize = new Decimal(size);
    const decPrice = new Decimal(price || currentMarkPrice);
    
    // Check if this order would reduce an existing position
    const existingPosition = positions.get(userId);
    const isPositionReducingOrder = existingPosition && 
      ((existingPosition.side === 'long' && side === 'sell') || 
       (existingPosition.side === 'short' && side === 'buy'));
    
    let marginReq = new Decimal(0);
    
    if (isPositionReducingOrder) {
      // For position-reducing orders, check if we have sufficient position to reduce
      if (decSize.greaterThan(existingPosition.size)) {
        // This would flip the position - calculate margin for the net increase
        const netIncrease = decSize.minus(existingPosition.size);
        marginReq = this.marginCalculator.calculateInitialMargin(netIncrease, decPrice, new Decimal(user.leverage));
        
        this.log('INFO', `🔄 POSITION-REDUCING ORDER WITH NET INCREASE`, {
          userId,
          orderSide: side,
          orderSize: decSize.toString(),
          existingPositionSide: existingPosition.side,
          existingPositionSize: existingPosition.size.toString(),
          netIncrease: netIncrease.toString(),
          marginRequired: marginReq.toString()
        });
      } else {
        // Pure position reduction - no additional margin required
        marginReq = new Decimal(0);
        
        this.log('INFO', `🔄 PURE POSITION-REDUCING ORDER`, {
          userId,
          orderSide: side,
          orderSize: decSize.toString(),
          existingPositionSide: existingPosition.side,
          existingPositionSize: existingPosition.size.toString(),
          marginRequired: marginReq.toString()
        });
      }
    } else {
      // New position or position-increasing order - calculate full margin requirement
      marginReq = this.marginCalculator.calculateInitialMargin(decSize, decPrice, new Decimal(user.leverage));
      
      this.log('INFO', `📊 NEW/INCREASING POSITION ORDER`, {
        userId,
        orderSide: side,
        orderSize: decSize.toString(),
        hasExistingPosition: !!existingPosition,
        marginRequired: marginReq.toString()
      });
    }
    
    if (user.availableBalance.lessThan(marginReq)) {
      throw new Error(`Insufficient margin. Required: $${marginReq}, Available: $${user.availableBalance}`);
    }

    // Reserve margin only if required
    if (marginReq.greaterThan(0)) {
      user.availableBalance = user.availableBalance.minus(marginReq);
      user.usedMargin = user.usedMargin.plus(marginReq);
      
      this.log('INFO', `💰 MARGIN RESERVED`, {
        userId,
        marginReserved: marginReq.toString(),
        newAvailableBalance: user.availableBalance.toString(),
        newUsedMargin: user.usedMargin.toString()
      });
    }
    
    const order = {
      id: Date.now().toString(),
      userId,
      side,
      size: decSize,
      remainingSize: decSize,
      filledSize: new Decimal(0),
      price: decPrice,
      avgFillPrice: new Decimal(0),
      type: orderType,
      leverage: user.leverage,
      timestamp: Date.now(),
      lastUpdateTime: Date.now(),
      status: 'NEW',
      timeInForce: 'GTC',
      fills: [],
      totalValue: new Decimal(0),
      commission: new Decimal(0),
      marginReserved: marginReq
    };

    const matches = this.matchingEngine.match(order as any);
    
    return {
      success: true,
      order,
      matches,
      state: null // Will be filled by caller
    };
  }

  public cancelOrder(orderId: string): { success: boolean; orderId: string; state: any } {
    const success = this.orderBook.removeOrder(orderId);
    
    if (!success) {
      throw new Error(`Order ${orderId} not found`);
    }

    console.log(`Order ${orderId} cancelled`);

    return {
      success: true,
      orderId,
      state: null // Will be filled by caller
    };
  }

  public processTrade(
    match: TradeMatch,
    currentMarkPrice: Decimal,
    adlEngine: any,
    trades: any[]
  ): { buyTrade: Trade; sellTrade: Trade; tradeRecord: any } {
    const { buyOrder, sellOrder, price, size } = match;
    
    this.log('INFO', `🔄 PROCESSING TRADE`, {
      buyer: buyOrder.userId,
      seller: sellOrder.userId,
      price: price.toString(),
      size: size.toString()
    });
    
    const decPrice = new Decimal(price);
    const decSize = new Decimal(size);

    // For ADL trades, use the socialization price
    const isADLTrade = buyOrder.userId === 'liquidation_engine' || sellOrder.userId === 'liquidation_engine';
    const tradePrice = isADLTrade ? adlEngine.getLastSocializationPrice() || decPrice : decPrice;
    
    // Create Trade objects for both sides
    const buyTrade = new Trade(buyOrder.userId, 'buy', decSize, tradePrice, {
      orderId: buyOrder.id,
      counterparty: sellOrder.userId,
      tradeType: isADLTrade ? 'adl' : 'normal',
      leverage: buyOrder.leverage,
      markPrice: currentMarkPrice
    });
    
    const sellTrade = new Trade(sellOrder.userId, 'sell', decSize, tradePrice, {
      orderId: sellOrder.id,
      counterparty: buyOrder.userId,
      tradeType: isADLTrade ? 'adl' : 'normal',
      leverage: sellOrder.leverage,
      markPrice: currentMarkPrice
    });

    // Store trade record for history (backward compatibility)
    const tradeRecord = {
      id: buyTrade.id, // Use buy trade ID
      buyUserId: buyOrder.userId,
      sellUserId: sellOrder.userId,
      price: tradePrice,
      size: decSize,
      timestamp: Date.now()
    };

    return { buyTrade, sellTrade, tradeRecord };
  }
} 