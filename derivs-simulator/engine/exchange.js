const { Decimal } = require('decimal.js');
const { OrderBook } = require('./orderbook');
const { Position } = require('./position');
const { User } = require('./user');
const { MatchingEngine } = require('./matching');
const { MarginCalculator } = require('./margin');
const { LiquidationEngine } = require('./liquidation');
const { ADLEngine } = require('./adl');
const { MarginMonitor } = require('./margin-monitor');

class Exchange {
  constructor() {
    this.orderBook = new OrderBook();
    this.matchingEngine = new MatchingEngine(this.orderBook);
    this.marginCalculator = new MarginCalculator();
    this.adlEngine = new ADLEngine();
    this.liquidationEngine = new LiquidationEngine(this.matchingEngine, this.orderBook, this.marginCalculator, this.adlEngine);
    this.marginMonitor = new MarginMonitor(this.marginCalculator);
    
    this.users = new Map();
    this.positions = new Map();
    this.trades = [];
    this.currentMarkPrice = new Decimal(45000);
    this.indexPrice = new Decimal(45000);
    this.fundingRate = new Decimal(0.0001);
    
    // Risk limits
    this.riskLimits = {
      maxPositionSize: 10.0,        // 10 BTC max position size
      maxLeverage: 100,             // 100x max leverage
      maxPositionValue: 1000000,    // $1M max position value
      maxUserPositions: 1,          // 1 position per user (one-way mode)
      minOrderSize: 0.001           // 0.001 BTC minimum order
    };
    
    // Initialize 2 users
    this.initializeUsers();
  }

  initializeUsers() {
    const bob = new User('bob', 'Bob', 100000); // $100k balance
    const eve = new User('eve', 'Eve', 100000); // $100k balance
    
    this.users.set('bob', bob);
    this.users.set('eve', eve);
  }

  async handleMessage(data) {
    switch (data.type) {
      case 'place_order':
        return await this.placeOrder(data);
      case 'cancel_order':
        return this.cancelOrder(data);
      case 'update_leverage':
        return this.updateLeverage(data);
      case 'update_mark_price':
        return await this.updateMarkPrice(data.price);
      case 'force_liquidation':
        return await this.forceLiquidation(data.userId);
      default:
        throw new Error(`Unknown message type: ${data.type}`);
    }
  }

