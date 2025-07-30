import { Decimal } from 'decimal.js';
import { RiskLimits } from './exchange-types';
import { Position } from './position';

export class ExchangeRiskManager {
  public validateRiskLimits(
    userId: string, 
    side: 'buy' | 'sell', 
    size: number, 
    price: number, 
    leverage: number,
    riskLimits: RiskLimits,
    existingPosition?: Position
  ): void {
    const decSize = new Decimal(size);
    const decPrice = new Decimal(price);
    
    if (decSize.greaterThan(riskLimits.maxPositionSize)) {
      throw new Error(`Position size exceeds limit.`);
    }
    
    const positionValue = decSize.times(decPrice);
    if (positionValue.greaterThan(riskLimits.maxPositionValue)) {
      throw new Error(`Position value exceeds limit.`);
    }
    
    // Check total position size including existing positions
    if (existingPosition) {
      // Convert order side to position side for comparison
      const positionSide = side === 'buy' ? 'long' : 'short';
      
      if (existingPosition.side === positionSide) {
        const totalSize = existingPosition.size.plus(decSize);
        if (totalSize.greaterThan(riskLimits.maxPositionSize)) {
          throw new Error(`Total position size would exceed limit.`);
        }
        
        const totalValue = totalSize.times(decPrice);
        if (totalValue.greaterThan(riskLimits.maxPositionValue)) {
          throw new Error(`Total position value would exceed limit.`);
        }
      }
    }
  }
} 