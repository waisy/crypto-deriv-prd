import { Decimal } from 'decimal.js';
import { User } from './user';
import { Position } from './position';
import { Trade } from './trade';

export interface RiskLimits {
  maxPositionSize: number;
  maxLeverage: number;
  maxPositionValue: number;
  maxUserPositions: number;
  minOrderSize: number;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface OrderData {
  userId: string;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  orderType: 'limit' | 'market';
  leverage?: number;
}

export interface TradeMatch {
  buyOrder: any;
  sellOrder: any;
  price: Decimal;
  size: Decimal;
}

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

export interface ExchangeState {
  users: Map<string, User>;
  positions: Map<string, Position>;
  trades: any[];
  currentMarkPrice: Decimal;
  indexPrice: Decimal;
  fundingRate: Decimal;
  adlSocializationAmounts: Map<string, number>;
  logLevel: LogLevel;
  liquidationEnabled: boolean;
  adlEnabled: boolean;
  riskLimits: RiskLimits;
}

export interface MessageData {
  type: string;
  [key: string]: any;
}

export interface OrderResult {
  success: boolean;
  order?: any;
  matches?: any[];
  liquidations?: any[];
  state?: any;
  error?: string;
}

export interface LiquidationResult {
  success: boolean;
  liquidationResult?: any;
  state?: any;
  error?: string;
} 