import { Decimal } from 'decimal.js';
import { ExchangeStateManager } from './exchange-state';
import { ExchangeOrderManager } from './exchange-orders';
import { ExchangeRiskManager } from './exchange-risk';
import { ExchangePositionManager } from './exchange-positions';
import { ExchangeLiquidationManager } from './exchange-liquidations';
import { ExchangeValidationManager } from './exchange-validation';
import { MessageData, OrderData, OrderResult, LogLevel } from './exchange-types';

export class Exchange {
  private stateManager: ExchangeStateManager;
  private orderManager: ExchangeOrderManager;
  private riskManager: ExchangeRiskManager;
  private positionManager: ExchangePositionManager;
  private liquidationManager: ExchangeLiquidationManager;
  private validationManager: ExchangeValidationManager;

  constructor() {
    this.stateManager = new ExchangeStateManager();
    
    // Initialize all managers with proper dependencies
    const logFunction = this.stateManager.log.bind(this.stateManager);
    
    this.orderManager = new ExchangeOrderManager(
      this.stateManager.matchingEngine,
      this.stateManager.marginCalculator,
      this.stateManager.orderBook,
      logFunction
    );
    this.riskManager = new ExchangeRiskManager();
    this.positionManager = new ExchangePositionManager(logFunction);
    this.liquidationManager = new ExchangeLiquidationManager(logFunction);
    this.validationManager = new ExchangeValidationManager(logFunction);

    console.log('='.repeat(80));
    console.log('EXCHANGE INITIALIZED');
    console.log('='.repeat(80));
    this.logZeroSumCheck('Initial state');
  }

  // Delegate logging to state manager
  public log(level: LogLevel, message: string, data: any = null): void {
    this.stateManager.log(level, message, data);
  }

  // Zero-sum validation
  public logZeroSumCheck(context: string): void {
    this.validationManager.logZeroSumCheck(
      context,
      this.stateManager.state.positions,
      this.stateManager.positionLiquidationEngine,
      this.stateManager.state.currentMarkPrice
    );
  }

