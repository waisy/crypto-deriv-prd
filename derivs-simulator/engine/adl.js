const { Decimal } = require('decimal.js');

class ADLEngine {
  constructor() {
    this.adlTriggerThreshold = 50000; // Trigger ADL when insurance fund below $50k
  }

  // Calculate ADL score for position ranking
  calculateADLScore(position, userBalance, currentPrice) {
    try {
      if (!position || !userBalance || !currentPrice) {
        throw new Error('Missing required parameters for ADL score calculation');
      }

      // Work with Decimal objects for precision
      const size = position.size instanceof Decimal ? position.size : new Decimal(position.size || 0);
      const avgEntryPrice = position.avgEntryPrice instanceof Decimal ? position.avgEntryPrice : 
        new Decimal(position.avgEntryPrice || position.entryPrice || 0);
      const currentPriceDec = currentPrice instanceof Decimal ? currentPrice : new Decimal(currentPrice);
      
      // Calculate PnL consistently
      let unrealizedPnL;
      try {
        if (typeof position.calculateUnrealizedPnL === 'function') {
          unrealizedPnL = position.calculateUnrealizedPnL(currentPriceDec);
        } else if (position.unrealizedPnL) {
          unrealizedPnL = new Decimal(position.unrealizedPnL);
        } else {
          unrealizedPnL = position.side === 'long'
            ? currentPriceDec.minus(avgEntryPrice).times(size)
            : avgEntryPrice.minus(currentPriceDec).times(size);
        }
      } catch (pnlError) {
        console.error('❌ Failed to calculate PnL:', pnlError, {
          position: {
            id: position.id,
            side: position.side,
            size: size.toString(),
            entryPrice: avgEntryPrice.toString()
          },
          currentPrice: currentPriceDec.toString()
        });
        throw pnlError;
      }
      
      const userBal = new Decimal(userBalance);
      const positionValue = size.times(avgEntryPrice);
      
      if (positionValue.isZero()) {
        console.warn('⚠️ Position value is zero, skipping ADL score calculation', {
          position: {
            id: position.id,
            side: position.side,
            size: size.toString(),
            entryPrice: avgEntryPrice.toString()
          }
        });
        return 0;
      }
      
      // Unrealized profit percentage
      const profitPercentage = unrealizedPnL.dividedBy(positionValue);
      
      // Effective leverage
      const totalEquity = userBal.plus(unrealizedPnL);
      if (totalEquity.isZero() || totalEquity.isNegative()) {
        console.warn('⚠️ Total equity is zero or negative, skipping ADL score calculation', {
          userBalance: userBal.toString(),
          unrealizedPnL: unrealizedPnL.toString(),
          totalEquity: totalEquity.toString()
        });
        return 0;
      }
      
      const effectiveLeverage = positionValue.dividedBy(totalEquity);
      const adlScore = profitPercentage.times(effectiveLeverage);
      
      console.log('📊 ADL Score calculated:', {
        userId: position.userId,
        score: adlScore.toString(),
        components: {
          profitPercentage: profitPercentage.toString(),
          effectiveLeverage: effectiveLeverage.toString()
        }
      });
      
      return adlScore.toNumber();
    } catch (error) {
      console.error('❌ ADL Score calculation failed:', error, {
        position: position?.id,
        userBalance,
        currentPrice: currentPrice?.toString()
      });
      return 0;
    }
  }

  // Get ADL queue - positions ranked by ADL score
  getADLQueue(positions) {
    const queue = [];
    
    positions.forEach(position => {
      // Calculate PnL consistently
      let pnl;
      if (typeof position.calculateUnrealizedPnL === 'function') {
        pnl = position.calculateUnrealizedPnL(this.currentMarkPrice);
      } else if (position.unrealizedPnL) {
        pnl = new Decimal(position.unrealizedPnL);
      } else {
        const size = new Decimal(position.size);
        const entryPrice = new Decimal(position.avgEntryPrice || position.entryPrice);
        pnl = position.side === 'long'
          ? this.currentMarkPrice.minus(entryPrice).times(size)
          : entryPrice.minus(this.currentMarkPrice).times(size);
      }

      if (pnl.greaterThan(0)) { // Only profitable positions
        const adlScore = position.adlScore || 0;
        queue.push({
          positionId: position.userId, // One-way mode: userId only
          userId: position.userId,
          side: position.side,
          size: position.size.toString(),
          unrealizedPnL: pnl.toString(),
          adlScore,
          adlRank: 0 // Will be set after sorting
        });
      }
    });
    
    // Sort by ADL score (highest first)
    queue.sort((a, b) => b.adlScore - a.adlScore);
    
    // Set ADL ranks and indicators
    queue.forEach((item, index) => {
      item.adlRank = index + 1;
      item.adlIndicator = this.getADLIndicator(index, queue.length);
    });
    
    return queue;
  }

