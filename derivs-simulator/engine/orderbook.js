const { Decimal } = require('decimal.js');

class OrderBook {
  constructor() {
    this.bids = new Map(); // price(string) -> [orders]
    this.asks = new Map(); // price(string) -> [orders]
    this.orders = new Map(); // orderId -> order
  }

  addOrder(order) {
    this.orders.set(order.id, order);
    const priceKey = order.price.toString();
    
    if (order.side === 'buy') {
      if (!this.bids.has(priceKey)) {
        this.bids.set(priceKey, []);
      }
      this.bids.get(priceKey).push(order);
    } else {
      if (!this.asks.has(priceKey)) {
        this.asks.set(priceKey, []);
      }
      this.asks.get(priceKey).push(order);
    }
  }

  removeOrder(orderId) {
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

  getBestBid() {
    if (this.bids.size === 0) return null;
    const maxPrice = Math.max(...Array.from(this.bids.keys()).map(p => parseFloat(p)));
    return this.bids.get(maxPrice.toString())[0];
  }

  getBestAsk() {
    if (this.asks.size === 0) return null;
    const minPrice = Math.min(...Array.from(this.asks.keys()).map(p => parseFloat(p)));
    return this.asks.get(minPrice.toString())[0];
  }

  getOrdersAtPrice(side, price) {
    const priceKey = price.toString();
    const priceLevel = side === 'buy' ? this.bids : this.asks;
    return priceLevel.get(priceKey) || [];
  }

  getBidLevels(depth = 10) {
    const levels = [];
    const sortedPrices = Array.from(this.bids.keys()).sort((a, b) => parseFloat(b) - parseFloat(a));
    
    for (let i = 0; i < Math.min(depth, sortedPrices.length); i++) {
      const price = sortedPrices[i];
      const orders = this.bids.get(price);
      const totalSize = orders.reduce((sum, order) => sum.plus(order.remainingSize), new Decimal(0));
      levels.push({ price: price, size: totalSize.toString(), orders: orders.length });
    }
    
    return levels;
  }

  getAskLevels(depth = 10) {
    const levels = [];
    const sortedPrices = Array.from(this.asks.keys()).sort((a, b) => parseFloat(a) - parseFloat(b));
    
    for (let i = 0; i < Math.min(depth, sortedPrices.length); i++) {
      const price = sortedPrices[i];
      const orders = this.asks.get(price);
      const totalSize = orders.reduce((sum, order) => sum.plus(order.remainingSize), new Decimal(0));
      levels.push({ price: price, size: totalSize.toString(), orders: orders.length });
    }
    
    return levels;
  }

  getState() {
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

  getSpread() {
    const bestBid = this.getBestBid();
    const bestAsk = this.getBestAsk();
    
    if (!bestBid || !bestAsk) return null;
    return bestAsk.price.minus(bestBid.price).toString();
  }

  getUserOrders(userId) {
    const userOrders = [];
    this.orders.forEach(order => {
      if (order.userId === userId) {
        userOrders.push(order);
      }
    });
    return userOrders.sort((a, b) => b.timestamp - a.timestamp); // Latest first
  }

  getOrdersByUser() {
    const userOrders = {};
    this.orders.forEach(order => {
      if (!userOrders[order.userId]) {
        userOrders[order.userId] = [];
      }
      // Sanitize order for frontend by converting Decimals to numbers
      userOrders[order.userId].push(this.toJSONOrder(order));
    });
    return userOrders;
  }

  toJSONOrder(order) {
    const sanitizedOrder = { ...order };
    for (const key in sanitizedOrder) {
      if (sanitizedOrder[key] instanceof Decimal) {
        sanitizedOrder[key] = sanitizedOrder[key].toNumber();
      }
    }
    // Also sanitize fills if they exist
    if (sanitizedOrder.fills) {
        sanitizedOrder.fills = sanitizedOrder.fills.map(fill => this.toJSONOrder(fill));
    }
    return sanitizedOrder;
  }

  toJSON() {
    return this.getState();
  }
}

module.exports = { OrderBook }; 