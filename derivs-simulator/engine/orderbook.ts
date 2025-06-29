import { Decimal } from 'decimal.js';

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'pending' | 'partial' | 'filled' | 'cancelled' | 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED';

export interface Order {
  id: string;
  userId: string;
  side: OrderSide;
  type: OrderType;
  size: Decimal;
  price: Decimal;
  remainingSize: Decimal;
  timestamp: number;
  status?: OrderStatus;
  fills?: Fill[];
  filledSize?: number;
  lastUpdateTime?: number;
  avgFillPrice?: number;
  totalValue?: number;
}

export interface Fill {
  price: Decimal;
  size: Decimal;
  timestamp: number;
  orderId?: string;
  tradeId?: string;
}

export interface OrderLevel {
  price: string;
  size: string;
  orders: number;
}

export interface OrderBookState {
  bids: OrderLevel[];
  asks: OrderLevel[];
  totalOrders: number;
  bestBid: string | null;
  bestAsk: string | null;
  spread: string | null;
}

export interface OrdersByUser {
  [userId: string]: any[];
}

export class OrderBook {
  public bids: Map<string, Order[]>; // price(string) -> [orders]
  public asks: Map<string, Order[]>; // price(string) -> [orders]
  public orders: Map<string, Order>; // orderId -> order

  constructor() {
    this.bids = new Map<string, Order[]>();
    this.asks = new Map<string, Order[]>();
    this.orders = new Map<string, Order>();
  }

  addOrder(order: Order): void {
    this.orders.set(order.id, order);
    const priceKey = order.price.toString();
    
    if (order.side === 'buy') {
      if (!this.bids.has(priceKey)) {
        this.bids.set(priceKey, []);
      }
      this.bids.get(priceKey)!.push(order);
    } else {
      if (!this.asks.has(priceKey)) {
        this.asks.set(priceKey, []);
      }
      this.asks.get(priceKey)!.push(order);
    }
  }

  removeOrder(orderId: string): boolean {
    const order = this.orders.get(orderId);
    if (!order) return false;

    this.orders.delete(orderId);
    
    const priceKey = order.price.toString();
    const priceLevel = order.side === 'buy' ? this.bids : this.asks;
    const orders = priceLevel.get(priceKey);
    
    if (orders) {
      const index = orders.findIndex(o => o.id === orderId);
      if (index !== -1) {
        orders.splice(index, 1);
        if (orders.length === 0) {
          priceLevel.delete(priceKey);
        }
      }
    }
    
    return true;
  }

  getBestBid(): Order | null {
    if (this.bids.size === 0) return null;
    const maxPrice = Math.max(...Array.from(this.bids.keys()).map(p => parseFloat(p)));
    const orders = this.bids.get(maxPrice.toString());
    return orders ? orders[0] : null;
  }

  getBestAsk(): Order | null {
    if (this.asks.size === 0) return null;
    const minPrice = Math.min(...Array.from(this.asks.keys()).map(p => parseFloat(p)));
    const orders = this.asks.get(minPrice.toString());
    return orders ? orders[0] : null;
  }

  getOrdersAtPrice(side: OrderSide, price: number | string | Decimal): Order[] {
    const priceKey = price.toString();
    const priceLevel = side === 'buy' ? this.bids : this.asks;
    return priceLevel.get(priceKey) || [];
  }

  getBidLevels(depth: number = 10): OrderLevel[] {
    const levels: OrderLevel[] = [];
    const sortedPrices = Array.from(this.bids.keys()).sort((a, b) => parseFloat(b) - parseFloat(a));
    
    for (let i = 0; i < Math.min(depth, sortedPrices.length); i++) {
      const price = sortedPrices[i];
      const orders = this.bids.get(price)!;
      const totalSize = orders.reduce((sum, order) => sum.plus(order.remainingSize), new Decimal(0));
      levels.push({ price: price, size: totalSize.toString(), orders: orders.length });
    }
    
    return levels;
  }

  getAskLevels(depth: number = 10): OrderLevel[] {
    const levels: OrderLevel[] = [];
    const sortedPrices = Array.from(this.asks.keys()).sort((a, b) => parseFloat(a) - parseFloat(b));
    
    for (let i = 0; i < Math.min(depth, sortedPrices.length); i++) {
      const price = sortedPrices[i];
      const orders = this.asks.get(price)!;
      const totalSize = orders.reduce((sum, order) => sum.plus(order.remainingSize), new Decimal(0));
      levels.push({ price: price, size: totalSize.toString(), orders: orders.length });
    }
    
    return levels;
  }

  getState(): OrderBookState {
    const bestBidOrder = this.getBestBid();
    const bestAskOrder = this.getBestAsk();
    
    return {
      bids: this.getBidLevels(),
      asks: this.getAskLevels(),
      totalOrders: this.orders.size,
      bestBid: bestBidOrder ? bestBidOrder.price.toString() : null,
      bestAsk: bestAskOrder ? bestAskOrder.price.toString() : null,
      spread: this.getSpread()
    };
  }

  getSpread(): string | null {
    const bestBid = this.getBestBid();
    const bestAsk = this.getBestAsk();
    
    if (!bestBid || !bestAsk) return null;
    return bestAsk.price.minus(bestBid.price).toString();
  }

  getUserOrders(userId: string): Order[] {
    const userOrders: Order[] = [];
    this.orders.forEach(order => {
      if (order.userId === userId) {
        userOrders.push(order);
      }
    });
    return userOrders.sort((a, b) => b.timestamp - a.timestamp); // Latest first
  }

  getOrdersByUser(): OrdersByUser {
    const userOrders: OrdersByUser = {};
    this.orders.forEach(order => {
      if (!userOrders[order.userId]) {
        userOrders[order.userId] = [];
      }
      // Sanitize order for frontend by converting Decimals to numbers
      userOrders[order.userId].push(this.toJSONOrder(order));
    });
    return userOrders;
  }

  toJSONOrder(order: Order): any {
    const sanitizedOrder: any = { ...order };
    for (const key in sanitizedOrder) {
      if (sanitizedOrder[key] instanceof Decimal) {
        sanitizedOrder[key] = sanitizedOrder[key].toString();
      }
    }
    // Also sanitize fills if they exist
    if (sanitizedOrder.fills) {
        sanitizedOrder.fills = sanitizedOrder.fills.map((fill: Fill) => this.toJSONOrder(fill as any));
    }
    return sanitizedOrder;
  }

  toJSON(): OrderBookState {
    return this.getState();
  }
} 