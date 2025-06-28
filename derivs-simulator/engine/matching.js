class MatchingEngine {
  constructor(orderBook) {
    this.orderBook = orderBook;
  }

  match(incomingOrder) {
    const matches = [];
    let remainingSize = incomingOrder.remainingSize;

    if (incomingOrder.side === 'buy') {
      // For buy orders, match against asks (sell orders)
      const askLevels = Array.from(this.orderBook.asks.keys()).sort((a, b) => a - b);
      
      for (const price of askLevels) {
        if (remainingSize <= 0) break;
        if (incomingOrder.type === 'limit' && price > incomingOrder.price) break;
        
        const orders = this.orderBook.asks.get(price);
        for (let i = 0; i < orders.length && remainingSize > 0; i++) {
          const sellOrder = orders[i];
          
          // Self-match prevention: Cancel oldest (resting order)
          if (sellOrder.userId === incomingOrder.userId) {
            console.log(`Canceling oldest order ${sellOrder.id} to prevent self-match for user ${sellOrder.userId}`);
            this.orderBook.removeOrder(sellOrder.id);
            i--; // Adjust index since we removed an order
            continue; // Skip to next order, no match created
          }
          
          const matchSize = Math.min(remainingSize, sellOrder.remainingSize);
          
          matches.push({
            buyOrder: incomingOrder,
            sellOrder: sellOrder,
            price: price,
            size: matchSize
          });
          
          remainingSize -= matchSize;
          sellOrder.remainingSize -= matchSize;
          sellOrder.filledSize += matchSize;
          sellOrder.lastUpdateTime = Date.now();
          
          // Update fill tracking for sell order
          sellOrder.fills.push({
            price: price,
            size: matchSize,
            timestamp: Date.now(),
            tradeId: Date.now().toString()
          });
          
          // Update average fill price
          sellOrder.avgFillPrice = sellOrder.fills.reduce((sum, fill) => sum + (fill.price * fill.size), 0) / sellOrder.filledSize;
          sellOrder.totalValue += matchSize * price;
          
          // Update order status
          if (sellOrder.remainingSize === 0) {
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
      const bidLevels = Array.from(this.orderBook.bids.keys()).sort((a, b) => b - a);
      
      for (const price of bidLevels) {
        if (remainingSize <= 0) break;
        if (incomingOrder.type === 'limit' && price < incomingOrder.price) break;
        
        const orders = this.orderBook.bids.get(price);
        for (let i = 0; i < orders.length && remainingSize > 0; i++) {
          const buyOrder = orders[i];
          
          // Self-match prevention: Cancel oldest (resting order)
          if (buyOrder.userId === incomingOrder.userId) {
            console.log(`Canceling oldest order ${buyOrder.id} to prevent self-match for user ${buyOrder.userId}`);
            this.orderBook.removeOrder(buyOrder.id);
            i--; // Adjust index since we removed an order
            continue; // Skip to next order, no match created
          }
          
          const matchSize = Math.min(remainingSize, buyOrder.remainingSize);
          
          matches.push({
            buyOrder: buyOrder,
            sellOrder: incomingOrder,
            price: price,
            size: matchSize
          });
          
          remainingSize -= matchSize;
          buyOrder.remainingSize -= matchSize;
          buyOrder.filledSize += matchSize;
          buyOrder.lastUpdateTime = Date.now();
          
          // Update fill tracking for buy order
          buyOrder.fills.push({
            price: price,
            size: matchSize,
            timestamp: Date.now(),
            tradeId: Date.now().toString()
          });
          
          // Update average fill price
          buyOrder.avgFillPrice = buyOrder.fills.reduce((sum, fill) => sum + (fill.price * fill.size), 0) / buyOrder.filledSize;
          buyOrder.totalValue += matchSize * price;
          
          // Update order status
          if (buyOrder.remainingSize === 0) {
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
    const totalFilled = incomingOrder.remainingSize - remainingSize;
    incomingOrder.remainingSize = remainingSize;
    incomingOrder.filledSize += totalFilled;
    incomingOrder.lastUpdateTime = Date.now();
    
    // Add fills from matches to incoming order
    matches.forEach(match => {
      incomingOrder.fills.push({
        price: match.price,
        size: match.size,
        timestamp: Date.now(),
        tradeId: Date.now().toString()
      });
    });
    
    // Update incoming order average fill price and status
    if (incomingOrder.filledSize > 0) {
      incomingOrder.avgFillPrice = incomingOrder.fills.reduce((sum, fill) => sum + (fill.price * fill.size), 0) / incomingOrder.filledSize;
      incomingOrder.totalValue += totalFilled * incomingOrder.avgFillPrice;
    }
    
    if (incomingOrder.remainingSize === 0) {
      incomingOrder.status = 'FILLED';
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

module.exports = { MatchingEngine }; 