  // Get ADL indicator (1-5 lights)
  getADLIndicator(rank, totalPositions) {
    if (totalPositions === 0) return 0;
    
    const percentage = (rank / totalPositions) * 100;
    
    if (percentage <= 20) return 5; // Top 20% - 5 lights
    if (percentage <= 40) return 4; // Top 40% - 4 lights
    if (percentage <= 60) return 3; // Top 60% - 3 lights
    if (percentage <= 80) return 2; // Top 80% - 2 lights
    return 1; // Bottom 20% - 1 light
  }

  // DEPRECATED - logic moved to planADL
  executeADL(positions, requiredAmount, bankruptPosition) {
    console.warn('DEPRECATED: executeADL should not be called directly. Use planADL.');
    return { success: false, error: 'Deprecated function' };
  }

  // Plan ADL deleveraging without executing
  planADL(lePosition, allUserPositions, markPrice) {
    try {
      console.log('🎯 Planning ADL execution:', {
        lePosition: {
          id: lePosition?.id,
          side: lePosition?.side,
          size: lePosition?.size?.toString()
        },
        totalPositions: allUserPositions?.size,
        markPrice: markPrice?.toString()
      });

      if (!lePosition || !allUserPositions || !markPrice) {
        const error = 'Invalid arguments for planning ADL';
        console.error(`❌ ADL ERROR: ${error}`, { 
          hasLePosition: !!lePosition,
          hasPositions: !!allUserPositions,
          hasMarkPrice: !!markPrice
        });
        return {
          success: false,
          error,
          trades: []
        };
      }

      // Validate position data
      if (!lePosition.side || !lePosition.size) {
        const error = 'Invalid liquidation position data';
        console.error(`❌ ADL ERROR: ${error}`, { lePosition });
        return {
          success: false,
          error,
          trades: []
        };
      }
      
      // Find profitable users on the opposite side
      const profitableCounterparties = [];
      try {
        for (const p of allUserPositions.values()) {
          // Skip liquidation engine positions - they can't be ADL counterparties
          if (p.userId === 'liquidation_engine') continue;
          if (!p.side || p.side === lePosition.side) continue;
          
          try {
            // Pass mark price to updatePnL
            p.updatePnL(markPrice);
            if (p.unrealizedPnL && p.unrealizedPnL.greaterThan(0)) {
              profitableCounterparties.push(p);
              console.log(`📈 Found profitable counterparty:`, {
                userId: p.userId,
                side: p.side,
                size: p.size.toString(),
                pnl: p.unrealizedPnL.toString()
              });
            }
          } catch (pnlError) {
            console.warn(`⚠️ Failed to update PnL for position ${p.userId}:`, pnlError, {
              position: {
                id: p.id,
                side: p.side,
                size: p.size?.toString(),
                entryPrice: p.avgEntryPrice?.toString()
              },
              markPrice: markPrice?.toString()
            });
          }
        }
      } catch (filterError) {
        console.error('❌ Error filtering counterparties:', filterError);
        return {
          success: false,
          error: 'Failed to process counterparties',
          trades: []
        };
      }

      if (profitableCounterparties.length === 0) {
        const error = 'No profitable counterparties found on opposite side';
        console.error(`❌ ADL ERROR: ${error}`, {
          lePositionSide: lePosition.side,
          lePositionSize: lePosition.size.toString(),
          totalPositions: allUserPositions.size,
          oppositePositions: Array.from(allUserPositions.values())
            .filter(p => p.side !== lePosition.side).length
        });
        return {
          success: false,
          error,
          trades: []
        };
      }
      
      // Rank counterparties by ADL score
      try {
        profitableCounterparties.forEach(p => {
          const userBalance = p.userBalance || new Decimal(0);
          p.adlScore = this.calculateADLScore(p, userBalance, markPrice);
          console.log(`📊 ADL Score for ${p.userId}:`, {
            score: p.adlScore,
            side: p.side,
            size: p.size.toString(),
            pnl: p.unrealizedPnL.toString()
          });
        });
      } catch (rankError) {
        console.error('❌ Error ranking counterparties:', rankError);
        return {
          success: false,
          error: 'Failed to rank counterparties',
          trades: []
        };
      }

      profitableCounterparties.sort((a, b) => (b.adlScore || 0) - (a.adlScore || 0));

      const adlTrades = [];
      let remainingSizeToClose = new Decimal(lePosition.size);
      const closePrice = new Decimal(markPrice);

      for (const counterparty of profitableCounterparties) {
        if (remainingSizeToClose.isZero() || remainingSizeToClose.isNegative()) break;
        
        const counterpartyPosition = allUserPositions.get(counterparty.userId);
        if (!counterpartyPosition) {
          console.warn(`⚠️ Counterparty position not found: ${counterparty.userId}`);
          continue;
        }

        try {
          const availableSize = new Decimal(counterpartyPosition.size);
          const tradeSize = Decimal.min(remainingSizeToClose, availableSize);
          
          adlTrades.push({
            counterpartyUserId: counterparty.userId,
            size: tradeSize.toString(),
            price: closePrice.toString()
          });
          
          remainingSizeToClose = remainingSizeToClose.minus(tradeSize);
          console.log(`📝 ADL Trade planned:`, {
            counterparty: counterparty.userId,
            size: tradeSize.toString(),
            price: closePrice.toString(),
            remaining: remainingSizeToClose.toString()
          });
        } catch (tradeError) {
          console.error('❌ Error planning trade with counterparty:', tradeError, {
            counterpartyId: counterparty.userId
          });
        }
      }
      
      const success = remainingSizeToClose.isZero() || remainingSizeToClose.isNegative();
      if (!success) {
        const error = `Failed to find enough liquidity. Shortfall: ${remainingSizeToClose.toString()} BTC`;
        console.error(`❌ ADL ERROR: ${error}`, {
          plannedTrades: adlTrades.length,
          totalSize: lePosition.size.toString(),
          remainingSize: remainingSizeToClose.toString()
        });
        return {
          success: false,
          error,
          trades: adlTrades // Return partial trades for reference
        };
      }

      console.log('✅ ADL plan completed successfully:', {
        trades: adlTrades.length,
        totalSize: lePosition.size.toString(),
        price: closePrice.toString()
      });

      return {
        success: true,
        lePositionId: lePosition.id,
        trades: adlTrades
      };
    } catch (error) {
      console.error('❌ Catastrophic ADL planning error:', error);
      return {
        success: false,
        error: error.message || 'Unknown ADL planning error',
        trades: []
      };
    }
  }

