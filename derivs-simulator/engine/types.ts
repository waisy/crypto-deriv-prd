import { Decimal } from 'decimal.js';
import { User } from './user';
import { Position } from './position';
import { Trade } from './trade';

// Order types
export interface OrderData {
  type: 'place_order';
  userId: string;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  orderType: 'limit' | 'market';
  leverage: number;
  requestId?: number;
}

export interface CancelOrderData {
  type: 'cancel_order';
  orderId: string;
  userId: string;
}

// Market data types
export interface MarkPriceUpdate {
  type: 'update_mark_price';
  price: number;
}

// Liquidation types
export interface LiquidationStepData {
  type: 'liquidation_step';
  method: 'adl' | 'market_order';
}

export interface ManualLiquidateData {
  type: 'manual_liquidate';
  userId: string;
}

// Response types
export interface OrderResponse {
  success: boolean;
  orderId?: string;
  error?: string;
  order?: {
    id: string;
    status: string;
    userId: string;
    side: 'buy' | 'sell';
    size: number;
    price: number;
    orderType: 'limit' | 'market';
    leverage: number;
    timestamp: number;
  };
  trade?: {
    price: number;
    size: number;
    timestamp: number;
  };
}

export interface StateResponse {
  success?: boolean;
  state?: {
    users: UserState[] | { [userId: string]: UserState };
    positions: PositionState[];
    liquidationPositions: LiquidationPositionState[];
    orderBook: OrderBookState;
    markPrice: number;
    insuranceFund: number | { balance: number };
    timestamp: number;
  };
  users?: UserState[] | { [userId: string]: UserState };
  positions?: PositionState[];
  liquidationPositions?: LiquidationPositionState[];
  orderBook?: OrderBookState;
  markPrice?: number;
  insuranceFund?: number | { balance: number };
  timestamp?: number;
}

export interface UserState {
  id: string;
  name: string;
  availableBalance: number;
  usedMargin: number;
  totalBalance: number;
  totalPnL: number;
}

export interface PositionState {
  userId: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  leverage: number;
  unrealizedPnL: number;
  liquidationPrice: number;
  bankruptcyPrice: number;
  initialMargin: number;
  timestamp: number;
}

export interface LiquidationPositionState {
  id: string;
  originalUserId: string;
  side: 'long' | 'short';
  size: number;
  entryPrice?: number;
  bankruptcyPrice: number;
  status: 'pending' | 'processing' | 'completed';
  unrealizedPnL: number;
  timestamp: number;
}

export interface OrderBookState {
  bids: OrderLevel[];
  asks: OrderLevel[];
}

export interface OrderLevel {
  price: number;
  size: number;
  count: number;
}

// Risk management types
export interface RiskLimits {
  maxPositionSize: number;
  maxLeverage: number;
  maxPositionValue: number;
  maxUserPositions: number;
  minOrderSize: number;
}

export interface RiskValidationResult {
  valid: boolean;
  errors: string[];
}

// Zero-sum validation types
export interface ZeroSumResult {
  quantities: {
    long: string;
    short: string;
    difference: string;
  };
  pnl: {
    long: string;
    short: string;
    total: string;
  };
  isQtyBalanced: boolean;
  isPnLBalanced: boolean;
  userPositions: number;
  liquidationPositions: number;
}

// Liquidation types
export interface LiquidationResult {
  positionId: string;
  userId: string;
  side: 'long' | 'short';
  size: string;
  entryPrice: string;
  initialMargin: string;
  bankruptcyPrice: string;
  preLiquidationLoss: string;
  liquidationFee: string;
  timestamp: number;
  method: 'bankruptcy_price' | 'market_order';
  executionPrice: string;
  fills: any[];
  totalExecuted: string;
  remainingBalance: string;
  insuranceFundLoss: string;
}

// ADL types
export interface ADLResult {
  success: boolean;
  positionsProcessed: number;
  trades: ADLTrade[];
  error?: string;
}

export interface ADLTrade {
  lePositionId: string;
  counterpartyUserId: string;
  size: string;
  price: string;
}

// Message handling types
export type ExchangeMessage = 
  | OrderData
  | CancelOrderData
  | MarkPriceUpdate
  | LiquidationStepData
  | ManualLiquidateData
  | { type: 'get_state' }
  | { type: 'getState' }
  | { type: 'reset_state' }
  | { type: 'get_insurance_fund' }
  | { type: 'adjust_insurance_fund'; amount: number; description: string };

export type ExchangeResponse = 
  | OrderResponse
  | StateResponse
  | ADLResult
  | { success: boolean; error?: string };

// Logging types
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogData {
  [key: string]: any;
}

// Trade matching types
export interface TradeMatch {
  buyOrder: any;
  sellOrder: any;
  price: Decimal;
  size: Decimal;
  timestamp: number;
}

// Configuration types
export interface ExchangeConfig {
  initialMarkPrice: number;
  initialIndexPrice: number;
  initialFundingRate: number;
  liquidationEnabled: boolean;
  adlEnabled: boolean;
  logLevel: LogLevel;
  riskLimits: RiskLimits;
} 