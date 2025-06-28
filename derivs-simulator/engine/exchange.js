const { OrderBook } = require('./orderbook');
const { Position } = require('./position');
const { User } = require('./user');
const { MatchingEngine } = require('./matching');
const { MarginCalculator } = require('./margin');
const { LiquidationEngine } = require('./liquidation');
const { ADLEngine } = require('./adl');
const { MarginMonitor } = require('./margin-monitor');
const { PerformanceOptimizer } = require('./performance-optimizer');

class Exchange {
  constructor() {
    this.orderBook = new OrderBook();
    this.matchingEngine = new MatchingEngine(this.orderBook);
    this.marginCalculator = new MarginCalculator();
    this.liquidationEngine = new LiquidationEngine(this.matchingEngine, this.orderBook, this.marginCalculator);
    this.adlEngine = new ADLEngine();
    this.marginMonitor = new MarginMonitor(this.marginCalculator);
    this.performanceOptimizer = new PerformanceOptimizer();
    
    this.users = new Map();
    this.positions = new Map();
    this.trades = [];
    this.currentMarkPrice = 45000;
    this.indexPrice = 45000;
    this.fundingRate = 0.0001;
    
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
        return this.placeOrder(data);
      case 'cancel_order':
        return this.cancelOrder(data);
      case 'update_leverage':
        return this.updateLeverage(data);
      case 'update_mark_price':
        return this.updateMarkPrice(data.price);
      case 'force_liquidation':
        return await this.forceLiquidation(data.userId);
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

    // Risk limit validations
    this.validateRiskLimits(userId, side, size, price, leverage || user.leverage);

    // Update user leverage if provided
    if (leverage) {
      user.leverage = leverage;
    }

    // Calculate margin requirements
    const marginReq = this.marginCalculator.calculateInitialMargin(size, price, user.leverage);
    
    if (user.availableBalance < marginReq) {
      throw new Error('Insufficient margin');
    }

    // Create order with comprehensive tracking
    const order = {
      id: Date.now().toString(),
      userId,
      side,
      originalSize: size,
      remainingSize: size,
      filledSize: 0,
      price,
      avgFillPrice: 0,
      type: orderType,
      leverage: user.leverage,
      timestamp: Date.now(),
      lastUpdateTime: Date.now(),
      status: 'NEW',
      timeInForce: 'GTC', // Good Till Cancelled
      fills: [],
      totalValue: 0,
      commission: 0,
      marginReserved: marginReq
    };

    // Try to match the order (matching engine will add to book if needed)
    const matches = this.matchingEngine.match(order);
    
    console.log(`Order placed: ${order.side} ${order.originalSize} BTC at ${order.price} (${order.type})`);
    console.log(`Matches found: ${matches.length}`);
    
    // Process matches
    matches.forEach(match => {
      this.processTrade(match);
    });

    // Check for liquidations after trade (async)
    this.checkLiquidations().catch(error => {
      console.error('Liquidation check failed:', error);
    });

    return {
      success: true,
      order,
      matches,
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
    const positionKey = userId; // One-way mode: one position per user
    let position = this.positions.get(positionKey);
    let realizedPnL = 0;
    
    if (!position) {
      // No existing position - create new one
      position = new Position(userId, side, size, price, leverage);
      this.positions.set(positionKey, position);
      
      // Index new position for performance optimization
      const user = this.users.get(userId);
      if (user) {
        const marginStatus = this.marginCalculator.calculateMarginRatio(position, user.availableBalance, this.currentMarkPrice);
        this.performanceOptimizer.indexPosition(position, {
          marginRatio: marginStatus,
          liquidationPrice: this.marginCalculator.calculateLiquidationPrice(position),
          maintenanceMargin: this.marginCalculator.calculateMaintenanceMargin(position.size, this.currentMarkPrice)
        });
      }
      
      console.log(`Created new ${side} position for ${userId}: ${size} BTC @ $${price}`);
    } else {
      // Existing position - handle netting
      if (position.side === side) {
        // Same direction - add to position
        position.addSize(size, price);
        console.log(`Added to ${side} position for ${userId}: +${size} BTC @ $${price} (total: ${position.size} BTC)`);
      } else {
        // Opposite direction - net positions
        if (size < position.size) {
          // Reduce existing position
          realizedPnL = position.reduceSize(size, price);
          console.log(`Reduced ${position.side} position for ${userId}: -${size} BTC @ $${price} (remaining: ${position.size} BTC, realized PnL: $${realizedPnL.toFixed(2)})`);
        } else if (size === position.size) {
          // Close position completely
          realizedPnL = position.closePosition(price);
          this.positions.delete(positionKey);
          
          // Remove from performance optimizer indices
          this.performanceOptimizer.removeFromIndices(userId);
          
          console.log(`Closed ${position.side} position for ${userId}: ${size} BTC @ $${price} (realized PnL: $${realizedPnL.toFixed(2)})`);
          
          // Update user balance with realized PnL
          const user = this.users.get(userId);
          user.availableBalance += realizedPnL;
          user.usedMargin -= position.initialMargin;
          return; // Position closed, no further updates needed
        } else {
          // Flip position direction
          const excessSize = size - position.size;
          realizedPnL = position.closePosition(price);
          
          // Remove old position from indices
          this.performanceOptimizer.removeFromIndices(userId);
          
          // Create new position in opposite direction with excess size
          this.positions.delete(positionKey);
          position = new Position(userId, side, excessSize, price, leverage);
          this.positions.set(positionKey, position);
          
          // Index new position
          const user = this.users.get(userId);
          if (user) {
            const marginStatus = this.marginCalculator.calculateMarginRatio(position, user.availableBalance, this.currentMarkPrice);
            this.performanceOptimizer.indexPosition(position, {
              marginRatio: marginStatus,
              liquidationPrice: this.marginCalculator.calculateLiquidationPrice(position),
              maintenanceMargin: this.marginCalculator.calculateMaintenanceMargin(position.size, this.currentMarkPrice)
            });
          }
          
          console.log(`Flipped position for ${userId}: closed ${position.side} and opened ${side} ${excessSize} BTC @ $${price} (realized PnL: $${realizedPnL.toFixed(2)})`);
        }
        
        // Update user balance with realized PnL
        const user = this.users.get(userId);
        user.availableBalance += realizedPnL;
        
        // Adjust used margin for partial/full closures
        if (size >= position.size) {
          user.usedMargin -= position.initialMargin;
        }
      }
    }

    // Calculate PnL for remaining/new position
    if (this.positions.has(positionKey)) {
      position = this.positions.get(positionKey);
      position.updatePnL(this.currentMarkPrice);
      
      // Calculate margin requirements
      const marginReqs = this.marginCalculator.calculateMarginRequirements(position, this.currentMarkPrice);
      position.initialMargin = marginReqs.initial;
      position.maintenanceMargin = marginReqs.maintenance;
      
      // Calculate liquidation price
      position.liquidationPrice = this.marginCalculator.calculateLiquidationPrice(position);
    }
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
    
    // Batch update positions for performance optimization
    const performanceUpdates = this.performanceOptimizer.batchUpdatePositions(
      this.positions, 
      this.users, 
      newPrice, 
      this.marginCalculator
    );
    
    // Monitor margin calls (using regular monitoring for now, could be optimized too)
    const marginCallUpdates = this.marginMonitor.monitorPositions(this.positions, this.users, newPrice);
    
    // Check for liquidations (async, now optimized)
    this.checkLiquidations().catch(error => {
      console.error('Liquidation check failed:', error);
    });
    
    // Cleanup expired cache entries periodically
    if (Date.now() % 10000 < 1000) { // Every ~10 seconds
      const cleaned = this.performanceOptimizer.cleanupCache();
      if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} expired cache entries`);
      }
    }
    
    return {
      success: true,
      markPrice: newPrice,
      marginCalls: marginCallUpdates,
      performanceUpdates: performanceUpdates.length,
      state: this.getState()
    };
  }

  async checkLiquidations() {
    const liquidations = [];
    
    // Use performance optimizer to get only at-risk positions
    const liquidationCandidates = this.performanceOptimizer.getLiquidationCandidates(
      this.currentMarkPrice, 
      this.marginCalculator
    );
    
    console.log(`Checking ${liquidationCandidates.length} liquidation candidates (optimized)`);
    
    for (const candidate of liquidationCandidates) {
      const { position } = candidate;
      
      try {
        console.log(`Liquidating position for ${position.userId}: ${position.side} ${position.size} BTC`);
        
        const liquidation = await this.liquidationEngine.liquidate(position, this.currentMarkPrice);
        liquidations.push(liquidation);
        
        // Remove liquidated position
        const positionKey = position.userId; // One-way mode: userId only
        this.positions.delete(positionKey);
        
        // Remove from performance optimizer indices
        this.performanceOptimizer.removeFromIndices(position.userId);
        
        // Update user balance
        const user = this.users.get(position.userId);
        if (user) {
          user.availableBalance += liquidation.remainingBalance;
          user.usedMargin -= position.initialMargin;
        }
        
        // Clear margin call for liquidated user
        this.marginMonitor.clearMarginCall(position.userId);
        
        // Check if ADL is needed due to insurance fund impact
        if (liquidation.insuranceFundLoss > 0 && this.liquidationEngine.isSystemAtRisk()) {
          console.warn(`Insurance fund impact: $${liquidation.insuranceFundLoss}. ADL may be triggered.`);
          // Future: Auto-trigger ADL here
        }
        
      } catch (error) {
        console.error(`Liquidation failed for ${position.userId}:`, error);
        // Add to liquidation queue for retry
        this.liquidationEngine.addToLiquidationQueue(position, 'urgent');
      }
    }
    
    return liquidations;
  }

  async forceLiquidation(userId) {
    const liquidations = [];
    
    // Create array from positions to avoid modification during iteration
    const positionsArray = Array.from(this.positions.values());
    
    for (const position of positionsArray) {
      if (position.userId === userId) {
        try {
          console.log(`Force liquidating position for ${userId}: ${position.side} ${position.size} BTC`);
          
          const liquidation = await this.liquidationEngine.liquidate(position, this.currentMarkPrice, true); // Force mode
          liquidations.push(liquidation);
          
          const positionKey = position.userId; // One-way mode: userId only
          this.positions.delete(positionKey);
          
          const user = this.users.get(position.userId);
          if (user) {
            user.availableBalance += liquidation.remainingBalance;
            user.usedMargin -= position.initialMargin;
          }
          
          // Clear margin call for liquidated user
          this.marginMonitor.clearMarginCall(userId);
          
        } catch (error) {
          console.error(`Force liquidation failed for ${userId}:`, error);
          throw error;
        }
      }
    }
    
    if (liquidations.length === 0) {
      throw new Error(`No position found for user ${userId}`);
    }
    
    return {
      success: true,
      liquidations,
      state: this.getState()
    };
  }

  // NEW: Risk limit validation
  validateRiskLimits(userId, side, size, price, leverage) {
    // Validate order size
    if (size < this.riskLimits.minOrderSize) {
      throw new Error(`Order size too small. Minimum: ${this.riskLimits.minOrderSize} BTC`);
    }
    
    if (size > this.riskLimits.maxPositionSize) {
      throw new Error(`Order size too large. Maximum: ${this.riskLimits.maxPositionSize} BTC`);
    }
    
    // Validate leverage
    if (leverage > this.riskLimits.maxLeverage) {
      throw new Error(`Leverage too high. Maximum: ${this.riskLimits.maxLeverage}x`);
    }
    
    // Validate position value
    const positionValue = size * price;
    if (positionValue > this.riskLimits.maxPositionValue) {
      throw new Error(`Position value too large. Maximum: $${this.riskLimits.maxPositionValue.toLocaleString()}`);
    }
    
    // Check if user already has max positions (one-way mode allows only 1)
    const existingPosition = this.positions.get(userId);
    if (existingPosition && existingPosition.side !== side) {
      // This is fine - it will net the position
    }
    
    // Validate total exposure if adding to existing position
    if (existingPosition && existingPosition.side === side) {
      const totalSize = existingPosition.size + size;
      if (totalSize > this.riskLimits.maxPositionSize) {
        throw new Error(`Total position size would exceed limit. Maximum: ${this.riskLimits.maxPositionSize} BTC`);
      }
      
      const totalValue = totalSize * price;
      if (totalValue > this.riskLimits.maxPositionValue) {
        throw new Error(`Total position value would exceed limit. Maximum: $${this.riskLimits.maxPositionValue.toLocaleString()}`);
      }
    }
  }

  getState() {
    return {
      users: Array.from(this.users.values()),
      positions: Array.from(this.positions.values()),
      trades: this.trades.slice(-50), // Last 50 trades
      orderBook: this.orderBook.getState(),
      userOrders: {
        bob: this.orderBook.getUserOrders('bob'),
        eve: this.orderBook.getUserOrders('eve')
      },
      markPrice: this.currentMarkPrice,
      indexPrice: this.indexPrice,
      fundingRate: this.fundingRate,
      adlQueue: this.adlEngine.getADLQueue(this.positions),
      insuranceFund: {
        balance: this.liquidationEngine.getInsuranceFundBalance(),
        isAtRisk: this.liquidationEngine.isSystemAtRisk()
      },
      marginCalls: this.marginMonitor.getActiveMarginCalls(),
      marginSummary: this.marginMonitor.getMarginSummary(this.positions, this.users, this.currentMarkPrice),
      riskLimits: this.riskLimits,
      liquidationQueue: this.liquidationEngine.getQueueStatus(),
      performance: this.performanceOptimizer.getPerformanceMetrics(),
      atRiskPositions: this.performanceOptimizer.getAtRiskPositions()
    };
  }
}

module.exports = { Exchange }; 