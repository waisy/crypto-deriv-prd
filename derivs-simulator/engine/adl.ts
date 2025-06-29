import { Decimal } from 'decimal.js';
import { Position } from './position';
import { User } from './user';

export interface ADLQueueItem {
  positionId: string;
  userId: string;
  side: 'long' | 'short';
  size: string;
  unrealizedPnL: string;
  adlScore: number;
  adlRank: number;
  adlIndicator: number;
}

export interface ADLTrade {
  counterpartyUserId: string;
  size: string;
  price: string;
}

export interface ADLPlanResult {
  success: boolean;
  error?: string;
  trades: ADLTrade[];
  lePositionId?: string | number;
  socializationAmount?: number;
  adlPrice?: string;
  markPrice?: string;
}

export interface ADLSimulationResult {
  canCover: boolean;
  affectedUsers: ADLAffectedUser[];
  totalAffected: number;
}

export interface ADLAffectedUser {
  userId: string;
  positionId: string;
  closeAmount: number;
  impactPercentage: number;
}

export interface LiquidationPosition {
  id: string | number;
  side: 'long' | 'short';
  size: Decimal | string | number;
  userId?: string;
  [key: string]: any;
}

export interface ADLScoreComponents {
  profitPercentage: string;
  effectiveLeverage: string;
}

export class ADLEngine {
  public adlTriggerThreshold: number;
  public lastSocializationPrice: Decimal | null;

  constructor() {
    this.adlTriggerThreshold = 50000;
    this.lastSocializationPrice = null;
  }

  getLastSocializationPrice(): Decimal | null {
    return this.lastSocializationPrice;
  }

  calculateADLScore(position: Position, userBalance: Decimal | number | string, currentPrice: Decimal | number | string): number {
    try {
      if (!position || !userBalance || !currentPrice) {
        throw new Error('Missing required parameters for ADL score calculation');
      }

      const size = position.size instanceof Decimal ? position.size : new Decimal(position.size || 0);
      const avgEntryPrice = position.avgEntryPrice instanceof Decimal ? position.avgEntryPrice : 
        new Decimal(position.avgEntryPrice || 0);
      const currentPriceDec = currentPrice instanceof Decimal ? currentPrice : new Decimal(currentPrice);
      
      let unrealizedPnL: Decimal;
      try {
        if (typeof position.calculateUnrealizedPnL === 'function') {
          unrealizedPnL = position.calculateUnrealizedPnL(currentPriceDec);
        } else if (position.unrealizedPnL) {
          unrealizedPnL = new Decimal(position.unrealizedPnL);
        } else {
          unrealizedPnL = Position.calculateUnrealizedPnLStatic(
            position.side || 'long', 
            avgEntryPrice.toString(), 
            currentPriceDec.toString(), 
            size.toString()
          );
        }
      } catch (pnlError) {
        console.error('❌ Failed to calculate PnL:', pnlError);
        throw pnlError;
      }
      
      const userBal = new Decimal(userBalance);
      const positionValue = position.getPositionValue();
      
      if (positionValue.isZero()) {
        console.warn('⚠️ Position value is zero, skipping ADL score calculation');
        return 0;
      }
      
      const profitPercentage = unrealizedPnL.dividedBy(positionValue);
      const totalEquity = userBal.plus(unrealizedPnL);
      
      if (totalEquity.isZero() || totalEquity.isNegative()) {
        console.warn('⚠️ Total equity is zero or negative, skipping ADL score calculation');
        return 0;
      }
      
      const effectiveLeverage = positionValue.dividedBy(totalEquity);
      const adlScore = profitPercentage.times(effectiveLeverage);
      
      return adlScore.toNumber();
    } catch (error) {
      console.error('❌ ADL Score calculation failed:', error);
      return 0;
    }
  }

