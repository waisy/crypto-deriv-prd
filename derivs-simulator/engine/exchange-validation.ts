import { Decimal } from 'decimal.js';
import { ZeroSumResult, LogLevel } from './exchange-types';
import { Position } from './position';

export class ExchangeValidationManager {
  constructor(
    private log: (level: LogLevel, message: string, data?: any) => void
  ) {}

  public calculateZeroSum(
    positions: Map<string, Position>,
    positionLiquidationEngine: any,
    currentMarkPrice: Decimal
  ): ZeroSumResult {
    let totalLongPnL = new Decimal(0);
    let totalShortPnL = new Decimal(0);
    let totalLongQty = new Decimal(0);
    let totalShortQty = new Decimal(0);
    
    // Calculate PnL for a position
    const calculatePnL = (position: Position, isLiquidationPosition = false): Decimal => {
      try {
        // TODO unclear why we have this as separate for position liquidation engine
        if (isLiquidationPosition) {
          return positionLiquidationEngine.calculatePositionPnL(position, currentMarkPrice);
        }

        return position.calculateUnrealizedPnL(currentMarkPrice);

      } catch (error) {
        console.error('Error calculating PnL:', error);
        return new Decimal(0);
      }
    };
    
    // User positions
    for (const [userId, position] of positions) {
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
    const lePositions = positionLiquidationEngine.positions;
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
      userPositions: positions.size,
      liquidationPositions: lePositions.length
    };

    // Log detailed PnL info for debugging
    console.log('📊 ZERO-SUM CHECK DETAILS:', {
      userPositions: Array.from(positions.entries()).map(([userId, pos]) => ({
        userId,
        side: pos.side,
        size: pos.size.toString(),
        pnl: calculatePnL(pos).toString()
      })),
      liquidationPositions: lePositions.map((pos: any) => ({
        id: pos.id,
        side: pos.side,
        size: pos.size.toString(),
        pnl: calculatePnL(pos, true).toString()
      }))
    });

    return result;
  }

  public logZeroSumCheck(
    context: string,
    positions: Map<string, Position>,
    positionLiquidationEngine: any,
    currentMarkPrice: Decimal
  ): ZeroSumResult {
    const zeroSum = this.calculateZeroSum(positions, positionLiquidationEngine, currentMarkPrice);
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
} 