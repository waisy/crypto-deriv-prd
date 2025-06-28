const { Decimal } = require('decimal.js');
const { OrderBook } = require('./orderbook');
const { Position } = require('./position');
const { User } = require('./user');
const { MatchingEngine } = require('./matching');
const { MarginCalculator } = require('./margin');
const { LiquidationEngine } = require('./liquidation');
const { ADLEngine } = require('./adl');
const { MarginMonitor } = require('./margin-monitor');
const PositionLiquidationEngine = require('./liquidation-engine');

class Exchange {
  constructor() {
    this.orderBook = new OrderBook();
    this.matchingEngine = new MatchingEngine(this.orderBook);
    this.marginCalculator = new MarginCalculator();
    this.adlEngine = new ADLEngine();
    this.liquidationEngine = new LiquidationEngine(this.matchingEngine, this.orderBook, this.marginCalculator, this.adlEngine);
    this.marginMonitor = new MarginMonitor(this.marginCalculator);
    this.positionLiquidationEngine = new PositionLiquidationEngine();
    
    this.users = new Map();
    this.positions = new Map();
    this.trades = [];
    this.currentMarkPrice = new Decimal(45000);
    this.indexPrice = new Decimal(45000);
    this.fundingRate = new Decimal(0.0001);
    
    // Logging and audit
    this.logLevel = 'DEBUG'; // DEBUG, INFO, WARN, ERROR
    
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
    
    console.log('='.repeat(80));
    console.log('EXCHANGE INITIALIZED');
    console.log('='.repeat(80));
    this.logZeroSumCheck('Initial state');
  }