  getADLQueue(positions: Position[], currentPrice: Decimal | number | string): ADLQueueItem[] {
    const queue: ADLQueueItem[] = [];
    
    positions.forEach(position => {
      const pnl = position.calculateUnrealizedPnL(currentPrice);
  
      if (pnl.greaterThan(0)) {
        const adlScore = (position as any).adlScore || 0;
                  queue.push({
            positionId: position.userId,
            userId: position.userId,
            side: position.side || 'long',
            size: position.size.toString(),
            unrealizedPnL: pnl.toString(),
            adlScore,
            adlRank: 0,
            adlIndicator: 0
          });
      }
    });
    
    queue.sort((a, b) => b.adlScore - a.adlScore);
    
    queue.forEach((item, index) => {
      item.adlRank = index + 1;
      item.adlIndicator = this.getADLIndicator(index, queue.length);
    });
    
    return queue;
  }

  getADLIndicator(rank: number, totalPositions: number): number {
    if (totalPositions === 0) return 0;
    
    const percentage = (rank / totalPositions) * 100;
    
    if (percentage <= 20) return 5;
    if (percentage <= 40) return 4;
    if (percentage <= 60) return 3;
    if (percentage <= 80) return 2;
    return 1;
  }

  executeADL(positions: any, requiredAmount: any, bankruptPosition: any): { success: false; error: string } {
    console.warn('DEPRECATED: executeADL should not be called directly. Use planADL.');
    return { success: false, error: 'Deprecated function' };
  }

  planADL(
    lePosition: LiquidationPosition, 
    allUserPositions: Map<string, Position>, 
    users: Map<string, User>, 
    markPrice: Decimal | number | string, 
    requiredSocializationAmount: number = 0
  ): ADLPlanResult {
    try {
      if (!lePosition || !allUserPositions || !users || !markPrice) {
        return {
          success: false,
          error: 'Invalid arguments for planning ADL',
          trades: []
        };
      }

      if (!lePosition.side || !lePosition.size) {
        return {
          success: false,
          error: 'Invalid liquidation position data',
          trades: []
        };
      }
      
      const oppositeSide = lePosition.side === 'long' ? 'short' : 'long';
      const profitableCounterparties: Array<{ userId: string; unrealizedPnL: Decimal; size: Decimal }> = [];
      
      allUserPositions.forEach((position, userId) => {
        if (position.side === oppositeSide) {
          const pnl = position.calculateUnrealizedPnL(markPrice);
          if (pnl.greaterThan(0)) {
            profitableCounterparties.push({
              userId,
              unrealizedPnL: pnl,
              size: position.size
            });
          }
        }
      });
      
      if (profitableCounterparties.length === 0) {
        return {
          success: false,
          error: 'No profitable counterparties available for ADL',
          trades: []
        };
      }
      
      profitableCounterparties.sort((a, b) => {
        const aPosition = allUserPositions.get(a.userId);
        const bPosition = allUserPositions.get(b.userId);
        const aUser = users.get(a.userId);
        const bUser = users.get(b.userId);
        
        if (!aPosition || !bPosition || !aUser || !bUser) return 0;
        
        const aScore = this.calculateADLScore(aPosition, aUser.availableBalance, markPrice);
        const bScore = this.calculateADLScore(bPosition, bUser.availableBalance, markPrice);
        
        return bScore - aScore;
      });
      
      const markPriceDec = new Decimal(markPrice);
      let adlPrice: Decimal;
      
      if (requiredSocializationAmount > 0) {
        adlPrice = this.calculateADLSocializationPrice(
          lePosition,
          profitableCounterparties,
          markPriceDec,
          requiredSocializationAmount
        );
      } else {
        adlPrice = markPriceDec;
      }

      const adlTrades: ADLTrade[] = [];
      let remainingSizeToClose = new Decimal(lePosition.size);

      for (const counterparty of profitableCounterparties) {
        if (remainingSizeToClose.isZero() || remainingSizeToClose.isNegative()) break;
        
        const counterpartyPosition = allUserPositions.get(counterparty.userId);
        if (!counterpartyPosition) continue;

        try {
          const availableSize = new Decimal(counterpartyPosition.size);
          const tradeSize = Decimal.min(remainingSizeToClose, availableSize);
          
          adlTrades.push({
            counterpartyUserId: counterparty.userId,
            size: tradeSize.toString(),
            price: adlPrice.toString()
          });
          
          remainingSizeToClose = remainingSizeToClose.minus(tradeSize);
        } catch (tradeError) {
          console.error('❌ Error planning trade with counterparty:', tradeError);
        }
      }
      
      const success = remainingSizeToClose.isZero() || remainingSizeToClose.isNegative();
      if (!success) {
        return {
          success: false,
          error: `Failed to find enough liquidity. Shortfall: ${remainingSizeToClose.toString()} BTC`,
          trades: adlTrades
        };
      }

      return {
        success: true,
        lePositionId: lePosition.id,
        trades: adlTrades,
        socializationAmount: requiredSocializationAmount || 0,
        adlPrice: adlPrice.toString(),
        markPrice: markPriceDec.toString()
      };
    } catch (error) {
      console.error('❌ Catastrophic ADL planning error:', error);
      return {
        success: false,
        error: (error as Error).message || 'Unknown ADL planning error',
        trades: []
      };
    }
  }

