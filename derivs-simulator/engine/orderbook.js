class OrderBook {
  constructor() {
    this.bids = new Map(); // price -> [orders]
    this.asks = new Map(); // price -> [orders]
    this.orders = new Map(); // orderId -> order
  }

  addOrder(order) {
    this.orders.set(order.id, order);
    
    if (order.side === 'buy') {
      if (!this.bids.has(order.price)) {
        this.bids.set(order.price, []);
      }
      this.bids.get(order.price).push(order);
    } else {
      if (!this.asks.has(order.price)) {
        this.asks.set(order.price, []);
      }
      this.asks.get(order.price).push(order);
    }
  }

  removeOrder(orderId) {
    const order = this.orders.get(orderId);
    if (!order) return false;

    this.orders.delete(orderId);
    
    const priceLevel = order.side === 'buy' ? this.bids : this.asks;
    const orders = priceLevel.get(order.price);
    
    if (orders) {
      const index = orders.findIndex(o => o.id === orderId);
      if (index !== -1) {
        orders.splice(index, 1);
        if (orders.length === 0) {
          priceLevel.delete(order.price);
        }
      }
    }
    
    return true;
  }

  getBestBid() {
    if (this.bids.size === 0) return null;
    const maxPrice = Math.max(...this.bids.keys());
    return this.bids.get(maxPrice)[0];
  }

  getBestAsk() {
    if (this.asks.size === 0) return null;
    const minPrice = Math.min(...this.asks.keys());
    return this.asks.get(minPrice)[0];
  }

  getOrdersAtPrice(side, price) {
    const priceLevel = side === 'buy' ? this.bids : this.asks;
    return priceLevel.get(price) || [];
  }

  getBidLevels(depth = 10) {
    const levels = [];
    const sortedPrices = Array.from(this.bids.keys()).sort((a, b) => b - a);
    
    for (let i = 0; i < Math.min(depth, sortedPrices.length); i++) {
      const price = sortedPrices[i];
      const orders = this.bids.get(price);
      const totalSize = orders.reduce((sum, order) => sum + order.size, 0);
      levels.push({ price, size: totalSize, orders: orders.length });
    }
    
    return levels;
  }

  getAskLevels(depth = 10) {
    const levels = [];
    const sortedPrices = Array.from(this.asks.keys()).sort((a, b) => a - b);
    
    for (let i = 0; i < Math.min(depth, sortedPrices.length); i++) {
      const price = sortedPrices[i];
      const orders = this.asks.get(price);
      const totalSize = orders.reduce((sum, order) => sum + order.size, 0);
      levels.push({ price, size: totalSize, orders: orders.length });
    }
    
    return levels;
  }

  getState() {
    return {
      bids: this.getBidLevels(),
      asks: this.getAskLevels(),
      totalOrders: this.orders.size,
      bestBid: this.getBestBid()?.price || null,
      bestAsk: this.getBestAsk()?.price || null,
      spread: this.getSpread()
    };
  }

  getSpread() {
    const bestBid = this.getBestBid();
    const bestAsk = this.getBestAsk();
    
    if (!bestBid || !bestAsk) return null;
    return bestAsk.price - bestBid.price;
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
}

module.exports = { OrderBook }; 