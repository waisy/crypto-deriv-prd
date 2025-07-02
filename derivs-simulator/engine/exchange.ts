import { Decimal } from 'decimal.js';
import { OrderBook } from './orderbook';
import { Position } from './position';
import { Trade } from './trade';
import { User } from './user';
import { MatchingEngine } from './matching';
import { MarginCalculator } from './margin';
import { LiquidationEngine } from './liquidation';
import { ADLEngine } from './adl';
import { MarginMonitor } from './margin-monitor';
import PositionLiquidationEngine from './liquidation-engine';
import { PerformanceOptimizer } from './performance-optimizer';
import {
  ExchangeMessage,
  ExchangeResponse,
  ExchangeConfig,
  OrderData,
  OrderResponse,
  StateResponse,
  ZeroSumResult,
  LiquidationResult,
  ADLResult,
  RiskLimits,
  RiskValidationResult,
  LogLevel,
  LogData,
  TradeMatch,
  MarkPriceUpdate,
  LiquidationStepData,
  ManualLiquidateData
} from './types';

export class Exchange {
  // Core engines
  private orderBook: OrderBook;
  private matchingEngine: MatchingEngine;
  private marginCalculator: MarginCalculator;
  private adlEngine: ADLEngine;
  private liquidationEngine: LiquidationEngine;
  private marginMonitor: MarginMonitor;
  private positionLiquidationEngine: PositionLiquidationEngine;

  // Data storage
  private users: Map<string, User>;
  private positions: Map<string, Position>;
  private trades: Trade[];

  // Market data
  private currentMarkPrice: Decimal;
  private indexPrice: Decimal;
  private fundingRate: Decimal;

  // ADL tracking
  private adlSocializationAmounts: Map<string, Decimal>;

  // Configuration
  private logLevel: LogLevel;
  private liquidationEnabled: boolean;
  private adlEnabled: boolean;
  private riskLimits: RiskLimits;

  constructor(config?: Partial<ExchangeConfig>) {
    // Initialize engines
    this.orderBook = new OrderBook();
    this.matchingEngine = new MatchingEngine(this.orderBook);
    this.marginCalculator = new MarginCalculator();
    this.adlEngine = new ADLEngine();
    this.liquidationEngine = new LiquidationEngine(
      this.matchingEngine,
      this.orderBook,
      this.marginCalculator,
      this.adlEngine
    );
    this.marginMonitor = new MarginMonitor(this.marginCalculator);
    this.positionLiquidationEngine = new PositionLiquidationEngine();

    // Initialize data storage
    this.users = new Map<string, User>();
    this.positions = new Map<string, Position>();
    this.trades = [];

    // Initialize market data
    this.currentMarkPrice = new Decimal(config?.initialMarkPrice ?? 50000);
    this.indexPrice = new Decimal(config?.initialIndexPrice ?? 50000);
    this.fundingRate = new Decimal(config?.initialFundingRate ?? 0.0001);

    // Initialize ADL tracking
    this.adlSocializationAmounts = new Map<string, Decimal>();

    // Initialize configuration
    this.logLevel = config?.logLevel ?? 'DEBUG';
    this.liquidationEnabled = config?.liquidationEnabled ?? true;
    this.adlEnabled = config?.adlEnabled ?? true;
    this.riskLimits = config?.riskLimits ?? {
      maxPositionSize: 10.0,
      maxLeverage: 100,
      maxPositionValue: 1000000,
      maxUserPositions: 1,
      minOrderSize: 0.001
    };

    // Initialize users
    this.initializeUsers();

    console.log('='.repeat(80));
    console.log('EXCHANGE INITIALIZED');
    console.log('='.repeat(80));
    this.logZeroSumCheck('Initial state');
  }

