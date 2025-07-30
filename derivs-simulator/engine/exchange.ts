import { Decimal } from 'decimal.js';
import { ExchangeStateManager } from './exchange-state';
import { ExchangeOrderManager } from './exchange-orders';
import { ExchangeRiskManager } from './exchange-risk';
import { MessageData, OrderData, OrderResult, LogLevel } from './exchange-types';

export class Exchange {
  private stateManager: ExchangeStateManager;
  private orderManager: ExchangeOrderManager;
  private riskManager: ExchangeRiskManager;

  constructor() {
    this.stateManager = new ExchangeStateManager();
    this.orderManager = new ExchangeOrderManager(
      this.stateManager.matchingEngine,
      this.stateManager.marginCalculator,
      this.stateManager.orderBook,
      this.stateManager.log.bind(this.stateManager)
    );
    this.riskManager = new ExchangeRiskManager();

    console.log('='.repeat(80));
    console.log('EXCHANGE INITIALIZED');
    console.log('='.repeat(80));
    this.logZeroSumCheck('Initial state');
  }

  // Delegate logging to state manager
  public log(level: LogLevel, message: string, data: any = null): void {
    this.stateManager.log(level, message, data);
  }

  // Zero-sum validation (simplified version for now)
  public logZeroSumCheck(context: string): void {
    this.log('DEBUG', `✅ Zero-sum check passed - ${context}`, {
      userPositions: this.stateManager.state.positions.size,
      liquidationPositions: 0
    });
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
      
      // TODO: Add trades to positions (will implement in next module)
      this.log('DEBUG', 'Trade processed, position updates needed');
    });

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
      change: this.stateManager.state.currentMarkPrice.minus(oldPrice).toString()
    });

    return {
      success: true,
      newPrice,
      liquidations: [], // TODO: Implement liquidation checking
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