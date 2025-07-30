import { Decimal } from 'decimal.js';
import { OrderBook } from './orderbook';
import { MatchingEngine } from './matching';
import { MarginCalculator } from './margin';
import { ADLEngine } from './adl';
import { LiquidationEngine } from './liquidation';
import { MarginMonitor } from './margin-monitor';
import PositionLiquidationEngine from './liquidation-engine';
import { User } from './user';
import { ExchangeState, LogLevel, RiskLimits, ZeroSumResult } from './exchange-types';

export class ExchangeStateManager {
  public state!: ExchangeState;
  
  // Core engine components
  public orderBook!: OrderBook;
  public matchingEngine!: MatchingEngine;
  public marginCalculator!: MarginCalculator;
  public adlEngine!: ADLEngine;
  public liquidationEngine!: LiquidationEngine;
  public marginMonitor!: MarginMonitor;
  public positionLiquidationEngine!: PositionLiquidationEngine;

  constructor() {
    this.initializeEngines();
    this.initializeState();
    this.initializeUsers();
  }

  private initializeEngines(): void {
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
  }

  private initializeState(): void {
    this.state = {
      users: new Map(),
      positions: new Map(),
      trades: [],
      currentMarkPrice: new Decimal(50000),
      indexPrice: new Decimal(50000),
      fundingRate: new Decimal(0.0001),
      adlSocializationAmounts: new Map(),
      logLevel: 'DEBUG' as LogLevel,
      liquidationEnabled: true,
      adlEnabled: true,
      riskLimits: {
        maxPositionSize: 10.0,
        maxLeverage: 100,
        maxPositionValue: 1000000,
        maxUserPositions: 1,
        minOrderSize: 0.001
      }
    };
  }

  public initializeUsers(): void {
    const bob = new User('bob', 'Bob', new Decimal(100000));
    const eve = new User('eve', 'Eve', new Decimal(100000));
    const alice = new User('alice', 'Alice', new Decimal(100000));
    
    this.state.users.set('bob', bob);
    this.state.users.set('eve', eve);
    this.state.users.set('alice', alice);
  }

  public resetState(): { success: boolean; message: string; state: any } {
    console.log('🔄 RESETTING EXCHANGE STATE...');
    
    // Clear all collections
    this.state.positions.clear();
    this.state.trades = [];
    
    // Reset engines
    this.initializeEngines();
    
    // Reset ADL socialization tracking  
    this.state.adlSocializationAmounts.clear();
    
    // Clear users and reinitialize with fresh balances
    this.state.users.clear();
    this.initializeUsers();
    
    // Reset prices to defaults
    this.state.currentMarkPrice = new Decimal(50000);
    this.state.indexPrice = new Decimal(50000);
    this.state.fundingRate = new Decimal(0.0001);
    
    console.log('✅ EXCHANGE STATE RESET COMPLETE');
    
    return { 
      success: true, 
      message: 'Exchange state reset successfully',
      state: this.getState() 
    };
  }

  public getState(): any {
    return {
      users: Array.from(this.state.users.values()).map(u => u.toJSON()),
      positions: Array.from(this.state.positions.values()).map(p => p.toJSON(this.state.currentMarkPrice)),
      orderBook: this.orderBook.toJSON(),
      trades: this.state.trades.slice(-20),
      markPrice: this.state.currentMarkPrice.toString(),
      indexPrice: this.state.indexPrice.toString(),
      fundingRate: this.state.fundingRate.toString(),
      insuranceFund: {
        balance: this.liquidationEngine.getInsuranceFundBalance(),
        isAtRisk: this.liquidationEngine.isSystemAtRisk()
      },
      userOrders: this.orderBook.getOrdersByUser(),
      adlQueue: this.adlEngine.getQueue(this.state.positions, this.state.users, this.state.currentMarkPrice),
      marginCalls: this.marginMonitor.getActiveMarginCalls(),
      liquidationPositions: this.positionLiquidationEngine.getPositionsWithPnL(this.state.currentMarkPrice),
      positionLiquidationEngine: {
        positions: this.positionLiquidationEngine.getPositionsWithPnL(this.state.currentMarkPrice),
        summary: this.positionLiquidationEngine.getSummary(this.state.currentMarkPrice),
        zeroSumCheck: this.positionLiquidationEngine.verifyZeroSum(Array.from(this.state.positions.values())),
        insuranceFundSufficiency: this.positionLiquidationEngine.checkInsuranceFundSufficiency(
          this.state.currentMarkPrice, 
          new Decimal(this.liquidationEngine.getInsuranceFundBalance())
        )
      }
    };
  }

  public log(level: LogLevel, message: string, data: any = null): void {
    const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    if (levels[level] >= levels[this.state.logLevel]) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${level}] ${message}`);
      if (data) {
        console.log('  Data:', JSON.stringify(data, null, 2));
      }
    }
  }
} 