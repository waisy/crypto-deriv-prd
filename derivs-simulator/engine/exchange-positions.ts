import { Decimal } from 'decimal.js';
import { LogLevel } from './exchange-types';
import { User } from './user';
import { Position } from './position';
import { Trade } from './trade';

export class ExchangePositionManager {
  constructor(
    private log: (level: LogLevel, message: string, data?: any) => void
  ) {}

  public addTradeToPosition(
    trade: Trade,
    users: Map<string, User>,
    positions: Map<string, Position>,
    currentMarkPrice: Decimal,
    positionLiquidationEngine: any
  ): void {
    const userId = trade.userId;
    
    // Special handling for liquidation engine positions
    if (userId === 'liquidation_engine') {
      this.handleLiquidationEnginePositionTrade(trade, positionLiquidationEngine);
      return;
    }

    // Regular user position handling
    const positionKey = userId;
    let position = positions.get(positionKey);
    
    // Check if user exists
    const user = users.get(userId);
    if (!user) {
      this.log('ERROR', `❌ User not found for trade`, {
        userId,
        availableUsers: Array.from(users.keys())
      });
      return;
    }
    
    this.log('DEBUG', `📈 ADDING TRADE TO POSITION`, {
      userId,
      side: trade.side,
      size: trade.size.toString(),
      price: trade.price.toString(),
      hasExistingPosition: !!position
    });
    
    if (!position) {
      this.log('INFO', `🆕 CREATING NEW POSITION`, {
        userId,
        side: trade.side,
        size: trade.size.toString(),
        price: trade.price.toString(),
        leverage: trade.leverage
      });
      
      position = new Position(userId, trade.leverage, trade);
      positions.set(positionKey, position);
      
      // NOTE: Margin was already reserved during order placement
      // No need to add it again here - that would be double counting
      const reservedMargin = position.initialMargin;
      
      this.log('DEBUG', `Position created successfully`, {
        positionSize: position.size.toString(),
        positionSide: position.side,
        reservedMargin: reservedMargin.toString(),
        userUsedMargin: user.usedMargin.toString(),
        note: 'Margin already reserved at order placement - no double counting'
      });
    } else {
      this.log('INFO', `📊 ADDING TRADE TO EXISTING POSITION`, {
        userId,
        tradeSide: trade.side,
        tradeSize: trade.size.toString(),
        currentPositionSide: position.side,
        currentPositionSize: position.size.toString()
      });
      
      // Calculate position impact before adding trade
      const oldSize = position.size;
      const oldSide = position.side;
      const oldMargin = position.initialMargin;
      const oldUnrealizedPnL = position.calculateUnrealizedPnL(currentMarkPrice);
      
      // Determine if this trade reduces the position
      const isReducingTrade = oldSide && !trade.wouldIncrease(oldSide);
      
      // Add the trade to position
      position.addTrade(trade);
      
      // Calculate new position state  
      const newSize = position.size;
      const newMargin = position.initialMargin;
      const marginDelta = newMargin.minus(oldMargin);
      
      if (isReducingTrade && !oldSize.isZero()) {
        // Check if this is an ADL trade - ADL uses different logic
        if (trade.tradeType === 'adl') {
          // ADL POSITION CLOSURE - No P&L realization, just margin release
          const marginReleased = newSize.isZero() ? oldMargin : oldMargin.times(oldSize.minus(newSize).dividedBy(oldSize));
          
          this.log('INFO', `🎯 ADL POSITION CLOSURE - MARGIN RELEASE ONLY`, {
            userId,
            isFullClosure: newSize.isZero(),
            marginReleased: marginReleased.toString(),
            note: 'ADL does not realize P&L - uses socialization instead'
          });
          
          // Release margin back to available balance (no P&L realization)
          user.releaseMargin(marginReleased);
          
          this.log('INFO', `✅ ADL MARGIN RELEASED (NO P&L REALIZATION)`, {
            userId,
            marginReleased: marginReleased.toString(),
            newAvailableBalance: user.availableBalance.toString(),
            newUsedMargin: user.usedMargin.toString(),
            oldUnrealizedPnL: oldUnrealizedPnL.toString(),
            note: 'Unrealized P&L handled via ADL socialization'
          });
          
        } else {
          // NORMAL TRADE - PROPORTIONAL P&L REALIZATION for position reduction
          let realizedPnL = new Decimal(0);
          let marginReleased = new Decimal(0);
          
          if (newSize.isZero()) {
            // Full position closure - realize all P&L and release all margin
            realizedPnL = oldUnrealizedPnL;
            marginReleased = oldMargin;
            
            this.log('INFO', `💰 FULL POSITION CLOSURE - P&L REALIZATION`, {
              userId,
              realizedPnL: realizedPnL.toString(),
              marginReleased: marginReleased.toString()
            });
          } else {
            // Partial position reduction - proportional realization
            const reductionSize = oldSize.minus(newSize);
            const reductionRatio = reductionSize.dividedBy(oldSize);
            
            realizedPnL = oldUnrealizedPnL.times(reductionRatio);
            marginReleased = oldMargin.times(reductionRatio);
            
            this.log('INFO', `💰 PARTIAL POSITION REDUCTION - P&L REALIZATION`, {
              userId,
              oldSize: oldSize.toString(),
              newSize: newSize.toString(),
              reductionRatio: reductionRatio.toString(),
              realizedPnL: realizedPnL.toString(),
              marginReleased: marginReleased.toString()
            });
          }
          
          // Apply P&L realization to user balance
          user.realizePnL(realizedPnL);
          
          // Release margin back to available balance
          user.releaseMargin(marginReleased);
          
          this.log('INFO', `✅ P&L REALIZED AND MARGIN RELEASED`, {
            userId,
            realizedPnL: realizedPnL.toString(),
            marginReleased: marginReleased.toString(),
            newAvailableBalance: user.availableBalance.toString(),
            newUsedMargin: user.usedMargin.toString(),
            newTotalPnL: user.totalPnL.toString()
          });
        }
        
      } else {
        // Position increase or same size - normal margin adjustment
        user.usedMargin = user.usedMargin.plus(marginDelta);
        
        this.log('DEBUG', `Position increased/maintained`, {
          marginDelta: marginDelta.toString(),
          userUsedMargin: user.usedMargin.toString()
        });
      }
      
      this.log('DEBUG', `Trade added to position`, {
        newPositionSize: position.size.toString(),
        newPositionSide: position.side,
        userAvailableBalance: user.availableBalance.toString(),
        userUsedMargin: user.usedMargin.toString()
      });
      
      // If position is closed (size = 0), remove it
      if (position.size.isZero()) {
        this.log('INFO', `✅ POSITION CLOSED AND REMOVED`, {
          userId
        });
        positions.delete(positionKey);
      }
    }
  }