  // Logging utilities
  private log(level: LogLevel, message: string, data?: LogData): void {
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
  private calculateZeroSum(): ZeroSumResult {
    let totalLongPnL = new Decimal(0);
    let totalShortPnL = new Decimal(0);
    let totalLongQty = new Decimal(0);
    let totalShortQty = new Decimal(0);

    // Calculate PnL for a position
    const calculatePnL = (position: Position | any, isLiquidationPosition = false): Decimal => {
      try {
        if (isLiquidationPosition) {
          return this.positionLiquidationEngine.calculatePositionPnL(position, this.currentMarkPrice);
        }
        return position.calculateUnrealizedPnL(this.currentMarkPrice);
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
    const pnlDifference = totalLongPnL.plus(totalShortPnL);

    const isQtyBalanced = qtyDifference.abs().lessThan(0.000001);
    const isPnLBalanced = pnlDifference.abs().lessThan(0.000001);

    const result: ZeroSumResult = {
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

  private logZeroSumCheck(context: string): ZeroSumResult {
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

  private initializeUsers(): void {
    const bob = new User('bob', 'Bob', 100000);
    const eve = new User('eve', 'Eve', 100000);
    const alice = new User('alice', 'Alice', 100000);

    this.users.set('bob', bob);
    this.users.set('eve', eve);
    this.users.set('alice', alice);
  }

  // Main message handler
  public async handleMessage(data: ExchangeMessage): Promise<ExchangeResponse> {
    switch (data.type) {
      case 'place_order':
        return await this.placeOrder(data);
      case 'cancel_order':
        return this.cancelOrder(data);
      case 'update_mark_price':
        return await this.updateMarkPrice(data.price);
      case 'get_state':
        return this.getState();
      case 'reset_state':
        return this.resetState();
      case 'liquidation_step':
        return await this.executeLiquidationStep(data.method);
      case 'manual_liquidate':
        return await this.manualLiquidate(data.userId);
      case 'get_insurance_fund':
        return this.getInsuranceFund();
      case 'adjust_insurance_fund':
        return this.adjustInsuranceFund(data.amount, data.description);
      default:
        return { success: false, error: 'Unknown message type' };
    }
  }

  // Order placement method
  private async placeOrder(data: OrderData): Promise<OrderResponse> {
    try {
      // For now, return a minimal successful response
      // TODO: Implement full order placement logic
      return { 
        success: true, 
        orderId: Date.now().toString(),
        trade: {
          price: data.price,
          size: data.size,
          timestamp: Date.now()
        }
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Order placement failed' };
    }
  }

  private cancelOrder(data: any): ExchangeResponse {
    // Implementation will be added
    return { success: false, error: 'Not implemented yet' };
  }

  private async updateMarkPrice(price: number): Promise<ExchangeResponse> {
    // Implementation will be added
    return { success: false, error: 'Not implemented yet' };
  }

  public getState(): StateResponse {
    const usersState: { [userId: string]: any } = {};
    
    // Convert users to state format using proper User.toJSON() method
    for (const [userId, user] of this.users) {
      const userJson = user.toJSON();
      usersState[userId] = {
        id: userJson.id,
        name: userJson.name,
        availableBalance: parseFloat(userJson.availableBalance),
        usedMargin: parseFloat(userJson.usedMargin),
        totalBalance: parseFloat(userJson.totalBalance),
        unrealizedPnL: parseFloat(userJson.unrealizedPnL),
        leverage: userJson.leverage,
        totalPnL: parseFloat(userJson.totalPnL),
        marginRatio: userJson.marginRatio,
        equity: parseFloat(userJson.equity)
      };
    }

    // Convert positions to state format
    const positionsState = Array.from(this.positions.values()).map(position => ({
      userId: position.userId,
      side: position.side as 'long' | 'short',
      size: position.size.toNumber(),
      entryPrice: position.avgEntryPrice.toNumber(),
      leverage: position.leverage,
      unrealizedPnL: position.calculateUnrealizedPnL(this.currentMarkPrice).toNumber(),
      liquidationPrice: position.liquidationPrice.toNumber(),
      bankruptcyPrice: position.calculateBankruptcyPrice().toNumber(),
      initialMargin: position.initialMargin.toNumber(),
      timestamp: position.timestamp
    })).filter(pos => pos.side !== null); // Filter out null sides

    // Convert liquidation positions to state format
    const liquidationPositionsState = this.positionLiquidationEngine.positions.map(pos => ({
      id: pos.id.toString(),
      originalUserId: pos.originalUserId,
      side: pos.side as 'long' | 'short',
      size: pos.size.toNumber(),
      entryPrice: pos.avgEntryPrice?.toNumber(),
      bankruptcyPrice: pos.bankruptcyPrice.toNumber(),
      status: pos.status as 'pending' | 'processing' | 'completed',
      unrealizedPnL: this.positionLiquidationEngine.calculatePositionPnL(pos, this.currentMarkPrice).toNumber(),
      timestamp: pos.timestamp
    })).filter(pos => pos.side !== null); // Filter out null sides

    // Get order book state and convert to our format
    const orderBookState = this.orderBook.getState();
    const convertedOrderBook = {
      bids: orderBookState.bids.map(level => ({
        price: parseFloat(level.price),
        size: parseFloat(level.size),
        count: level.orders // Use the actual order count from orderbook
      })),
      asks: orderBookState.asks.map(level => ({
        price: parseFloat(level.price),
        size: parseFloat(level.size),
        count: level.orders // Use the actual order count from orderbook
      }))
    };

    return {
      users: usersState,
      positions: positionsState,
      liquidationPositions: liquidationPositionsState,
      orderBook: convertedOrderBook,
      markPrice: this.currentMarkPrice.toNumber(),
      insuranceFund: parseFloat(this.liquidationEngine.getInsuranceFundBalance()),
      timestamp: Date.now()
    };
  }

  private resetState(): ExchangeResponse {
    try {
      // Clear all positions and trades
      this.positions.clear();
      this.trades = [];
      this.adlSocializationAmounts.clear();
      
      // Reset users to initial state
      this.users.clear();
      this.initializeUsers();
      
      // Reset market data to initial values
      this.currentMarkPrice = new Decimal(50000);
      this.indexPrice = new Decimal(50000);
      
      console.log('🔄 Exchange state reset successfully');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'State reset failed' };
    }
  }

  private async executeLiquidationStep(method: string): Promise<ADLResult> {
    // Implementation will be added
    return { success: false, positionsProcessed: 0, trades: [], error: 'Not implemented yet' };
  }

  private async manualLiquidate(userId: string): Promise<ExchangeResponse> {
    // Implementation will be added
    return { success: false, error: 'Not implemented yet' };
  }

  private getInsuranceFund(): ExchangeResponse {
    // Implementation will be added
    return { success: false, error: 'Not implemented yet' };
  }

  private adjustInsuranceFund(amount: number, description: string): ExchangeResponse {
    // Implementation will be added
    return { success: false, error: 'Not implemented yet' };
  }
}

export default Exchange; 