const { Decimal } = require('decimal.js');

class ADLEngine {
  constructor() {
    this.adlTriggerThreshold = 50000; // Trigger ADL when insurance fund below $50k
  }

  // Calculate ADL score for position ranking
  calculateADLScore(position, userBalance, currentPrice) {
    // Work with Decimal objects for precision
    const size = new Decimal(position.size);
    const avgEntryPrice = new Decimal(position.avgEntryPrice);
    const unrealizedPnL = new Decimal(position.unrealizedPnL);
    const userBal = new Decimal(userBalance);
    
    const positionValue = size.times(avgEntryPrice);
    
    // Unrealized profit percentage
    const profitPercentage = unrealizedPnL.dividedBy(positionValue);
    
    // Effective leverage
    const totalEquity = userBal.plus(unrealizedPnL);
    const effectiveLeverage = positionValue.dividedBy(totalEquity);
    
    // ADL Score = Profit % × Effective Leverage
    return profitPercentage.times(effectiveLeverage).toNumber();
  }

  // Get ADL queue - positions ranked by ADL score
  getADLQueue(positions) {
    const queue = [];
    
    positions.forEach(position => {
      const pnl = new Decimal(position.unrealizedPnL);
      if (pnl.greaterThan(0)) { // Only profitable positions
        const adlScore = position.adlScore || 0;
        queue.push({
          positionId: position.userId, // One-way mode: userId only
          userId: position.userId,
          side: position.side,
          size: position.size.toString(), // Convert Decimal to string for JSON
          unrealizedPnL: position.unrealizedPnL.toString(), // Convert Decimal to string for JSON
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

  // Execute ADL when insurance fund is insufficient
  executeADL(positions, requiredAmount, bankruptPosition) {
    console.log('🔄 ADL Engine: executeADL called');
    console.log('  Positions type:', typeof positions);
    console.log('  Positions is Map:', positions instanceof Map);
    console.log('  Required amount:', requiredAmount.toString());
    console.log('  Bankrupt position:', bankruptPosition);
    
    try {
      // Convert Map to Array for getADLQueue
      const positionsArray = positions instanceof Map ? 
        Array.from(positions.values()) : 
        Array.isArray(positions) ? positions : [];
      
      console.log('  Converted to array, length:', positionsArray.length);
      
      const adlQueue = this.getADLQueue(positionsArray);
      console.log('  ADL queue length:', adlQueue.length);
      
      const deleveragedPositions = [];
      let remainingAmount = requiredAmount;
    
      for (const queueItem of adlQueue) {
        if (remainingAmount <= 0) break;
        
        const position = positions.get(queueItem.userId); // One-way mode: userId only
        if (!position || position.side === bankruptPosition.side) continue;
        
        // Calculate how much of this position to close using Decimal arithmetic
        const positionSize = new Decimal(position.size);
        const bankruptEntryPrice = new Decimal(bankruptPosition.avgEntryPrice);
        const positionValue = positionSize.times(bankruptEntryPrice);
        const remainingAmountDec = new Decimal(remainingAmount);
        
        const closeAmount = Decimal.min(remainingAmountDec, positionValue);
        const closeSizeRatio = closeAmount.dividedBy(positionValue);
        const closeSize = positionSize.times(closeSizeRatio);
        
        // Execute ADL
        const adlExecution = {
          positionId: queueItem.positionId,
          userId: position.userId,
          side: position.side,
          originalSize: position.size.toString(),
          closedSize: closeSize.toString(),
          remainingSize: positionSize.minus(closeSize).toString(),
          closePrice: bankruptPosition.avgEntryPrice.toString(),
          realizedPnL: closeAmount.toString(),
          timestamp: Date.now(),
          reason: 'ADL execution'
        };
        
        deleveragedPositions.push(adlExecution);
        
        // Update position using Decimal arithmetic
        position.size = positionSize.minus(closeSize);
        if (position.size.lessThanOrEqualTo(0)) {
          positions.delete(queueItem.positionId);
        }
        
        remainingAmount -= closeAmount.toNumber();
      }
      
      const result = {
        success: remainingAmount <= 0,
        deleveragedPositions,
        remainingDeficit: Math.max(0, remainingAmount)
      };
      
      console.log('  ADL result:', result);
      return result;
      
    } catch (error) {
      console.error('❌ ADL Engine Error:', {
        message: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message,
        deleveragedPositions: [],
        remainingDeficit: requiredAmount
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