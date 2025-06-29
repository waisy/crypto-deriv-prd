import { Decimal } from 'decimal.js';
import { LiquidationPosition, Position, LiquidationStatus } from './position';

export type LiquidationPositionStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ClosureMethod = 'orderbook' | 'adl';
export type HistoryAction = 'position_received' | 'status_change' | 'position_closed';

export interface PositionHistoryEntry {
  action: HistoryAction;
  positionId: string;
  timestamp: number;
  originalUserId?: string;
  bankruptcyPrice?: string;
  transferTime?: number;
  oldStatus?: string;
  newStatus?: string;
  closureMethod?: string;
  closePrice?: string;
  realizedPnL?: string;
  position?: Partial<LiquidationPosition>;
}

export interface LiquidationSummary {
  totalPositions: number;
  totalSize: string;
  totalUnrealizedPnL: string;
  statusCounts: Record<string, number>;
  oldestPositionTime: number | null;
}

export interface PositionWithPnL {
  id: string;
  originalUserId: string;
  size: Decimal;
  avgEntryPrice: Decimal;
  unrealizedPnL: Decimal;
  timeSinceTransfer: number;
  [key: string]: any; // Allow for other LiquidationPosition properties
}

export interface InsuranceFundSufficiency {
  isSufficient: boolean;
  exposure: string;
  available: string;
  shortfall: string;
}

export interface ZeroSumVerification {
  isBalanced: boolean;
  userLongs: string;
  userShorts: string;
  leLongs: string;
  leShorts: string;
  totalLongs: string;
  totalShorts: string;
  difference: string;
}

export interface PositionClosure {
  position: LiquidationPosition;
  realizedPnL: Decimal;
}

export class PositionLiquidationEngine {
  public positions: LiquidationPosition[];
  public nextPositionId: number;
  public positionHistory: PositionHistoryEntry[];

  constructor() {
    this.positions = [];
    this.nextPositionId = 1;
    this.positionHistory = [];
  }

  /**
   * Receives a position from liquidation, transferring it at bankruptcy price
   */
  receivePosition(originalPosition: Position, bankruptcyPrice: Decimal | number | string, userId: string): LiquidationPosition {
    console.log('🔄 POSITION LIQUIDATION ENGINE: RECEIVING POSITION');
    console.log('='.repeat(50));
    console.log(`📥 POSITION TRANSFER TO LIQUIDATION ENGINE:`, {
      originalUserId: userId,
      positionSide: originalPosition.side,
      positionSize: originalPosition.size.toString(),
      bankruptcyPrice: bankruptcyPrice.toString(),
      currentPositionsCount: this.positions.length
    });
    
    const liquidationPosition = new LiquidationPosition(originalPosition, bankruptcyPrice, userId, (this.nextPositionId++).toString());

    this.positions.push(liquidationPosition);
    
    console.log(`✅ POSITION SUCCESSFULLY TRANSFERRED TO LIQUIDATION ENGINE`);
    console.log(`   New LE position ID: ${liquidationPosition.id}`);
    console.log(`   Total LE positions: ${this.positions.length}`);
    console.log(`   🎯 ZERO-SUM MAINTAINED: Position transferred, not destroyed`);
    
    // Log the transfer for audit trail
    this.positionHistory.push({
      action: 'position_received',
      positionId: liquidationPosition.id,
      originalUserId: userId,
      bankruptcyPrice: bankruptcyPrice.toString(),
      transferTime: liquidationPosition.transferTime,
      timestamp: Date.now(),
      position: { ...liquidationPosition }
    });

    console.log('='.repeat(50));
    
    return liquidationPosition;
  }

  /**
   * Calculate unrealized P&L for all liquidation positions
   */
  calculateUnrealizedPnL(currentPrice: Decimal | number | string): Decimal {
    let totalPnL = new Decimal(0);
    
    for (const position of this.positions) {
      const positionPnL = this.calculatePositionPnL(position, currentPrice);
      totalPnL = totalPnL.plus(positionPnL);
    }
    
    return totalPnL;
  }

  /**
   * Calculate P&L for a specific liquidation position
   */
  calculatePositionPnL(position: LiquidationPosition, currentPrice: Decimal | number | string): Decimal {
    return position.calculateUnrealizedPnL(currentPrice);
  }

  /**
   * Get positions by status
   */
  getPositionsByStatus(status: string): LiquidationPosition[] {
    return this.positions.filter(p => p.status === status);
  }

  /**
   * Update position status
   */
  updatePositionStatus(positionId: string, newStatus: LiquidationStatus): void {
    const position = this.positions.find(p => p.id === positionId);
    if (position) {
      const oldStatus = position.status;
      position.status = newStatus;
      position.lastAttemptTime = Date.now();
      
      this.positionHistory.push({
        action: 'status_change',
        positionId: positionId,
        oldStatus: oldStatus,
        newStatus: newStatus,
        timestamp: position.lastAttemptTime
      });
    }
  }