  // Logging utilities
  log(level, message, data = null) {
    const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    if (levels[level] >= levels[this.logLevel]) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${level}] ${message}`);
      if (data) {
        console.log('  Data:', JSON.stringify(data, null, 2));
      }
    }
  }

  // Zero-sum invariant validation
  calculateZeroSum() {
    let totalLongPnL = new Decimal(0);
    let totalShortPnL = new Decimal(0);
    let totalLongQty = new Decimal(0);
    let totalShortQty = new Decimal(0);
    
    // Calculate PnL for a position
    const calculatePnL = (position, isLiquidationPosition = false) => {
      try {
        if (isLiquidationPosition) {
          return this.positionLiquidationEngine.calculatePositionPnL(position, this.currentMarkPrice);
        }
        
        // For regular positions
        if (typeof position.calculateUnrealizedPnL === 'function') {
          return position.calculateUnrealizedPnL(this.currentMarkPrice);
        }
        
        // Fallback if position has unrealizedPnL property
        if (position.unrealizedPnL) {
          return new Decimal(position.unrealizedPnL);
        }
        
        console.error('Unable to calculate PnL for position:', position);
        return new Decimal(0);
      } catch (error) {
        console.error('Error calculating PnL:', error);
        return new Decimal(0);
      }
    };
    
    // User positions
    for (const [userId, position] of this.positions) {
      const size = new Decimal(position.size);
      const pnl = calculatePnL(position);
      
      if (position.side === 'long') {
        totalLongPnL = totalLongPnL.plus(pnl);
        totalLongQty = totalLongQty.plus(size);
      } else {
        totalShortPnL = totalShortPnL.plus(pnl);
        totalShortQty = totalShortQty.plus(size);
      }
    }
    
    // Liquidation engine positions
    const lePositions = this.positionLiquidationEngine.positions;
    for (const lePosition of lePositions) {
      const size = new Decimal(lePosition.size);
      const pnl = calculatePnL(lePosition, true);
      
      if (lePosition.side === 'long') {
        totalLongPnL = totalLongPnL.plus(pnl);
        totalLongQty = totalLongQty.plus(size);
      } else {
        totalShortPnL = totalShortPnL.plus(pnl);
        totalShortQty = totalShortQty.plus(size);
      }
    }
    
    const qtyDifference = totalLongQty.minus(totalShortQty);
    const pnlDifference = totalLongPnL.plus(totalShortPnL); // Should sum to 0 (minus fees)
    
    const isQtyBalanced = qtyDifference.abs().lessThan(0.000001); // Allow for tiny rounding errors
    const isPnLBalanced = pnlDifference.abs().lessThan(0.000001); // Allow for tiny rounding errors
    
    const result = {
      quantities: {
        long: totalLongQty.toString(),
        short: totalShortQty.toString(),
        difference: qtyDifference.toString()
      },
      pnl: {
        long: totalLongPnL.toString(),
        short: totalShortPnL.toString(),
        total: pnlDifference.toString()
      },
      isQtyBalanced,
      isPnLBalanced,
      userPositions: this.positions.size,
      liquidationPositions: lePositions.length
    };

    // Log detailed PnL info for debugging
    console.log('📊 ZERO-SUM CHECK DETAILS:', {
      userPositions: Array.from(this.positions.entries()).map(([userId, pos]) => ({
        userId,
        side: pos.side,
        size: pos.size.toString(),
        pnl: calculatePnL(pos).toString()
      })),
      liquidationPositions: lePositions.map(pos => ({
        id: pos.id,
        side: pos.side,
        size: pos.size.toString(),
        pnl: calculatePnL(pos, true).toString()
      }))
    });

    return result;
  }

  logZeroSumCheck(context) {
    const zeroSum = this.calculateZeroSum();
    if (!zeroSum.isQtyBalanced || !zeroSum.isPnLBalanced) {
      this.log('ERROR', `❌ ZERO-SUM INVARIANT VIOLATED - ${context}`, zeroSum);
      console.log('🚨🚨🚨 POSITIONS DO NOT BALANCE 🚨🚨🚨');
      console.log('📊 IMBALANCE DETAILS:', {
        quantities: zeroSum.quantities,
        pnl: zeroSum.pnl
      });
    } else {
      this.log('DEBUG', `✅ Zero-sum check passed - ${context}`, {
        quantities: zeroSum.quantities,
        pnl: zeroSum.pnl,
        userPositions: zeroSum.userPositions,
        liquidationPositions: zeroSum.liquidationPositions
      });
    }
    return zeroSum;
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
      case 'liquidation_step':
        return await this.executeLiquidationStep(data.method);
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
    
    this.log('INFO', `🔄 PROCESSING TRADE`, {
      buyer: buyOrder.userId,
      seller: sellOrder.userId,
      price: price.toString(),
      size: size.toString()
    });
    
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

    this.log('DEBUG', `Updating positions from trade`);
    this.updatePosition(buyOrder.userId, 'long', decSize, decPrice, buyOrder.leverage);
    this.updatePosition(sellOrder.userId, 'short', decSize, decPrice, sellOrder.leverage);

    this.updateUserBalances(buyOrder, sellOrder, decPrice, decSize);
    
    this.logZeroSumCheck('After trade processing');
  }

  updatePosition(userId, side, size, price, leverage, lePositionId = null) {
    // Special case: liquidation engine positions should only be closed, never opened
    if (userId === 'liquidation_engine') {
      // Find the specific liquidation engine position to close
      const lePositions = this.positionLiquidationEngine.positions;
      let targetPosition = null;
      
      if (lePositionId) {
        // Use specific position ID if provided
        targetPosition = lePositions.find(p => p.id === lePositionId);
      } else {
        // Fallback: find first position with opposite side (for closing)
        targetPosition = lePositions.find(p => p.side !== side);
      }
      
      if (!targetPosition) {
        this.log('ERROR', `❌ Liquidation engine position not found for closing`, {
          lePositionId,
          requestedSide: side,
          availablePositions: lePositions.map(p => ({id: p.id, side: p.side, size: p.size.toString()}))
        });
        return;
      }
      
      // Only allow trades that reduce/close the position
      if (targetPosition.side === side) {
        this.log('ERROR', `❌ Invalid liquidation engine trade - would increase position`, {
          positionSide: targetPosition.side,
          tradeSide: side
        });
        return;
      }
      
      this.log('INFO', `🔄 CLOSING LIQUIDATION ENGINE POSITION`, {
        positionId: targetPosition.id,
        originalUserId: targetPosition.originalUserId,
        side: targetPosition.side,
        size: targetPosition.size.toString(),
        closingSize: size.toString()
      });
      
      // Use the liquidation engine's removePosition method to properly close
      const closureResult = this.positionLiquidationEngine.removePosition(
        targetPosition.id, 
        'adl', 
        new Decimal(price)
      );
      
      if (closureResult) {
        this.log('INFO', `✅ Liquidation engine position closed successfully`, {
          positionId: targetPosition.id,
          realizedPnL: closureResult.realizedPnL.toString()
        });
      }
      
      return;
    }

    // Regular user position update logic
    const positionKey = userId;
    let position = this.positions.get(positionKey);
    let realizedPnL = new Decimal(0);
    
    this.log('DEBUG', `📈 UPDATING POSITION`, {
      userId,
      side,
      size: size.toString(),
      price: price.toString(),
      leverage,
      hasExistingPosition: !!position,
      existingPositionSide: position?.side,
      existingPositionSize: position?.size?.toString()
    });
    
    if (!position) {
      this.log('INFO', `🆕 CREATING NEW POSITION`, {
        userId,
        side,
        size: size.toString(),
        price: price.toString(),
        leverage
      });
      position = new Position(userId, side, size, price, leverage);
      this.positions.set(positionKey, position);
      
      this.log('DEBUG', `Position created successfully`, {
        positionSize: position.size.toString(),
        positionSide: position.side
      });
    } else {
      if (position.side === side) {
        this.log('INFO', `⬆️ ADDING TO EXISTING POSITION`, {
          userId,
          side,
          addingSize: size.toString(),
          currentSize: position.size.toString(),
          newTotalSize: position.size.plus(size).toString()
        });
        position.addSize(size, price);
      } else {
        this.log('INFO', `🔄 OPPOSITE SIDE TRADE - REDUCING/FLIPPING POSITION`, {
          userId,
          existingSide: position.side,
          existingSize: position.size.toString(),
          newSide: side,
          newSize: size.toString()
        });
        
        if (size.lessThan(position.size)) {
          this.log('DEBUG', `Partially closing position`);
          realizedPnL = position.reduceSize(size, price);
          this.log('INFO', `💰 POSITION PARTIALLY CLOSED`, {
            userId,
            reducedBy: size.toString(),
            remainingSize: position.size.toString(),
            realizedPnL: realizedPnL.toString()
          });
        } else if (size.equals(position.size)) {
          this.log('DEBUG', `Fully closing position`);
          realizedPnL = position.closePosition(price);
          this.positions.delete(positionKey);
          
          this.log('INFO', `✅ POSITION FULLY CLOSED`, {
            userId,
            closedSize: size.toString(),
            realizedPnL: realizedPnL.toString()
          });
          
          const user = this.users.get(userId);
          user.updateBalance(realizedPnL);
          user.usedMargin = user.usedMargin.minus(position.initialMargin);
          return;
        } else {
          this.log('DEBUG', `Closing position and opening new opposite position`);
          const excessSize = size.minus(position.size);
          realizedPnL = position.closePosition(price);
          
          this.positions.delete(positionKey);
          position = new Position(userId, side, excessSize, price, leverage);
          this.positions.set(positionKey, position);
          
          this.log('INFO', `🔄 POSITION FLIPPED`, {
            userId,
            oldSide: side === 'long' ? 'short' : 'long',
            newSide: side,
            excessSize: excessSize.toString(),
            realizedPnL: realizedPnL.toString()
          });
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
      
      this.log('DEBUG', `Position updated with new margin requirements`, {
        userId,
        positionSize: position.size.toString(),
        positionSide: position.side,
        unrealizedPnL: position.unrealizedPnL.toString(),
        liquidationPrice: position.liquidationPrice.toString()
      });
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
    const oldPrice = this.currentMarkPrice;
    this.currentMarkPrice = new Decimal(newPrice);
    this.indexPrice = new Decimal(newPrice);
    
    this.log('INFO', `📊 MARK PRICE UPDATE`, {
      oldPrice: oldPrice.toString(),
      newPrice: newPrice.toString(),
      change: this.currentMarkPrice.minus(oldPrice).toString(),
      changePercent: this.currentMarkPrice.minus(oldPrice).dividedBy(oldPrice).times(100).toFixed(2) + '%'
    });
    
    this.log('DEBUG', 'Updating PnL for all positions');
    this.positions.forEach(position => {
      const oldPnL = position.unrealizedPnL;
      position.updatePnL(this.currentMarkPrice);
      this.log('DEBUG', `Position PnL updated`, {
        userId: position.userId,
        side: position.side,
        size: position.size.toString(),
        oldPnL: oldPnL.toString(),
        newPnL: position.unrealizedPnL.toString()
      });
    });
    
    this.logZeroSumCheck('After mark price update');
    
    this.log('INFO', '🔍 CHECKING FOR LIQUIDATIONS...');
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
    this.log('DEBUG', `Checking liquidations for ${this.positions.size} positions`);
    
    for (const [userId, position] of this.positions.entries()) {
      const shouldLiquidate = this.liquidationEngine.shouldLiquidate(position, this.currentMarkPrice);
      
      this.log('DEBUG', `Liquidation check for ${userId}`, {
        positionSide: position.side,
        positionSize: position.size.toString(),
        unrealizedPnL: position.unrealizedPnL.toString(),
        liquidationPrice: position.liquidationPrice.toString(),
        currentPrice: this.currentMarkPrice.toString(),
        shouldLiquidate
      });
      
      if (shouldLiquidate) {
        this.log('ERROR', `🚨 LIQUIDATION TRIGGERED for ${userId}`, {
          positionSide: position.side,
          positionSize: position.size.toString(),
          entryPrice: position.avgEntryPrice.toString(),
          currentPrice: this.currentMarkPrice.toString(),
          liquidationPrice: position.liquidationPrice.toString(),
          unrealizedPnL: position.unrealizedPnL.toString()
        });
        
        this.logZeroSumCheck('Before liquidation execution');
        
        console.log(`Liquidating ${userId}...`);
        
        // CRITICAL FIX: Transfer position to liquidation engine BEFORE liquidation
        this.log('INFO', `🔄 TRANSFERRING POSITION TO LIQUIDATION ENGINE`);
        const bankruptcyPrice = this.marginCalculator.calculateBankruptcyPrice(position);
        const transferredPosition = this.positionLiquidationEngine.receivePosition(position, bankruptcyPrice, userId);
        
        this.log('INFO', `📝 Position transferred to liquidation engine with ID: ${transferredPosition.id}`);
        
        const result = await this.liquidationEngine.liquidate(position, this.currentMarkPrice, this.positions);
        liquidations.push(result);
        
        this.log('INFO', `🔥 LIQUIDATION COMPLETED for ${userId}`, result);
        
        // Remove position after liquidation (now it's transferred, not destroyed)
        this.log('DEBUG', `Removing position from user positions map (transferred to liquidation engine)`);
        this.positions.delete(userId);
        
        this.logZeroSumCheck('After liquidation and position transfer');
      }
    }
    
    if (liquidations.length === 0) {
      this.log('DEBUG', '✅ No liquidations required');
    } else {
      this.log('INFO', `⚡ ${liquidations.length} liquidation(s) executed`);
    }
    
    return liquidations;
  }

  async forceLiquidation(userId) {
    const position = this.positions.get(userId);
    if (!position) {
      throw new Error(`Position for user ${userId} not found.`);
    }

    console.log(`Force liquidating ${userId}...`);
    
    // CRITICAL FIX: Transfer position to liquidation engine BEFORE liquidation
    this.log('INFO', `🔄 FORCE LIQUIDATION: TRANSFERRING POSITION TO LIQUIDATION ENGINE`);
    const bankruptcyPrice = this.marginCalculator.calculateBankruptcyPrice(position);
    const transferredPosition = this.positionLiquidationEngine.receivePosition(position, bankruptcyPrice, userId);
    
    this.log('INFO', `📝 Force liquidation: Position transferred to liquidation engine with ID: ${transferredPosition.id}`);
    
    const result = await this.liquidationEngine.liquidate(position, this.currentMarkPrice, this.positions, true);
    
    // Remove position after liquidation (now it's transferred, not destroyed)
    this.log('DEBUG', `Force liquidation: Removing position from user positions map (transferred to liquidation engine)`);
    this.positions.delete(userId);

    this.logZeroSumCheck('After force liquidation and position transfer');

    return {
      success: true,
      liquidationResult: result,
      state: this.getState()
    };
  }

  async executeLiquidationStep(method) {
    console.log('🎯🎯🎯 MANUAL LIQUIDATION STEP REQUESTED 🎯🎯🎯');
    console.log(`Method: ${method.toUpperCase()}`);
    this.log('INFO', `🎯 MANUAL LIQUIDATION STEP REQUESTED: ${method.toUpperCase()}`);
    
    const lePositions = this.positionLiquidationEngine.getPositionsWithPnL(this.currentMarkPrice);
    
    console.log(`🔍 Found ${lePositions.length} positions in liquidation engine:`);
    lePositions.forEach((pos, index) => {
      console.log(`  Position ${index + 1}:`, {
        id: pos.id,
        originalUserId: pos.originalUserId,
        side: pos.side,
        size: pos.size,
        entryPrice: pos.entryPrice,
        status: pos.status,
        unrealizedPnL: pos.unrealizedPnL
      });
    });
    
    if (lePositions.length === 0) {
      console.log('❌ No positions in liquidation engine to process');
      this.log('WARN', 'No positions in liquidation engine to process');
      return {
        success: false,
        error: 'No positions to liquidate',
        state: this.getState()
      };
    }

    let results = [];
    let executedCount = 0;

    switch (method) {
      case 'orderbook':
        this.log('INFO', `📋 ATTEMPTING ORDER BOOK LIQUIDATION for ${lePositions.length} positions`);
        
        for (const position of lePositions) {
          try {
            // Try to place market order for this position
            const liquidationSide = position.side === 'long' ? 'sell' : 'buy';
            
            const liquidationOrder = {
              id: `le_order_${Date.now()}_${position.id}`,
              userId: 'liquidation_engine',
              side: liquidationSide,
              originalSize: new Decimal(position.size),
              remainingSize: new Decimal(position.size),
              filledSize: new Decimal(0),
              price: null, // Market order
              avgFillPrice: new Decimal(0),
              type: 'market',
              leverage: 1,
              timestamp: Date.now(),
              lastUpdateTime: Date.now(),
              status: 'NEW',
              timeInForce: 'IOC',
              fills: [],
              totalValue: new Decimal(0),
              commission: new Decimal(0),
              marginReserved: new Decimal(0),
              isLiquidation: true
            };

            const matches = this.matchingEngine.match(liquidationOrder);
            const totalExecuted = new Decimal(liquidationOrder.filledSize || 0);
            
            if (totalExecuted.greaterThan(0)) {
              this.log('INFO', `✅ ORDER BOOK SUCCESS: Executed ${totalExecuted.toString()} BTC for position ${position.id}`);
              
              // Remove this position from liquidation engine
              const avgExecutionPrice = new Decimal(liquidationOrder.avgFillPrice || this.currentMarkPrice);
              const closureResult = this.positionLiquidationEngine.removePosition(
                position.id, 
                'orderbook', 
                avgExecutionPrice
              );
              
              results.push({
                positionId: position.id,
                method: 'orderbook',
                executed: totalExecuted.toString(),
                price: avgExecutionPrice.toString(),
                realizedPnL: closureResult?.realizedPnL?.toString() || '0',
                success: true
              });
              
              executedCount++;
            } else {
              this.log('WARN', `❌ ORDER BOOK FAILED: No liquidity for position ${position.id}`);
              this.positionLiquidationEngine.updatePositionStatus(position.id, 'orderbook_failed');
              
              results.push({
                positionId: position.id,
                method: 'orderbook',
                executed: '0',
                error: 'No market liquidity',
                success: false
              });
            }
          } catch (error) {
            this.log('ERROR', `Order book liquidation failed for position ${position.id}:`, error);
            results.push({
              positionId: position.id,
              method: 'orderbook',
              error: error.message,
              success: false
            });
          }
        }
        break;

      case 'adl':
        this.log('INFO', `🔄 EXECUTING ADL for ${lePositions.length} liquidation positions`);
        
        for (const lePosition of lePositions) {
          try {
            // Plan the ADL trades first
            const adlPlan = this.adlEngine.planADL(lePosition, this.positions, this.currentMarkPrice);
            
            if (!adlPlan.success) {
              this.log('ERROR', `❌ ADL PLANNING FAILED for position ${lePosition.id}`, adlPlan.error);
              results.push({ positionId: lePosition.id, method: 'adl', success: false, error: adlPlan.error });
              continue;
            }

            this.log('INFO', `✅ ADL PLAN CREATED for position ${lePosition.id}`, { trades: adlPlan.trades });

            // Execute the forced trades from the plan
            for (const adlTrade of adlPlan.trades) {
              const { counterpartyUserId, size, price } = adlTrade;
              
              // For ADL, we want to close both positions
              // The LE position needs to do the OPPOSITE of their current side to close
              const leSide = lePosition.side === 'long' ? 'sell' : 'buy';  // CLOSE by doing opposite
              const counterpartySide = leSide === 'buy' ? 'sell' : 'buy';
              
              this.log('INFO', `🔨 PLANNING ADL TRADE`, {
                lePositionId: lePosition.id,
                originalUserId: lePosition.originalUserId,
                counterparty: counterpartyUserId,
                lePositionSide: lePosition.side,
                closingSide: leSide,
                size,
                price
              });

              // Process ADL trade directly with proper position tracking
              const decPrice = new Decimal(price);
              const decSize = new Decimal(size);
              
              // Update the counterparty position (normal user position)
              this.updatePosition(counterpartyUserId, counterpartySide, decSize, decPrice, 1);
              
              // Close the liquidation engine position (with specific position ID)
              this.updatePosition('liquidation_engine', leSide, decSize, decPrice, 1, lePosition.id);
              
              // Log the trade outcome
              this.log('INFO', `✅ ADL TRADE EXECUTED`, {
                lePositionId: lePosition.id,
                originalUserId: lePosition.originalUserId,
                counterparty: counterpartyUserId,
                size: size.toString(),
                price: price.toString(),
                lePositionSide: lePosition.side,
                closingSide: leSide
              });
            }
            
            // Position should now be closed by updatePosition call above

            results.push({ positionId: lePosition.id, method: 'adl', success: true });
            executedCount++;
            
          } catch (error) {
            this.log('ERROR', `ADL failed for position ${lePosition.id}:`, error);
            results.push({ positionId: lePosition.id, method: 'adl', error: error.message, success: false });
          }
        }
        break;

      case 'force':
        this.log('INFO', `🔨 FORCE CLOSING ${lePositions.length} liquidation positions`);
        
        for (const position of lePositions) {
          try {
            // Force close at current mark price
            const closureResult = this.positionLiquidationEngine.removePosition(
              position.id,
              'force_close',
              this.currentMarkPrice
            );
            
            results.push({
              positionId: position.id,
              method: 'force_close',
              price: this.currentMarkPrice.toString(),
              realizedPnL: closureResult?.realizedPnL?.toString() || '0',
              success: true
            });
            
            executedCount++;
            this.log('INFO', `✅ FORCE CLOSE: Position ${position.id} closed at mark price`);
          } catch (error) {
            this.log('ERROR', `Force close failed for position ${position.id}:`, error);
            results.push({
              positionId: position.id,
              method: 'force_close',
              error: error.message,
              success: false
            });
          }
        }
        break;

      default:
        throw new Error(`Unknown liquidation method: ${method}`);
    }

    this.logZeroSumCheck(`After ${method} liquidation step`);

    this.log('INFO', `🎯 LIQUIDATION STEP COMPLETED: ${method.toUpperCase()}`);
    this.log('INFO', `📊 Results: ${executedCount}/${lePositions.length} positions processed`);

    return {
      success: true,
      method,
      executedCount,
      totalPositions: lePositions.length,
      results,
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
      adlQueue: this.adlEngine.getQueue(this.positions, this.users, this.currentMarkPrice),
      marginCalls: this.marginMonitor.getActiveMarginCalls(),
      positionLiquidationEngine: {
        positions: this.positionLiquidationEngine.getPositionsWithPnL(this.currentMarkPrice),
        summary: this.positionLiquidationEngine.getSummary(this.currentMarkPrice),
        zeroSumCheck: this.positionLiquidationEngine.verifyZeroSum(Array.from(this.positions.values())),
        insuranceFundSufficiency: this.positionLiquidationEngine.checkInsuranceFundSufficiency(
          this.currentMarkPrice, 
          new Decimal(this.liquidationEngine.getInsuranceFundBalance())
        )
      }
    };
  }
}

module.exports = { Exchange };