  // Check if ADL should be triggered
  shouldTriggerADL(insuranceFundBalance, requiredAmount) {
    return insuranceFundBalance < requiredAmount;
  }

  // Simulate ADL impact without executing
  simulateADL(positions, requiredAmount, bankruptPosition) {
    const adlQueue = this.getADLQueue(positions);
    const affectedUsers = [];
    let remainingAmount = requiredAmount;
    
    for (const queueItem of adlQueue) {
      if (remainingAmount <= 0) break;
      
      const position = positions.get(queueItem.userId); // One-way mode: userId only
      if (!position || position.side === bankruptPosition.side) continue;
      
      const positionSize = new Decimal(position.size);
      const bankruptEntryPrice = new Decimal(bankruptPosition.avgEntryPrice);
      const positionValue = positionSize.times(bankruptEntryPrice);
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

  getQueue(positions, users, currentPrice) {
    if (!positions || !users || !currentPrice) {
      return [];
    }
    
    // Convert Map to Array and calculate ADL scores for each position
    const positionsArray = Array.from(positions.values());
    
    // Calculate ADL scores for each position before getting queue
    positionsArray.forEach(position => {
      const pnl = new Decimal(position.unrealizedPnL);
      if (pnl.greaterThan(0)) { // Only profitable positions
        const user = users.get(position.userId);
        if (user) {
          const userBalance = new Decimal(user.availableBalance);
          position.adlScore = this.calculateADLScore(position, userBalance.toNumber(), currentPrice);
        }
      }
    });
    
    return this.getADLQueue(positionsArray);
  }
}

module.exports = { ADLEngine }; 