  /**
   * Remove position after successful closure
   */
  removePosition(positionId: string, closureMethod: ClosureMethod, closePrice: Decimal | number | string): PositionClosure | null {
    const positionIndex = this.positions.findIndex(p => p.id === positionId);
    if (positionIndex !== -1) {
      const position = this.positions[positionIndex];
      const realizedPnL = this.calculatePositionPnL(position, closePrice);
      
      // Log closure
      this.positionHistory.push({
        action: 'position_closed',
        positionId: positionId,
        closureMethod: closureMethod,
        closePrice: closePrice.toString(),
        realizedPnL: realizedPnL.toString(),
        timestamp: Date.now(),
        position: { ...position }
      });
      
      // Remove from active positions
      this.positions.splice(positionIndex, 1);
      
      console.log(`Liquidation Engine: Closed position ${positionId} via ${closureMethod} at $${closePrice}, P&L: $${realizedPnL}`);
      
      return {
        position: position,
        realizedPnL: realizedPnL
      };
    }
    return null;
  }

  /**
   * Get summary statistics
   */
  getSummary(currentPrice: Decimal | number | string): LiquidationSummary {
    const totalPositions = this.positions.length;
    const totalUnrealizedPnL = this.calculateUnrealizedPnL(currentPrice);
    
    const statusCounts = this.positions.reduce((acc: Record<string, number>, pos) => {
      acc[pos.status] = (acc[pos.status] || 0) + 1;
      return acc;
    }, {});

    const totalSize = this.positions.reduce((sum, pos) => {
      const size = pos.size instanceof Decimal ? pos.size : new Decimal(pos.size || 0);
      return sum.plus(size);
    }, new Decimal(0));

    return {
      totalPositions,
      totalSize: totalSize.toString(),
      totalUnrealizedPnL: totalUnrealizedPnL.toString(),
      statusCounts,
      oldestPositionTime: totalPositions > 0 
        ? Math.min(...this.positions.map(p => p.transferTime))
        : null
    };
  }

  /**
   * Get all positions with current P&L
   */
  getPositionsWithPnL(currentPrice: Decimal | number | string): PositionWithPnL[] {
    return this.positions.map(position => {
      const unrealizedPnL = this.calculatePositionPnL(position, currentPrice);
      return {
        ...position,
        size: position.size, // Keep as Decimal
        avgEntryPrice: position.avgEntryPrice, // Keep as Decimal
        unrealizedPnL, // Keep as Decimal
        timeSinceTransfer: Date.now() - position.transferTime
      };
    });
  }

  /**
   * Check if liquidation engine can cover positions with insurance fund
   */
  checkInsuranceFundSufficiency(currentPrice: Decimal | number | string, insuranceFundBalance: Decimal): InsuranceFundSufficiency {
    const totalUnrealizedPnL = this.calculateUnrealizedPnL(currentPrice);
    const exposure = totalUnrealizedPnL.isNegative() ? totalUnrealizedPnL.abs() : new Decimal(0);
    
    return {
      isSufficient: insuranceFundBalance.gte(exposure),
      exposure: exposure.toString(),
      available: insuranceFundBalance.toString(),
      shortfall: exposure.gt(insuranceFundBalance) ? exposure.minus(insuranceFundBalance).toString() : '0'
    };
  }

  /**
   * Verify zero-sum invariant including liquidation positions
   */
  verifyZeroSum(userPositions: Position[]): ZeroSumVerification {
    // Calculate user position totals
    let userLongs = new Decimal(0);
    let userShorts = new Decimal(0);
    
    for (const position of userPositions) {
      const size = position.size instanceof Decimal ? position.size : new Decimal(position.size || 0);
      if (position.side === 'long') {
        userLongs = userLongs.plus(size);
      } else {
        userShorts = userShorts.plus(size);
      }
    }

    // Calculate liquidation engine totals
    let leLongs = new Decimal(0);
    let leShorts = new Decimal(0);
    
    for (const position of this.positions) {
      const size = position.size instanceof Decimal ? position.size : new Decimal(position.size || 0);
      if (position.side === 'long') {
        leLongs = leLongs.plus(size);
      } else {
        leShorts = leShorts.plus(size);
      }
    }

    const totalLongs = userLongs.plus(leLongs);
    const totalShorts = userShorts.plus(leShorts);
    const difference = totalLongs.minus(totalShorts);

    return {
      isBalanced: difference.abs().lt(0.00000001), // Allow for tiny rounding errors
      userLongs: userLongs.toString(),
      userShorts: userShorts.toString(),
      leLongs: leLongs.toString(),
      leShorts: leShorts.toString(),
      totalLongs: totalLongs.toString(),
      totalShorts: totalShorts.toString(),
      difference: difference.toString()
    };
  }
}

export default PositionLiquidationEngine;
module.exports = PositionLiquidationEngine; 