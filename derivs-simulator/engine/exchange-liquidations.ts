import { Decimal } from 'decimal.js';
import { LogLevel } from './exchange-types';
import { User } from './user';
import { Position } from './position';
import { LiquidationEngine } from './liquidation';
import { MarginCalculator } from './margin';

export class ExchangeLiquidationManager {
  constructor(
    private log: (level: LogLevel, message: string, data?: any) => void
  ) {}

  public async checkLiquidations(
    positions: Map<string, Position>,
    users: Map<string, User>,
    currentMarkPrice: Decimal,
    liquidationEngine: LiquidationEngine,
    marginCalculator: MarginCalculator,
    positionLiquidationEngine: any,
    adlSocializationAmounts: Map<string, number>,
    liquidationEnabled: boolean
  ): Promise<any[]> {
    const liquidations: any[] = [];
    this.log('DEBUG', `Checking liquidations for ${positions.size} positions`);
    
    if (!liquidationEnabled) {
      this.log('DEBUG', '⏸️ Liquidation processing is disabled');
      return liquidations;
    }
    
    for (const [userId, position] of positions.entries()) {
      const shouldLiquidate = liquidationEngine.shouldLiquidate(position, currentMarkPrice);
      
      this.log('DEBUG', `Liquidation check for ${userId}`, {
        positionSide: position.side,
        positionSize: position.size.toString(),
        unrealizedPnL: position.unrealizedPnL.toString(),
        liquidationPrice: position.liquidationPrice.toString(),
        currentPrice: currentMarkPrice.toString(),
        shouldLiquidate
      });
      
      if (shouldLiquidate) {
        this.log('ERROR', `🚨 LIQUIDATION TRIGGERED for ${userId}`, {
          positionSide: position.side,
          positionSize: position.size.toString(),
          entryPrice: position.avgEntryPrice.toString(),
          currentPrice: currentMarkPrice.toString(),
          liquidationPrice: position.liquidationPrice.toString(),
          unrealizedPnL: position.unrealizedPnL.toString()
        });
        
        console.log(`Liquidating ${userId}...`);
        
        // CRITICAL FIX: Transfer position to liquidation engine BEFORE liquidation
        this.log('INFO', `🔄 TRANSFERRING POSITION TO LIQUIDATION ENGINE`);
        const bankruptcyPrice = marginCalculator.calculateBankruptcyPrice(position as any);
        const transferredPosition = positionLiquidationEngine.receivePosition(position, bankruptcyPrice, userId);
        
        this.log('INFO', `📝 Position transferred to liquidation engine with ID: ${transferredPosition.id}`);
        
        const result = await liquidationEngine.liquidate(position, currentMarkPrice, positions);
        liquidations.push(result);
        
        this.log('INFO', `🔥 LIQUIDATION COMPLETED for ${userId}`, result);
        
        // CRITICAL: Track ADL socialization requirements
        if (result.adlSocializationRequired && transferredPosition) {
          const socializationAmount = new Decimal(result.adlSocializationRequired);
          adlSocializationAmounts.set(transferredPosition.id, socializationAmount.toNumber());
          this.log('INFO', `💰 ADL SOCIALIZATION REQUIRED for position ${transferredPosition.id}`, {
            amount: socializationAmount.toString(),
            originalUser: userId,
            reason: 'Beyond-margin loss exceeds insurance fund'
          });
        }
        
        // Handle margin return if any - ISOLATED MARGIN LOGIC
        const user = users.get(userId);
        if (user) {
          // In isolated margin, user should only lose their margin amount, never more
          const marginAmount = position.initialMargin;
          const remainingMargin = new Decimal(result.remainingBalance || 0);
          
          this.log('INFO', `🔍 ISOLATED MARGIN LIQUIDATION ACCOUNTING`, {
            userId,
            initialMargin: marginAmount.toString(),
            remainingBalance: remainingMargin.toString(),
            currentUsedMargin: user.usedMargin.toString(),
            currentAvailableBalance: user.availableBalance.toString()
          });
          
          if (remainingMargin.greaterThan(0)) {
            // User has some margin left - return it
            user.usedMargin = user.usedMargin.minus(marginAmount);
            user.availableBalance = user.availableBalance.plus(remainingMargin);
            
            // Transfer the lost portion to Insurance Fund
            const marginLost = marginAmount.minus(remainingMargin);
            if (marginLost.greaterThan(0)) {
              liquidationEngine.manualAdjustment(marginLost, `Partial liquidation margin loss from ${userId}`, 'liquidation_margin');
            }
            
            this.log('INFO', `💰 PARTIAL MARGIN RETURN to ${userId}`, {
              marginReturned: remainingMargin.toString(),
              marginLost: marginLost.toString(),
              newUsedMargin: user.usedMargin.toString(),
              newAvailableBalance: user.availableBalance.toString(),
              insuranceFundTransfer: marginLost.toString()
            });
          } else {
            // User lost entire margin (isolated margin max loss)
            user.usedMargin = user.usedMargin.minus(marginAmount);
            // Available balance stays the same - user only loses the margin that was already reserved
            
            // CRITICAL FIX: Transfer lost margin to Insurance Fund to maintain zero-sum
            liquidationEngine.manualAdjustment(marginAmount, `Liquidation margin loss from ${userId}`, 'liquidation_margin');
            
            this.log('INFO', `💸 MARGIN LOST in liquidation (isolated margin max loss)`, {
              userId,
              marginLost: marginAmount.toString(),
              newUsedMargin: user.usedMargin.toString(),
              availableBalance: user.availableBalance.toString(),
              insuranceFundTransfer: marginAmount.toString(),
              note: 'Lost margin transferred to Insurance Fund - zero-sum maintained'
            });
          }
        }
        
        // Remove position after liquidation (now it's transferred, not destroyed)
        this.log('DEBUG', `Removing position from user positions map (transferred to liquidation engine)`);
        positions.delete(userId);
      }
    }
    
    if (liquidations.length === 0) {
      this.log('DEBUG', '✅ No liquidations required');
    } else {
      this.log('INFO', `⚡ ${liquidations.length} liquidation(s) executed`);
    }
    
    return liquidations;
  }

