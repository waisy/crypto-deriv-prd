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
    currentMarkPrice: Decimal,
    liquidationEngine: LiquidationEngine,
    marginCalculator: MarginCalculator,
    positionLiquidationEngine: any
  ): Promise<any> {
    const position = positions.get(userId);
    if (!position) {
      throw new Error(`Position for user ${userId} not found.`);
    }

    console.log(`Manually liquidating ${userId}...`);
    
    // CRITICAL FIX: Transfer position to liquidation engine BEFORE liquidation
    this.log('INFO', `🔄 MANUAL LIQUIDATION: TRANSFERRING POSITION TO LIQUIDATION ENGINE`);
    const bankruptcyPrice = marginCalculator.calculateBankruptcyPrice(position as any);
    const transferredPosition = positionLiquidationEngine.receivePosition(position, bankruptcyPrice, userId);
    
    this.log('INFO', `📝 Manual liquidation: Position transferred to liquidation engine with ID: ${transferredPosition.id}`);
    
    const result = await liquidationEngine.liquidate(position, currentMarkPrice, positions, true);
    
    // Remove position after liquidation (now it's transferred, not destroyed)
    this.log('DEBUG', `Manual liquidation: Removing position from user positions map (transferred to liquidation engine)`);
    positions.delete(userId);

    return {
      success: true,
      liquidationResult: result,
      transferredPosition
    };
  }

  public async executeADLStep(
    stateManager: any,
    orderManager: any,
    positionManager: any
  ): Promise<any> {
    this.log('INFO', `🔄 EXECUTING ADL STEP`);
    
    const lePositions = stateManager.positionLiquidationEngine.positions;
    const results: any[] = [];
    let executedCount = 0;

    this.log('INFO', `🔄 EXECUTING ADL for ${lePositions.length} liquidation positions`);
    
    for (const lePosition of lePositions) {
      try {
        // Skip positions without valid side
        if (!lePosition.side) {
          this.log('WARN', `Skipping liquidation position ${lePosition.id} - no valid side`);
          continue;
        }
        
        // Get the ADL socialization amount for this position
        const socializationAmount = stateManager.state.adlSocializationAmounts.get(lePosition.id) || 0;
        
        console.log(`💰 ADL SOCIALIZATION CHECK for position ${lePosition.id}:`, {
          socializationRequired: socializationAmount?.toString() || '0',
          originalUser: lePosition.originalUserId
        });
        
        // Create ADL-compatible position object
        const adlPosition = {
          id: lePosition.id,
          side: lePosition.side as 'long' | 'short',  // Type assertion since we checked above
          size: lePosition.size,  // Explicitly include getter property
          userId: lePosition.originalUserId
        };
        
        // Plan the ADL trades first with socialization amount
        const adlPlan = stateManager.adlEngine.planADL(
          adlPosition, 
          stateManager.state.positions, 
          stateManager.state.users, 
          stateManager.state.currentMarkPrice, 
          socializationAmount
        );
        
        if (!adlPlan.success) {
          this.log('ERROR', `❌ ADL PLANNING FAILED for position ${lePosition.id}`, adlPlan.error);
          results.push({ positionId: lePosition.id, method: 'adl', success: false, error: adlPlan.error });
          continue;
        }

        this.log('INFO', `✅ ADL PLAN CREATED for position ${lePosition.id}`, { trades: adlPlan.trades });

        // Execute the forced trades from the plan
        for (const adlTrade of adlPlan.trades) {
          const { counterpartyUserId, size, price } = adlTrade;
          
          // For ADL, we want to close both positions
          // The LE position needs to do the OPPOSITE of their current side to close
          const leSide = lePosition.side === 'long' ? 'sell' : 'buy';  // CLOSE by doing opposite
          const counterpartySide = leSide === 'buy' ? 'sell' : 'buy';
          
          this.log('INFO', `🔨 PLANNING ADL TRADE`, {
            lePositionId: lePosition.id,
            originalUserId: lePosition.originalUserId,
            counterparty: counterpartyUserId,
            lePositionSide: lePosition.side,
            closingSide: leSide,
            size,
            price
          });
          
          // Create forced orders for both sides
          const leOrder = {
            id: `le_adl_${Date.now()}_${lePosition.id}`,
            userId: 'liquidation_engine',
            side: leSide,
            size: new Decimal(size),
            remainingSize: new Decimal(size),
            filledSize: new Decimal(0),
            price: new Decimal(price),
            avgFillPrice: new Decimal(0),
            type: 'adl',
            leverage: 1,
            timestamp: Date.now(),
            lastUpdateTime: Date.now(),
            status: 'NEW',
            timeInForce: 'IOC',
            fills: [],
            totalValue: new Decimal(0),
            commission: new Decimal(0),
            marginReserved: new Decimal(0),
            isLiquidation: true,
            lePositionId: lePosition.id
          };
          
          const counterpartyOrder = {
            id: `adl_counterparty_${Date.now()}_${counterpartyUserId}`,
            userId: counterpartyUserId,
            side: counterpartySide,
            size: new Decimal(size),
            remainingSize: new Decimal(size),
            filledSize: new Decimal(0),
            price: new Decimal(price),
            avgFillPrice: new Decimal(0),
            type: 'adl',
            leverage: 1,
            timestamp: Date.now(),
            lastUpdateTime: Date.now(),
            status: 'NEW',
            timeInForce: 'IOC',
            fills: [],
            totalValue: new Decimal(0),
            commission: new Decimal(0),
            marginReserved: new Decimal(0),
            isADL: true
          };
          
          // Execute the ADL trade
          const match = {
            buyOrder: leSide === 'buy' ? leOrder : counterpartyOrder,
            sellOrder: leSide === 'sell' ? leOrder : counterpartyOrder,
            price: new Decimal(price),
            size: new Decimal(size)
          };
          
          // Process the trade using the order manager
          const tradeResult = orderManager.processTrade(
            match,
            stateManager.state.currentMarkPrice,
            stateManager.adlEngine,
            stateManager.state.trades
          );
          
          // Add trade record to history
          stateManager.state.trades.push(tradeResult.tradeRecord);
          
          // Add trades to positions (this will handle ADL closure logic)
          positionManager.addTradeToPosition(
            tradeResult.buyTrade,
            stateManager.state.users,
            stateManager.state.positions,
            stateManager.state.currentMarkPrice,
            stateManager.positionLiquidationEngine
          );
          
          positionManager.addTradeToPosition(
            tradeResult.sellTrade,
            stateManager.state.users,
            stateManager.state.positions,
            stateManager.state.currentMarkPrice,
            stateManager.positionLiquidationEngine
          );
          
          this.log('INFO', `✅ ADL TRADE EXECUTED`, {
            lePositionId: lePosition.id,
            counterparty: counterpartyUserId,
            size: size.toString(),
            price: price.toString()
          });
        }
        
        // Remove the position from liquidation engine
        const closureResult = stateManager.positionLiquidationEngine.removePosition(
          lePosition.id, 
          'adl', 
          new Decimal(adlPlan.trades[0].price)
        );
        
        results.push({
          positionId: lePosition.id,
          method: 'adl',
          executed: lePosition.size.toString(),
          price: adlPlan.trades[0].price.toString(),
          realizedPnL: closureResult?.realizedPnL?.toString() || '0',
          success: true
        });
        
        executedCount++;
      } catch (error: any) {
        this.log('ERROR', `ADL execution failed for position ${lePosition.id}:`, error);
        results.push({
          positionId: lePosition.id,
          method: 'adl',
          error: error.message,
          success: false
        });
      }
    }

    return {
      success: true,
      method: 'adl',
      executed: executedCount,
      total: lePositions.length,
      results
    };
  }
} 