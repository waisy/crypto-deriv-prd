const { Decimal } = require('decimal.js');
const { Position } = require('./position.ts');

class ADLEngine {
  constructor() {
    this.adlTriggerThreshold = 50000; // Trigger ADL when insurance fund below $50k
    this.lastSocializationPrice = null;
  }

  getLastSocializationPrice() {
    return this.lastSocializationPrice;
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
          unrealizedPnL = Position.calculateUnrealizedPnLStatic(
            position.side, 
            avgEntryPrice.toString(), 
            currentPriceDec.toString(), 
            size.toString()
          );
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
      const positionValue = position.getPositionValue();
      
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
  getADLQueue(positions, currentPrice) {
    const queue = [];
    
    positions.forEach(position => {
      // Calculate PnL consistently
      let pnl = position.calculateUnrealizedPnL(currentPrice);
  
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
  planADL(lePosition, allUserPositions, users, markPrice, requiredSocializationAmount = 0) {
    try {
      console.log('🎯 Planning ADL execution:', {
        lePosition: {
          id: lePosition?.id,
          side: lePosition?.side,
          size: lePosition?.size?.toString()
        },
        totalPositions: allUserPositions?.size,
        markPrice: markPrice?.toString(),
        requiredSocializationAmount: requiredSocializationAmount?.toString()
      });

      if (!lePosition || !allUserPositions || !users || !markPrice) {
        const error = 'Invalid arguments for planning ADL';
        console.error(`❌ ADL ERROR: ${error}`, { 
          hasLePosition: !!lePosition,
          hasPositions: !!allUserPositions,
          hasUsers: !!users,
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
          const user = users.get(p.userId);
          const userBalance = user ? user.availableBalance : new Decimal(0);
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

      // 🚨 CRITICAL FIX: Calculate ADL price that socializes losses
      let adlPrice = new Decimal(markPrice);
      
      if (requiredSocializationAmount && new Decimal(requiredSocializationAmount).greaterThan(0)) {
        adlPrice = this.calculateADLSocializationPrice(
          lePosition, 
          profitableCounterparties, 
          markPrice, 
          requiredSocializationAmount
        );
        
        console.log('💰 ADL LOSS SOCIALIZATION ACTIVATED:', {
          markPrice: markPrice.toString(),
          adlPrice: adlPrice.toString(),
          socializationAmount: requiredSocializationAmount.toString(),
          priceAdjustment: adlPrice.minus(markPrice).toString()
        });
      } else {
        console.log('📊 Standard ADL (no loss socialization required)');
      }

      const adlTrades = [];
      let remainingSizeToClose = new Decimal(lePosition.size);

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
            price: adlPrice.toString()
          });
          
          remainingSizeToClose = remainingSizeToClose.minus(tradeSize);
          console.log(`📝 ADL Trade planned:`, {
            counterparty: counterparty.userId,
            size: tradeSize.toString(),
            price: adlPrice.toString(),
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
        price: adlPrice.toString(),
        socialization: requiredSocializationAmount ? `$${requiredSocializationAmount}` : 'none'
      });

      return {
        success: true,
        lePositionId: lePosition.id,
        trades: adlTrades,
        socializationAmount: requiredSocializationAmount || 0,
        adlPrice: adlPrice.toString(),
        markPrice: markPrice.toString()
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

  // NEW: Calculate ADL price that socializes beyond-margin losses
  calculateADLSocializationPrice(lePosition, profitableCounterparties, markPrice, socializationAmount) {
    try {
      console.log('📊 Calculating ADL socialization price:', {
        lePositionSize: lePosition.size.toString(),
        counterparties: profitableCounterparties.length,
        markPrice: markPrice.toString(),
        socializationAmount: socializationAmount.toString()
      });

      const decMarkPrice = new Decimal(markPrice);
      const decSocializationAmount = new Decimal(socializationAmount);
      
      // Calculate total profitable counterparty size
      const totalCounterpartySize = profitableCounterparties.reduce((sum, pos) => {
        return sum.plus(pos.size);
      }, new Decimal(0));

      if (totalCounterpartySize.isZero()) {
        throw new Error('No counterparty size available for ADL');
      }

      // Calculate price adjustment to socialize losses
      let priceAdjustment;
      if (lePosition.side === 'long') {
        // Long position being liquidated, counterparties are short
        // Need to INCREASE price to reduce counterparty profits
        priceAdjustment = decSocializationAmount.dividedBy(totalCounterpartySize);
        this.lastSocializationPrice = decMarkPrice.plus(priceAdjustment);
      } else {
        // Short position being liquidated, counterparties are long
        // Need to DECREASE price to reduce counterparty profits
        priceAdjustment = decSocializationAmount.dividedBy(totalCounterpartySize);
        this.lastSocializationPrice = decMarkPrice.minus(priceAdjustment);
      }

      console.log('💰 ADL SOCIALIZATION PRICE CALCULATED:', {
        markPrice: decMarkPrice.toString(),
        socializationAmount: decSocializationAmount.toString(),
        totalCounterpartySize: totalCounterpartySize.toString(),
        priceAdjustment: priceAdjustment.toString(),
        socializationPrice: this.lastSocializationPrice.toString(),
        lePositionSide: lePosition.side
      });

      return this.lastSocializationPrice;
    } catch (error) {
      console.error('❌ Error calculating ADL socialization price:', error);
      throw error;
    }
  }

  // Check if ADL should be triggered
  shouldTriggerADL(insuranceFundBalance, requiredAmount) {
    return insuranceFundBalance < requiredAmount;
  }

  // Simulate ADL impact without executing
  simulateADL(positions, requiredAmount, bankruptPosition, currentPrice) {
    // Use bankruptcy price as fallback if currentPrice not provided
    const priceToUse = currentPrice || bankruptPosition.avgEntryPrice;
    const adlQueue = this.getADLQueue(positions, priceToUse);
    const affectedUsers = [];
    let remainingAmount = requiredAmount;
    
    for (const queueItem of adlQueue) {
      if (remainingAmount <= 0) break;
      
      const position = positions.get(queueItem.userId); // One-way mode: userId only
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
          const userBalance = user.availableBalance;
          position.adlScore = this.calculateADLScore(position, userBalance, currentPrice);
        }
      }
    });
    
    return this.getADLQueue(positionsArray, currentPrice);
  }
}

module.exports = { ADLEngine }; 