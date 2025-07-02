import { OrderBook, Order, Fill } from './orderbook';
import { Decimal } from 'decimal.js';

export interface Match {
  buyOrder: Order;
  sellOrder: Order;
  price: number;
  size: number;
}

export class MatchingEngine {
  public orderBook: OrderBook;

  constructor(orderBook: OrderBook) {
    this.orderBook = orderBook;
  }

  match(incomingOrder: Order): Match[] {
    const matches: Match[] = [];
    
    // Ensure remainingSize is properly initialized as Decimal
    if (!incomingOrder.remainingSize || !(incomingOrder.remainingSize instanceof Decimal)) {
      incomingOrder.remainingSize = new Decimal(incomingOrder.size || 0);
    }
    
    let remainingSize = incomingOrder.remainingSize.toNumber();
    
    // Initialize order tracking properties if not present
    if (incomingOrder.filledSize === undefined) incomingOrder.filledSize = 0;

    if (incomingOrder.side === 'buy') {
      // For buy orders, match against asks (sell orders)
      const askLevels = Array.from(this.orderBook.asks.keys()).sort((a, b) => parseFloat(a) - parseFloat(b));
      
      for (const price of askLevels) {
        if (remainingSize <= 0) break;
        if (incomingOrder.type === 'limit' && parseFloat(price) > incomingOrder.price.toNumber()) break;
        
        const orders = this.orderBook.asks.get(price) as Order[];
        if (!orders) continue;
        
        for (let i = 0; i < orders.length && remainingSize > 0; i++) {
          const sellOrder = orders[i];
          
          // Initialize order tracking properties if not present
          if (sellOrder.filledSize === undefined) sellOrder.filledSize = 0;
          
          // Ensure remainingSize is properly initialized as Decimal
          if (!sellOrder.remainingSize || !(sellOrder.remainingSize instanceof Decimal)) {
            sellOrder.remainingSize = new Decimal(sellOrder.size || 0);
          }
          
          // Self-match prevention: Cancel oldest (resting order)
          if (sellOrder.userId === incomingOrder.userId) {
            console.log(`Canceling oldest order ${sellOrder.id} to prevent self-match for user ${sellOrder.userId}`);
            this.orderBook.removeOrder(sellOrder.id);
            i--; // Adjust index since we removed an order
            continue; // Skip to next order, no match created
          }
          
          const matchSize = Math.min(remainingSize, sellOrder.remainingSize.toNumber());
          
          matches.push({
            buyOrder: incomingOrder,
            sellOrder: sellOrder,
            price: parseFloat(price),
            size: matchSize
          });
          
          remainingSize -= matchSize;
          sellOrder.remainingSize = sellOrder.remainingSize.minus(matchSize);
          sellOrder.filledSize += matchSize;
          sellOrder.lastUpdateTime = Date.now();
          
          // Update fill tracking for sell order
          if (!sellOrder.fills) sellOrder.fills = [];
          sellOrder.fills.push({
            price: sellOrder.price,
            size: sellOrder.size.minus(sellOrder.remainingSize),
            timestamp: Date.now(),
            tradeId: Date.now().toString()
          });
          
          // Update average fill price
          sellOrder.avgFillPrice = sellOrder.fills.reduce((sum, fill) => sum + (fill.price.toNumber() * fill.size.toNumber()), 0) / sellOrder.filledSize;
          if (!sellOrder.totalValue) sellOrder.totalValue = 0;
          sellOrder.totalValue += matchSize * parseFloat(price);
          
          // Update order status
          if (sellOrder.remainingSize.isZero()) {
            sellOrder.status = 'FILLED';
            this.orderBook.removeOrder(sellOrder.id);
            i--; // Adjust index since we removed an order
          } else {
            sellOrder.status = 'PARTIALLY_FILLED';
          }
        }
      }
    } else {
      // For sell orders, match against bids (buy orders)
      const bidLevels = Array.from(this.orderBook.bids.keys()).sort((a, b) => parseFloat(b) - parseFloat(a));
      
      for (const price of bidLevels) {
        if (remainingSize <= 0) break;
        if (incomingOrder.type === 'limit' && parseFloat(price) < incomingOrder.price.toNumber()) break;
        
        const orders = this.orderBook.bids.get(price) as Order[];
        if (!orders) continue;
        
        for (let i = 0; i < orders.length && remainingSize > 0; i++) {
          const buyOrder = orders[i];
          
          // Initialize order tracking properties if not present
          if (buyOrder.filledSize === undefined) buyOrder.filledSize = 0;
          
          // Ensure remainingSize is properly initialized as Decimal
          if (!buyOrder.remainingSize || !(buyOrder.remainingSize instanceof Decimal)) {
            buyOrder.remainingSize = new Decimal(buyOrder.size || 0);
          }
          
          // Self-match prevention: Cancel oldest (resting order)
          if (buyOrder.userId === incomingOrder.userId) {
            console.log(`Canceling oldest order ${buyOrder.id} to prevent self-match for user ${buyOrder.userId}`);
            this.orderBook.removeOrder(buyOrder.id);
            i--; // Adjust index since we removed an order
            continue; // Skip to next order, no match created
          }
          
          const matchSize = Math.min(remainingSize, buyOrder.remainingSize.toNumber());
          
          matches.push({
            buyOrder: buyOrder,
            sellOrder: incomingOrder,
            price: parseFloat(price),
            size: matchSize
          });
          
          remainingSize -= matchSize;
          buyOrder.remainingSize = buyOrder.remainingSize.minus(matchSize);
          buyOrder.filledSize += matchSize;
          buyOrder.lastUpdateTime = Date.now();
          
          // Update fill tracking for buy order
          if (!buyOrder.fills) buyOrder.fills = [];
          buyOrder.fills.push({
            price: buyOrder.price,
            size: buyOrder.size.minus(buyOrder.remainingSize),
            timestamp: Date.now(),
            tradeId: Date.now().toString()
          });
          
          // Update average fill price
          buyOrder.avgFillPrice = buyOrder.fills.reduce((sum, fill) => sum + (fill.price.toNumber() * fill.size.toNumber()), 0) / buyOrder.filledSize;
          if (!buyOrder.totalValue) buyOrder.totalValue = 0;
          buyOrder.totalValue += matchSize * parseFloat(price);
          
          // Update order status
          if (buyOrder.remainingSize.isZero()) {
            buyOrder.status = 'FILLED';
            this.orderBook.removeOrder(buyOrder.id);
            i--; // Adjust index since we removed an order
          } else {
            buyOrder.status = 'PARTIALLY_FILLED';
          }
        }
      }
    }

    // Update incoming order with fill tracking
    const totalFilled = incomingOrder.remainingSize.toNumber() - remainingSize;
    incomingOrder.remainingSize = incomingOrder.remainingSize.minus(totalFilled);
    incomingOrder.filledSize += totalFilled;
    incomingOrder.lastUpdateTime = Date.now();
    
    // Add fills from matches to incoming order
    if (!incomingOrder.fills) incomingOrder.fills = [];
    matches.forEach(match => {
      incomingOrder.fills!.push({
        price: incomingOrder.price,
        size: incomingOrder.size.minus(incomingOrder.remainingSize),
        timestamp: Date.now(),
        tradeId: Date.now().toString()
      });
    });
    
    // Update incoming order average fill price and status
    if (incomingOrder.filledSize > 0) {
      incomingOrder.avgFillPrice = incomingOrder.fills.reduce((sum, fill) => sum + (fill.price.toNumber() * fill.size.toNumber()), 0) / incomingOrder.filledSize;
      if (!incomingOrder.totalValue) incomingOrder.totalValue = 0;
      incomingOrder.totalValue += totalFilled * incomingOrder.avgFillPrice;
    }
    
    if (incomingOrder.remainingSize.isZero()) {
      incomingOrder.status = 'FILLED';
      this.orderBook.removeOrder(incomingOrder.id);
    } else if (incomingOrder.filledSize > 0) {
      incomingOrder.status = 'PARTIALLY_FILLED';
    }

    // Add remaining order to book if not fully filled
    if (remainingSize > 0 && incomingOrder.type === 'limit') {
      this.orderBook.addOrder(incomingOrder);
    }

    return matches;
  }
} 