  public detectLiquidations(
    positions: Map<string, Position>,
    liquidationEngine: LiquidationEngine,
    marginCalculator: MarginCalculator,
    currentMarkPrice: Decimal
  ): { success: boolean; liquidationsDetected: number; liquidations: any[]; state: any } {
    const liquidationsToDetect: any[] = [];
    this.log('DEBUG', `Detecting liquidations for ${positions.size} positions (no execution)`);
    
    for (const [userId, position] of positions.entries()) {
      const shouldLiquidate = liquidationEngine.shouldLiquidate(position, currentMarkPrice);
      
      if (shouldLiquidate) {
        const bankruptcyPrice = marginCalculator.calculateBankruptcyPrice(position as any);
        
        liquidationsToDetect.push({
          userId,
          positionSide: position.side,
          positionSize: position.size.toString(),
          entryPrice: position.avgEntryPrice.toString(),
          currentPrice: currentMarkPrice.toString(),
          liquidationPrice: position.liquidationPrice.toString(),
          bankruptcyPrice: bankruptcyPrice.toString(),
          unrealizedPnL: position.unrealizedPnL.toString(),
          initialMargin: position.initialMargin.toString()
        });
        
        this.log('INFO', `🔍 LIQUIDATION DETECTED (not executed) for ${userId}`, {
          positionSide: position.side,
          positionSize: position.size.toString(),
          entryPrice: position.avgEntryPrice.toString(),
          currentPrice: currentMarkPrice.toString(),
          liquidationPrice: position.liquidationPrice.toString(),
          bankruptcyPrice: bankruptcyPrice.toString(),
          unrealizedPnL: position.unrealizedPnL.toString()
        });
      }
    }
    
    return {
      success: true,
      liquidationsDetected: liquidationsToDetect.length,
      liquidations: liquidationsToDetect,
      state: null // Will be filled by caller
    };
  }

  public async manualLiquidate(
    userId: string,
    positions: Map<string, Position>,
    users: Map<string, User>,
    liquidationEngine: LiquidationEngine,
    marginCalculator: MarginCalculator,
    positionLiquidationEngine: any,
    currentMarkPrice: Decimal
  ): Promise<any> {
    const position = positions.get(userId);
    if (!position) {
      return {
        success: false,
        error: `Position for user ${userId} not found`,
        state: null
      };
    }

    // Check if liquidation is warranted
    const shouldLiquidate = liquidationEngine.shouldLiquidate(position, currentMarkPrice);
    if (!shouldLiquidate) {
      return {
        success: false,
        error: `Position for user ${userId} does not meet liquidation criteria`,
        currentPrice: currentMarkPrice.toString(),
        liquidationPrice: position.liquidationPrice.toString(),
        state: null
      };
    }

    this.log('INFO', `🔧 MANUAL LIQUIDATION REQUESTED for ${userId}`, {
      positionSide: position.side,
      positionSize: position.size.toString(),
      entryPrice: position.avgEntryPrice.toString(),
      currentPrice: currentMarkPrice.toString(),
      liquidationPrice: position.liquidationPrice.toString(),
      unrealizedPnL: position.unrealizedPnL.toString()
    });
    
    // Transfer position to liquidation engine at bankruptcy price
    const bankruptcyPrice = marginCalculator.calculateBankruptcyPrice(position as any);
    const transferredPosition = positionLiquidationEngine.receivePosition(position, bankruptcyPrice, userId);
    
    this.log('INFO', `📝 Manual liquidation: Position transferred to liquidation engine with ID: ${transferredPosition.id}`);
    
    // Handle margin accounting - user loses their margin in isolated margin system
    const user = users.get(userId);
    if (user) {
      const marginAmount = position.initialMargin;
      
      // User loses entire margin (isolated margin max loss)
      user.usedMargin = user.usedMargin.minus(marginAmount);
      // Available balance stays the same - margin was already reserved
      
      // CRITICAL FIX: Transfer lost margin to Insurance Fund to maintain zero-sum
      liquidationEngine.manualAdjustment(marginAmount, `Manual liquidation margin loss from ${userId}`, 'liquidation_margin');
      
      this.log('INFO', `💸 MARGIN LOST in manual liquidation (isolated margin max loss)`, {
        userId,
        marginLost: marginAmount.toString(),
        newUsedMargin: user.usedMargin.toString(),
        availableBalance: user.availableBalance.toString(),
        insuranceFundTransfer: marginAmount.toString(),
        note: 'Lost margin transferred to Insurance Fund - zero-sum maintained'
      });
    }
    
    // Remove position from user positions (now transferred to liquidation engine)
    positions.delete(userId);
    
    return {
      success: true,
      message: `Position for ${userId} manually liquidated and transferred to liquidation engine`,
      transferredPosition: {
        id: transferredPosition.id,
        originalUserId: transferredPosition.originalUserId,
        side: transferredPosition.side,
        size: transferredPosition.size.toString(),
        entryPrice: transferredPosition.avgEntryPrice.toString(),
        bankruptcyPrice: bankruptcyPrice.toString()
      },
      state: null // Will be filled by caller
    };
  }
} 