  private handleLiquidationEnginePositionTrade(
    trade: Trade,
    positionLiquidationEngine: any
  ): void {
    // Handle liquidation engine position trades through the liquidation engine
    this.log('INFO', `🔄 HANDLING LIQUIDATION ENGINE TRADE`, {
      side: trade.side,
      size: trade.size.toString(),
      price: trade.price.toString()
    });
    
    // Find matching position to close in liquidation engine
    const lePositions = positionLiquidationEngine.positions;
    
    // Find first position with opposite side (for closing)
    const targetPosition = lePositions.find((p: any) => p.side !== trade.side);
    
    if (!targetPosition) {
      this.log('ERROR', `❌ Liquidation engine position not found for closing`, {
        tradeSide: trade.side,
        availablePositions: lePositions.map((p: any) => ({id: p.id, side: p.side, size: p.size.toString()}))
      });
      return;
    }
    
    this.log('INFO', `🔄 CLOSING LIQUIDATION ENGINE POSITION`, {
      positionId: targetPosition.id,
      originalUserId: targetPosition.originalUserId,
      side: targetPosition.side,
      size: targetPosition.size.toString(),
      closingSize: trade.size.toString()
    });
    
    // Use the liquidation engine's removePosition method to properly close
    const closureResult = positionLiquidationEngine.removePosition(
      targetPosition.id, 
      'adl', 
      trade.price
    );
    
    if (closureResult) {
      this.log('INFO', `✅ Liquidation engine position closed successfully`, {
        positionId: targetPosition.id,
        realizedPnL: closureResult.realizedPnL.toString()
      });
    }
  }

  public updateUserBalances(
    buyOrder: any,
    sellOrder: any,
    price: Decimal,
    size: Decimal,
    users: Map<string, User>
  ): void {
    const buyUser = users.get(buyOrder.userId);
    const sellUser = users.get(sellOrder.userId);

    // Skip balance updates for liquidation engine
    if (buyOrder.userId === 'liquidation_engine' || sellOrder.userId === 'liquidation_engine') {
      this.log('DEBUG', 'Skipping balance update for liquidation engine trade');
      return;
    }

    // Check if users exist
    if (!buyUser) {
      this.log('ERROR', `❌ Buy user not found: ${buyOrder.userId}`);
      return;
    }
    if (!sellUser) {
      this.log('ERROR', `❌ Sell user not found: ${sellOrder.userId}`);
      return;
    }

    // NOTE: Margin was already reserved during order placement (placeOrder method)
    // No need to deduct margin again here - that would be double deduction
    // The used margin tracking is handled in the updatePosition method when positions are created/updated
    
    this.log('DEBUG', `Trade executed - margin already handled during order placement`);
    
    this.log('DEBUG', `Updated user balances for trade`, {
      buyUser: {
        id: buyUser.id,
        availableBalance: buyUser.availableBalance.toString(),
        usedMargin: buyUser.usedMargin.toString(),
        totalBalance: buyUser.getTotalBalance().toString()
      },
      sellUser: {
        id: sellUser.id,
        availableBalance: sellUser.availableBalance.toString(),
        usedMargin: sellUser.usedMargin.toString(),
        totalBalance: sellUser.getTotalBalance().toString()
      }
    });
  }

  // Legacy method - kept for backward compatibility but simplified
  public updatePosition(
    userId: string,
    side: 'long' | 'short',
    size: Decimal,
    price: Decimal,
    leverage: number,
    positions: Map<string, Position>,
    lePositionId: string | null = null
  ): void {
    this.log('DEBUG', `🔄 Legacy updatePosition called - converting to trade-based approach`, {
      userId, side, size: size.toString(), price: price.toString(), leverage
    });
    
    // Convert to Trade object and use new system
    const tradeSide = side === 'long' ? 'buy' : 'sell';
    const trade = new Trade(userId, tradeSide, size, price, {
      tradeType: 'normal' as any, // Use 'normal' instead of 'legacy_conversion'
      leverage: leverage || 1
    });
    
    // Note: This method would need additional context (users, currentMarkPrice, etc.)
    // For now, just log the conversion
    this.log('DEBUG', 'Legacy position update converted to trade object', {
      tradeId: trade.id,
      tradeSide: trade.side,
      tradeSize: trade.size.toString()
    });
  }
} 