  calculateADLSocializationPrice(
    lePosition: LiquidationPosition, 
    profitableCounterparties: Array<{ userId: string; unrealizedPnL: Decimal; size: Decimal }>, 
    markPrice: Decimal, 
    socializationAmount: number
  ): Decimal {
    try {
      const decSocializationAmount = new Decimal(socializationAmount);
      
      const totalCounterpartySize = profitableCounterparties.reduce((sum, pos) => {
        return sum.plus(pos.size);
      }, new Decimal(0));

      if (totalCounterpartySize.isZero()) {
        throw new Error('No counterparty size available for ADL');
      }

      const priceAdjustment = decSocializationAmount.dividedBy(totalCounterpartySize);
      
      if (lePosition.side === 'long') {
        this.lastSocializationPrice = markPrice.plus(priceAdjustment);
      } else {
        this.lastSocializationPrice = markPrice.minus(priceAdjustment);
      }

      return this.lastSocializationPrice;
    } catch (error) {
      console.error('❌ Error calculating ADL socialization price:', error);
      throw error;
    }
  }

  shouldTriggerADL(insuranceFundBalance: number, requiredAmount: number): boolean {
    return insuranceFundBalance < requiredAmount;
  }

  simulateADL(
    positions: Map<string, Position>, 
    requiredAmount: number, 
    bankruptPosition: Position, 
    currentPrice?: Decimal | number | string
  ): ADLSimulationResult {
    const priceToUse = currentPrice || bankruptPosition.avgEntryPrice;
    const adlQueue = this.getADLQueue(Array.from(positions.values()), priceToUse);
    const affectedUsers: ADLAffectedUser[] = [];
    let remainingAmount = requiredAmount;
    
    for (const queueItem of adlQueue) {
      if (remainingAmount <= 0) break;
      
      const position = positions.get(queueItem.userId);
      if (!position || position.side === bankruptPosition.side) continue;
      
      const positionValue = position.getPositionValueAtPrice(bankruptPosition.avgEntryPrice);
      const remainingAmountDec = new Decimal(remainingAmount);
      const closeAmount = Decimal.min(remainingAmountDec, positionValue);
      
      affectedUsers.push({
        userId: position.userId,
        positionId: queueItem.positionId,
        closeAmount: closeAmount.toNumber(),
        impactPercentage: closeAmount.dividedBy(positionValue).times(100).toNumber()
      });
      
      remainingAmount -= closeAmount.toNumber();
    }
    
    return {
      canCover: remainingAmount <= 0,
      affectedUsers,
      totalAffected: affectedUsers.length
    };
  }

  getQueue(positions: Map<string, Position>, users: Map<string, User>, currentPrice: Decimal | number | string): ADLQueueItem[] {
    if (!positions || !users || !currentPrice) {
      return [];
    }
    
    const positionsArray = Array.from(positions.values());
    
    positionsArray.forEach(position => {
      const pnl = new Decimal(position.unrealizedPnL || 0);
      if (pnl.greaterThan(0)) {
        const user = users.get(position.userId);
        if (user) {
          const userBalance = user.availableBalance;
          (position as any).adlScore = this.calculateADLScore(position, userBalance, currentPrice);
        }
      }
    });
    
    return this.getADLQueue(positionsArray, currentPrice);
  }
} 