  // Message handling
  public async handleMessage(data: MessageData): Promise<any> {
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
      case 'get_state':
        return { success: true, state: this.getState() };
      case 'reset_state':
        return this.resetState();
      case 'set_liquidation_enabled':
        this.stateManager.state.liquidationEnabled = data.enabled;
        return { success: true, liquidationEnabled: this.stateManager.state.liquidationEnabled };
      case 'set_adl_enabled':
        this.stateManager.state.adlEnabled = data.enabled;
        return { success: true, adlEnabled: this.stateManager.state.adlEnabled };
      case 'detect_liquidations':
        return this.detectLiquidations();
      case 'manual_liquidate':
        return await this.manualLiquidate(data.userId);
      case 'manual_adjustment':
        return this.stateManager.liquidationEngine.manualAdjustment(data.amount, data.description);
      default:
        throw new Error(`Unknown message type: ${data.type}`);
    }
  }

  // Order operations
  public async placeOrder(orderData: OrderData | MessageData): Promise<OrderResult> {
    // If it's a message data, extract the order data
    const actualOrderData = 'userId' in orderData ? orderData as OrderData : orderData as any;
    
    const result = await this.orderManager.placeOrder(
      actualOrderData,
      this.stateManager.state.users,
      this.stateManager.state.positions,
      this.stateManager.state.riskLimits,
      this.riskManager.validateRiskLimits.bind(this.riskManager),
      this.stateManager.state.currentMarkPrice
    );

    // Process any matches
    result.matches?.forEach(match => {
      const tradeResult = this.orderManager.processTrade(
        match,
        this.stateManager.state.currentMarkPrice,
        this.stateManager.adlEngine,
        this.stateManager.state.trades
      );
      
      // Add trade record to history
      this.stateManager.state.trades.push(tradeResult.tradeRecord);
      
      // Add trades to positions
      this.positionManager.addTradeToPosition(
        tradeResult.buyTrade,
        this.stateManager.state.users,
        this.stateManager.state.positions,
        this.stateManager.state.currentMarkPrice,
        this.stateManager.positionLiquidationEngine
      );
      
      this.positionManager.addTradeToPosition(
        tradeResult.sellTrade,
        this.stateManager.state.users,
        this.stateManager.state.positions,
        this.stateManager.state.currentMarkPrice,
        this.stateManager.positionLiquidationEngine
      );

      // Update user balances
      this.positionManager.updateUserBalances(
        match.buyOrder,
        match.sellOrder,
        tradeResult.tradeRecord.price,
        tradeResult.tradeRecord.size,
        this.stateManager.state.users
      );
    });

    this.logZeroSumCheck('After trade processing');

    // Check for liquidations
    try {
      const liquidations = await this.checkLiquidations();
      result.liquidations = liquidations.length > 0 ? liquidations : undefined;
    } catch (error) {
      console.error('Liquidation check failed:', error);
    }

    result.state = this.getState();
    return result;
  }

  public cancelOrder(data: any): any {
    const result = this.orderManager.cancelOrder(data.orderId);
    result.state = this.getState();
    return result;
  }

  // Price updates
  public async updateMarkPrice(newPrice: number): Promise<any> {
    const oldPrice = this.stateManager.state.currentMarkPrice;
    this.stateManager.state.currentMarkPrice = new Decimal(newPrice);
    this.stateManager.state.indexPrice = new Decimal(newPrice);
    
    this.log('INFO', `📊 MARK PRICE UPDATE`, {
      oldPrice: oldPrice.toString(),
      newPrice: newPrice.toString(),
      change: this.stateManager.state.currentMarkPrice.minus(oldPrice).toString(),
      changePercent: this.stateManager.state.currentMarkPrice.minus(oldPrice).dividedBy(oldPrice).times(100).toFixed(2) + '%'
    });
    
    this.log('DEBUG', 'Updating PnL for all positions');
    this.stateManager.state.positions.forEach(position => {
      const currentPnL = position.calculateUnrealizedPnL(this.stateManager.state.currentMarkPrice);
      this.log('DEBUG', `Position PnL updated`, {
        userId: position.userId,
        side: position.side,
        size: position.size.toString(),
        entryPrice: position.avgEntryPrice.toString(),
        currentPrice: this.stateManager.state.currentMarkPrice.toString(),
        unrealizedPnL: currentPnL.toString()
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

  // Liquidation operations
  public async checkLiquidations(): Promise<any[]> {
    return await this.liquidationManager.checkLiquidations(
      this.stateManager.state.positions,
      this.stateManager.state.users,
      this.stateManager.state.currentMarkPrice,
      this.stateManager.liquidationEngine,
      this.stateManager.marginCalculator,
      this.stateManager.positionLiquidationEngine,
      this.stateManager.state.adlSocializationAmounts,
      this.stateManager.state.liquidationEnabled
    );
  }

  public detectLiquidations(): any {
    const result = this.liquidationManager.detectLiquidations(
      this.stateManager.state.positions,
      this.stateManager.liquidationEngine,
      this.stateManager.marginCalculator,
      this.stateManager.state.currentMarkPrice
    );
    result.state = this.getState();
    return result;
  }

  public async manualLiquidate(userId: string): Promise<any> {
    this.logZeroSumCheck('Before manual liquidation');
    
    const result = await this.liquidationManager.manualLiquidate(
      userId,
      this.stateManager.state.positions,
      this.stateManager.state.users,
      this.stateManager.liquidationEngine,
      this.stateManager.marginCalculator,
      this.stateManager.positionLiquidationEngine,
      this.stateManager.state.currentMarkPrice
    );
    
    this.logZeroSumCheck('After manual liquidation and position transfer');
    
    result.state = this.getState();
    return result;
  }

  public async forceLiquidation(userId: string): Promise<any> {
    const position = this.stateManager.state.positions.get(userId);
    if (!position) {
      throw new Error(`Position for user ${userId} not found.`);
    }

    console.log(`Force liquidating ${userId}...`);
    
    // CRITICAL FIX: Transfer position to liquidation engine BEFORE liquidation
    this.log('INFO', `🔄 FORCE LIQUIDATION: TRANSFERRING POSITION TO LIQUIDATION ENGINE`);
    const bankruptcyPrice = this.stateManager.marginCalculator.calculateBankruptcyPrice(position as any);
    const transferredPosition = this.stateManager.positionLiquidationEngine.receivePosition(position, bankruptcyPrice, userId);
    
    this.log('INFO', `📝 Force liquidation: Position transferred to liquidation engine with ID: ${transferredPosition.id}`);
    
    const result = await this.stateManager.liquidationEngine.liquidate(position, this.stateManager.state.currentMarkPrice, this.stateManager.state.positions, true);
    
    // Remove position after liquidation (now it's transferred, not destroyed)
    this.log('DEBUG', `Force liquidation: Removing position from user positions map (transferred to liquidation engine)`);
    this.stateManager.state.positions.delete(userId);

    this.logZeroSumCheck('After force liquidation and position transfer');

    return {
      success: true,
      liquidationResult: result,
      state: this.getState()
    };
  }

  public async executeLiquidationStep(method: string): Promise<any> {
    console.log('🎯🎯🎯 MANUAL LIQUIDATION STEP REQUESTED 🎯🎯🎯');
    console.log(`Method: ${method.toUpperCase()}`);
    this.log('INFO', `🎯 MANUAL LIQUIDATION STEP REQUESTED: ${method.toUpperCase()}`);
    
    const lePositions = this.stateManager.positionLiquidationEngine.positions;
    const results: any[] = [];
    let executedCount = 0;

    switch (method.toLowerCase()) {
      case 'adl':
        this.log('INFO', `🔄 EXECUTING ADL for ${lePositions.length} liquidation positions`);
        
        for (const lePosition of lePositions) {
          try {
            // Skip positions without valid side
            if (!lePosition.side) {
              this.log('WARN', `Skipping liquidation position ${lePosition.id} - no valid side`);
              continue;
            }
            
            // Get the ADL socialization amount for this position
            const socializationAmount = this.stateManager.state.adlSocializationAmounts.get(lePosition.id) || 0;
            
            console.log(`💰 ADL SOCIALIZATION CHECK for position ${lePosition.id}:`, {
              socializationRequired: socializationAmount?.toString() || '0',
              originalUser: lePosition.originalUserId
            });
            
            // Create ADL-compatible position object
            const adlPosition = {
              id: lePosition.id,
              side: lePosition.side as 'long' | 'short',  // Type assertion since we checked above
              size: lePosition.size,  // Explicitly include getter property
              userId: lePosition.originalUserId
            };
            
            // Plan the ADL trades first with socialization amount
            const adlPlan = this.stateManager.adlEngine.planADL(
              adlPosition, 
              this.stateManager.state.positions, 
              this.stateManager.state.users, 
              this.stateManager.state.currentMarkPrice, 
              socializationAmount
            );
            
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
              
              // Create forced orders for both sides
              const leOrder = {
                id: `le_adl_${Date.now()}_${lePosition.id}`,
                userId: 'liquidation_engine',
                side: leSide,
                size: new Decimal(size),
                remainingSize: new Decimal(size),
                filledSize: new Decimal(0),
                price: new Decimal(price),
                avgFillPrice: new Decimal(0),
                type: 'adl',
                leverage: 1,
                timestamp: Date.now(),
                lastUpdateTime: Date.now(),
                status: 'NEW',
                timeInForce: 'IOC',
                fills: [],
                totalValue: new Decimal(0),
                commission: new Decimal(0),
                marginReserved: new Decimal(0),
                isLiquidation: true,
                lePositionId: lePosition.id
              };
              
              const counterpartyOrder = {
                id: `adl_counterparty_${Date.now()}_${counterpartyUserId}`,
                userId: counterpartyUserId,
                side: counterpartySide,
                size: new Decimal(size),
                remainingSize: new Decimal(size),
                filledSize: new Decimal(0),
                price: new Decimal(price),
                avgFillPrice: new Decimal(0),
                type: 'adl',
                leverage: 1,
                timestamp: Date.now(),
                lastUpdateTime: Date.now(),
                status: 'NEW',
                timeInForce: 'IOC',
                fills: [],
                totalValue: new Decimal(0),
                commission: new Decimal(0),
                marginReserved: new Decimal(0),
                isADL: true
              };
              
              // Execute the ADL trade
              const match = {
                buyOrder: leSide === 'buy' ? leOrder : counterpartyOrder,
                sellOrder: leSide === 'sell' ? leOrder : counterpartyOrder,
                price: new Decimal(price),
                size: new Decimal(size)
              };
              
              // Process the trade using the order manager
              const tradeResult = this.orderManager.processTrade(
                match,
                this.stateManager.state.currentMarkPrice,
                this.stateManager.adlEngine,
                this.stateManager.state.trades
              );
              
              // Add trade record to history
              this.stateManager.state.trades.push(tradeResult.tradeRecord);
              
              // Add trades to positions (this will handle ADL closure logic)
              this.positionManager.addTradeToPosition(
                tradeResult.buyTrade,
                this.stateManager.state.users,
                this.stateManager.state.positions,
                this.stateManager.state.currentMarkPrice,
                this.stateManager.positionLiquidationEngine
              );
              
              this.positionManager.addTradeToPosition(
                tradeResult.sellTrade,
                this.stateManager.state.users,
                this.stateManager.state.positions,
                this.stateManager.state.currentMarkPrice,
                this.stateManager.positionLiquidationEngine
              );
              
              this.log('INFO', `✅ ADL TRADE EXECUTED`, {
                lePositionId: lePosition.id,
                counterparty: counterpartyUserId,
                size: size.toString(),
                price: price.toString()
              });
            }
            
            // Remove the position from liquidation engine
            const closureResult = this.stateManager.positionLiquidationEngine.removePosition(
              lePosition.id, 
              'adl', 
              new Decimal(adlPlan.trades[0].price)
            );
            
            results.push({
              positionId: lePosition.id,
              method: 'adl',
              executed: lePosition.size.toString(),
              price: adlPlan.trades[0].price.toString(),
              realizedPnL: closureResult?.realizedPnL?.toString() || '0',
              success: true
            });
            
            executedCount++;
          } catch (error: any) {
            this.log('ERROR', `ADL execution failed for position ${lePosition.id}:`, error);
            results.push({
              positionId: lePosition.id,
              method: 'adl',
              error: error.message,
              success: false
            });
          }
        }
        break;
        
      default:
        return {
          success: false,
          error: `Unknown liquidation method: ${method}`,
          state: this.getState()
        };
    }

    this.logZeroSumCheck('After ADL execution');

    return {
      success: true,
      method,
      executed: executedCount,
      total: lePositions.length,
      results,
      state: this.getState()
    };
  }

  // Leverage updates
  public updateLeverage(data: any): any {
    const { userId, leverage } = data;
    const user = this.stateManager.state.users.get(userId);
    
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    
    user.leverage = leverage;
    
    // Recalculate margin requirements for all positions
    this.stateManager.state.positions.forEach(position => {
      if (position.userId === userId) {
        const marginReqs = this.stateManager.marginCalculator.calculateMarginRequirements(position as any, this.stateManager.state.currentMarkPrice);
        // Note: These are read-only properties, would need Position class updates to make them writable
        this.log('DEBUG', 'Margin requirements recalculated', {
          userId,
          newInitialMargin: marginReqs.initial.toString(),
          newMaintenanceMargin: marginReqs.maintenance.toString()
        });
      }
    });

    return {
      success: true,
      state: this.getState()
    };
  }

  // State operations
  public resetState(): any {
    return this.stateManager.resetState();
  }

  public getState(): any {
    return this.stateManager.getState();
  }
} 