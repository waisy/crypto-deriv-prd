const { OrderBook } = require('./orderbook');
const { Position } = require('./position');
const { User } = require('./user');
const { MatchingEngine } = require('./matching');
const { MarginCalculator } = require('./margin');
const { LiquidationEngine } = require('./liquidation');
const { ADLEngine } = require('./adl');

class Exchange {
  constructor() {
    this.orderBook = new OrderBook();
    this.matchingEngine = new MatchingEngine(this.orderBook);
    this.marginCalculator = new MarginCalculator();
    this.liquidationEngine = new LiquidationEngine();
    this.adlEngine = new ADLEngine();
    
    this.users = new Map();
    this.positions = new Map();
    this.trades = [];
    this.currentMarkPrice = 45000;
    this.indexPrice = 45000;
    this.fundingRate = 0.0001;
    
    // Initialize 2 users
    this.initializeUsers();
  }

  initializeUsers() {
    const user1 = new User('user1', 'User 1', 100000); // $100k balance
    const user2 = new User('user2', 'User 2', 100000); // $100k balance
    
    this.users.set('user1', user1);
    this.users.set('user2', user2);
  }

  handleMessage(data) {
    switch (data.type) {
      case 'place_order':
        return this.placeOrder(data);
      case 'cancel_order':
        return this.cancelOrder(data);
      case 'update_leverage':
        return this.updateLeverage(data);
      case 'update_mark_price':
        return this.updateMarkPrice(data.price);
      case 'force_liquidation':
        return this.forceLiquidation(data.userId);
      default:
        throw new Error(`Unknown message type: ${data.type}`);
    }
  }

  placeOrder(orderData) {
    const { userId, side, size, price, orderType, leverage } = orderData;
    
    // Validate user exists
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    // Update user leverage if provided
    if (leverage) {
      user.leverage = leverage;
    }

    // Calculate margin requirements
    const marginReq = this.marginCalculator.calculateInitialMargin(size, price, user.leverage);
    
    if (user.availableBalance < marginReq) {
      throw new Error('Insufficient margin');
    }

    // Create order
    const order = {
      id: Date.now().toString(),
      userId,
      side,
      size,
      price,
      type: orderType,
      leverage: user.leverage,
      timestamp: Date.now(),
      status: 'pending'
    };

    // Try to match the order (matching engine will add to book if needed)
    const matches = this.matchingEngine.match(order);
    
    console.log(`Order placed: ${order.side} ${order.size} BTC at ${order.price} (${order.type})`);
    console.log(`Matches found: ${matches.length}`);
    
    // Process matches
    matches.forEach(match => {
      this.processTrade(match);
    });

    // Check for liquidations after trade
    this.checkLiquidations();

    return {
      success: true,
      order,
      matches,
      state: this.getState()
    };
  }

  processTrade(match) {
    const { buyOrder, sellOrder, price, size } = match;
    
    // Create trade record
    const trade = {
      id: Date.now().toString(),
      buyUserId: buyOrder.userId,
      sellUserId: sellOrder.userId,
      price,
      size,
      timestamp: Date.now()
    };
    
    this.trades.push(trade);

    // Update positions
    this.updatePosition(buyOrder.userId, 'long', size, price, buyOrder.leverage);
    this.updatePosition(sellOrder.userId, 'short', size, price, sellOrder.leverage);

    // Update user balances
    this.updateUserBalances(buyOrder, sellOrder, price, size);
  }

  updatePosition(userId, side, size, price, leverage) {
    const positionKey = `${userId}-${side}`;
    let position = this.positions.get(positionKey);
    
    if (!position) {
      position = new Position(userId, side, size, price, leverage);
      this.positions.set(positionKey, position);
    } else {
      position.addSize(size, price);
    }

    // Calculate PnL
    position.updatePnL(this.currentMarkPrice);
    
    // Calculate margin requirements
    const marginReqs = this.marginCalculator.calculateMarginRequirements(position, this.currentMarkPrice);
    position.initialMargin = marginReqs.initial;
    position.maintenanceMargin = marginReqs.maintenance;
    
    // Calculate liquidation price
    position.liquidationPrice = this.marginCalculator.calculateLiquidationPrice(position);
  }

  updateUserBalances(buyOrder, sellOrder, price, size) {
    const buyUser = this.users.get(buyOrder.userId);
    const sellUser = this.users.get(sellOrder.userId);
    
    // Deduct margin from available balance
    const buyMargin = this.marginCalculator.calculateInitialMargin(size, price, buyOrder.leverage);
    const sellMargin = this.marginCalculator.calculateInitialMargin(size, price, sellOrder.leverage);
    
    buyUser.availableBalance -= buyMargin;
    sellUser.availableBalance -= sellMargin;
    
    buyUser.usedMargin += buyMargin;
    sellUser.usedMargin += sellMargin;
  }

  updateLeverage(data) {
    const { userId, leverage } = data;
    const user = this.users.get(userId);
    
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    
    user.leverage = leverage;
    
    // Recalculate margin requirements for all positions
    this.positions.forEach(position => {
      if (position.userId === userId) {
        const marginReqs = this.marginCalculator.calculateMarginRequirements(position, this.currentMarkPrice);
        position.initialMargin = marginReqs.initial;
        position.maintenanceMargin = marginReqs.maintenance;
        position.liquidationPrice = this.marginCalculator.calculateLiquidationPrice(position);
      }
    });

    return {
      success: true,
      state: this.getState()
    };
  }

  updateMarkPrice(newPrice) {
    this.currentMarkPrice = newPrice;
    this.indexPrice = newPrice; // Simplified - in real system these would be different
    
    // Update all position PnLs
    this.positions.forEach(position => {
      position.updatePnL(newPrice);
    });
    
    // Check for liquidations
    this.checkLiquidations();
    
    return {
      success: true,
      markPrice: newPrice,
      state: this.getState()
    };
  }

  checkLiquidations() {
    const liquidations = [];
    
    this.positions.forEach(position => {
      if (this.liquidationEngine.shouldLiquidate(position, this.currentMarkPrice)) {
        const liquidation = this.liquidationEngine.liquidate(position, this.currentMarkPrice);
        liquidations.push(liquidation);
        
        // Remove liquidated position
        const positionKey = `${position.userId}-${position.side}`;
        this.positions.delete(positionKey);
        
        // Update user balance
        const user = this.users.get(position.userId);
        user.availableBalance += liquidation.remainingBalance;
        user.usedMargin -= position.initialMargin;
      }
    });
    
    return liquidations;
  }

  forceLiquidation(userId) {
    const liquidations = [];
    
    this.positions.forEach(position => {
      if (position.userId === userId) {
        const liquidation = this.liquidationEngine.liquidate(position, this.currentMarkPrice);
        liquidations.push(liquidation);
        
        const positionKey = `${position.userId}-${position.side}`;
        this.positions.delete(positionKey);
        
        const user = this.users.get(position.userId);
        user.availableBalance += liquidation.remainingBalance;
        user.usedMargin -= position.initialMargin;
      }
    });
    
    return {
      success: true,
      liquidations,
      state: this.getState()
    };
  }

  getState() {
    return {
      users: Array.from(this.users.values()),
      positions: Array.from(this.positions.values()),
      trades: this.trades.slice(-50), // Last 50 trades
      orderBook: this.orderBook.getState(),
      markPrice: this.currentMarkPrice,
      indexPrice: this.indexPrice,
      fundingRate: this.fundingRate,
      adlQueue: this.adlEngine.getADLQueue(this.positions)
    };
  }
}

module.exports = { Exchange }; 