class MatchingEngine {
  constructor(orderBook) {
    this.orderBook = orderBook;
  }

  match(incomingOrder) {
    const matches = [];
    let remainingSize = incomingOrder.size;

    if (incomingOrder.side === 'buy') {
      // For buy orders, match against asks (sell orders)
      const askLevels = Array.from(this.orderBook.asks.keys()).sort((a, b) => a - b);
      
      for (const price of askLevels) {
        if (remainingSize <= 0) break;
        if (incomingOrder.type === 'limit' && price > incomingOrder.price) break;
        
        const orders = this.orderBook.asks.get(price);
        for (let i = 0; i < orders.length && remainingSize > 0; i++) {
          const sellOrder = orders[i];
          const matchSize = Math.min(remainingSize, sellOrder.size);
          
          matches.push({
            buyOrder: incomingOrder,
            sellOrder: sellOrder,
            price: price,
            size: matchSize
          });
          
          remainingSize -= matchSize;
          sellOrder.size -= matchSize;
          
          // Remove order if fully filled
          if (sellOrder.size === 0) {
            this.orderBook.removeOrder(sellOrder.id);
            i--; // Adjust index since we removed an order
          }
        }
      }
    } else {
      // For sell orders, match against bids (buy orders)
      const bidLevels = Array.from(this.orderBook.bids.keys()).sort((a, b) => b - a);
      
      for (const price of bidLevels) {
        if (remainingSize <= 0) break;
        if (incomingOrder.type === 'limit' && price < incomingOrder.price) break;
        
        const orders = this.orderBook.bids.get(price);
        for (let i = 0; i < orders.length && remainingSize > 0; i++) {
          const buyOrder = orders[i];
          const matchSize = Math.min(remainingSize, buyOrder.size);
          
          matches.push({
            buyOrder: buyOrder,
            sellOrder: incomingOrder,
            price: price,
            size: matchSize
          });
          
          remainingSize -= matchSize;
          buyOrder.size -= matchSize;
          
          // Remove order if fully filled
          if (buyOrder.size === 0) {
            this.orderBook.removeOrder(buyOrder.id);
            i--; // Adjust index since we removed an order
          }
        }
      }
    }

    // Add remaining order to book if not fully filled
    if (remainingSize > 0 && incomingOrder.type === 'limit') {
      incomingOrder.size = remainingSize;
      this.orderBook.addOrder(incomingOrder);
    }

    return matches;
  }
}

module.exports = { MatchingEngine }; 