  async placeOrder(orderData) {
    const { userId, side, size, price, orderType, leverage } = orderData;
    
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    this.validateRiskLimits(userId, side, size, price, leverage || user.leverage);

    if (leverage) {
      user.leverage = leverage;
    }

    const decSize = new Decimal(size);
    const decPrice = new Decimal(price || this.currentMarkPrice);
    const marginReq = this.marginCalculator.calculateInitialMargin(decSize, decPrice, user.leverage);
    
    if (user.availableBalance.lessThan(marginReq)) {
      throw new Error('Insufficient margin');
    }

    const order = {
      id: Date.now().toString(),
      userId,
      side,
      originalSize: decSize,
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

    const matches = this.matchingEngine.match(order);
    
    matches.forEach(match => {
      this.processTrade(match);
    });

    let liquidations = [];
    try {
      liquidations = await this.checkLiquidations();
    } catch (error) {
      console.error('Liquidation check failed:', error);
    }

    return {
      success: true,
      order,
      matches,
      liquidations: liquidations.length > 0 ? liquidations : undefined,
      state: this.getState()
    };
  }

  cancelOrder(data) {
    const { orderId } = data;
    
    const success = this.orderBook.removeOrder(orderId);
    
    if (!success) {
      throw new Error(`Order ${orderId} not found`);
    }

    console.log(`Order ${orderId} cancelled`);

    return {
      success: true,
      orderId,
      state: this.getState()
    };
  }

  processTrade(match) {
    const { buyOrder, sellOrder, price, size } = match;
    
    const trade = {
      id: Date.now().toString(),
      buyUserId: buyOrder.userId,
      sellUserId: sellOrder.userId,
      price,
      size,
      timestamp: Date.now()
    };
    
    this.trades.push(trade);

    const decPrice = new Decimal(price);
    const decSize = new Decimal(size);

    this.updatePosition(buyOrder.userId, 'long', decSize, decPrice, buyOrder.leverage);
    this.updatePosition(sellOrder.userId, 'short', decSize, decPrice, sellOrder.leverage);

    this.updateUserBalances(buyOrder, sellOrder, decPrice, decSize);
  }

  updatePosition(userId, side, size, price, leverage) {
    const positionKey = userId;
    let position = this.positions.get(positionKey);
    let realizedPnL = new Decimal(0);
    
    if (!position) {
      position = new Position(userId, side, size, price, leverage);
      this.positions.set(positionKey, position);
    } else {
      if (position.side === side) {
        position.addSize(size, price);
      } else {
        if (size.lessThan(position.size)) {
          realizedPnL = position.reduceSize(size, price);
        } else if (size.equals(position.size)) {
          realizedPnL = position.closePosition(price);
          this.positions.delete(positionKey);
          
          const user = this.users.get(userId);
          user.updateBalance(realizedPnL);
          user.usedMargin = user.usedMargin.minus(position.initialMargin);
          return;
        } else {
          const excessSize = size.minus(position.size);
          realizedPnL = position.closePosition(price);
          
          this.positions.delete(positionKey);
          position = new Position(userId, side, excessSize, price, leverage);
          this.positions.set(positionKey, position);
        }
        
        const user = this.users.get(userId);
        user.updateBalance(realizedPnL);
        
        if (size.greaterThanOrEqualTo(position.size)) {
          user.usedMargin = user.usedMargin.minus(position.initialMargin);
        }
      }
    }

    if (this.positions.has(positionKey)) {
      position = this.positions.get(positionKey);
      position.updatePnL(this.currentMarkPrice);
      
      const marginReqs = this.marginCalculator.calculateMarginRequirements(position, this.currentMarkPrice);
      position.initialMargin = marginReqs.initial;
      position.maintenanceMargin = marginReqs.maintenance;
      
      position.liquidationPrice = this.marginCalculator.calculateLiquidationPrice(position);
    }
  }

  updateUserBalances(buyOrder, sellOrder, price, size) {
    const buyUser = this.users.get(buyOrder.userId);
    const sellUser = this.users.get(sellOrder.userId);

    const buyMargin = this.marginCalculator.calculateInitialMargin(size, price, buyOrder.leverage);
    const sellMargin = this.marginCalculator.calculateInitialMargin(size, price, sellOrder.leverage);
    
    buyUser.availableBalance = buyUser.availableBalance.minus(buyMargin);
    sellUser.availableBalance = sellUser.availableBalance.minus(sellMargin);
    
    buyUser.usedMargin = buyUser.usedMargin.plus(buyMargin);
    sellUser.usedMargin = sellUser.usedMargin.plus(sellMargin);
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

  async updateMarkPrice(newPrice) {
    this.currentMarkPrice = new Decimal(newPrice);
    this.indexPrice = new Decimal(newPrice);
    
    this.positions.forEach(position => {
      position.updatePnL(this.currentMarkPrice);
    });
    
    const liquidations = await this.checkLiquidations();

    return {
      success: true,
      newPrice,
      liquidations,
      state: this.getState()
    };
  }

  async checkLiquidations() {
    const liquidations = [];
    for (const [userId, position] of this.positions.entries()) {
      if (this.liquidationEngine.shouldLiquidate(position, this.currentMarkPrice)) {
        console.log(`Liquidating ${userId}...`);
        const result = await this.liquidationEngine.liquidate(position, this.currentMarkPrice, this.positions);
        liquidations.push(result);
        
        // Remove position after liquidation
        this.positions.delete(userId);
      }
    }
    return liquidations;
  }

  async forceLiquidation(userId) {
    const position = this.positions.get(userId);
    if (!position) {
      throw new Error(`Position for user ${userId} not found.`);
    }

    console.log(`Force liquidating ${userId}...`);
    const result = await this.liquidationEngine.liquidate(position, this.currentMarkPrice, this.positions, true);
    
    // Remove position after liquidation
    this.positions.delete(userId);

    return {
      success: true,
      liquidationResult: result,
      state: this.getState()
    };
  }

  validateRiskLimits(userId, side, size, price, leverage) {
    const decSize = new Decimal(size);
    const decPrice = new Decimal(price || this.currentMarkPrice);
    const decLeverage = new Decimal(leverage);

    if (decSize.lessThan(this.riskLimits.minOrderSize)) {
      throw new Error(`Order size too small. Minimum: ${this.riskLimits.minOrderSize} BTC`);
    }
    
    if (decSize.greaterThan(this.riskLimits.maxPositionSize)) {
      throw new Error(`Order size too large. Maximum: ${this.riskLimits.maxPositionSize} BTC`);
    }
    
    if (decLeverage.greaterThan(this.riskLimits.maxLeverage)) {
      throw new Error(`Leverage too high. Maximum: ${this.riskLimits.maxLeverage}x`);
    }
    
    const positionValue = decSize.times(decPrice);
    if (positionValue.greaterThan(this.riskLimits.maxPositionValue)) {
      throw new Error(`Position value too large. Maximum: $${this.riskLimits.maxPositionValue.toLocaleString()}`);
    }

    const existingPosition = this.positions.get(userId);
    if (existingPosition && existingPosition.side === side) {
      const totalSize = existingPosition.size.plus(decSize);
      if (totalSize.greaterThan(this.riskLimits.maxPositionSize)) {
        throw new Error(`Total position size would exceed limit.`);
      }
      
      const totalValue = totalSize.times(decPrice);
      if (totalValue.greaterThan(this.riskLimits.maxPositionValue)) {
        throw new Error(`Total position value would exceed limit.`);
      }
    }
  }

  getState() {
    return {
      users: Array.from(this.users.values()).map(u => u.toJSON()),
      positions: Array.from(this.positions.values()).map(p => p.toJSON()),
      orderBook: this.orderBook.toJSON(),
      trades: this.trades.slice(-20),
      markPrice: this.currentMarkPrice.toString(),
      indexPrice: this.indexPrice.toString(),
      fundingRate: this.fundingRate.toString(),
      insuranceFund: {
        balance: this.liquidationEngine.getInsuranceFundBalance(),
        isAtRisk: this.liquidationEngine.isSystemAtRisk()
      },
      userOrders: this.orderBook.getOrdersByUser(),
      adlQueue: this.adlEngine.getQueue(this.positions),
      marginCalls: this.marginMonitor.getActiveMarginCalls()
    };
  }
}

module.exports = { Exchange };