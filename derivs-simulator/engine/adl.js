class ADLEngine {
  constructor() {
    this.adlTriggerThreshold = 50000; // Trigger ADL when insurance fund below $50k
  }

  // Calculate ADL score for position ranking
  calculateADLScore(position, userBalance, currentPrice) {
    const positionValue = position.size * position.avgEntryPrice;
    
    // Unrealized profit percentage
    const profitPercentage = position.unrealizedPnL / positionValue;
    
    // Effective leverage
    const totalEquity = userBalance + position.unrealizedPnL;
    const effectiveLeverage = positionValue / totalEquity;
    
    // ADL Score = Profit % × Effective Leverage
    return profitPercentage * effectiveLeverage;
  }

  // Get ADL queue - positions ranked by ADL score
  getADLQueue(positions) {
    const queue = [];
    
    positions.forEach(position => {
      if (position.unrealizedPnL > 0) { // Only profitable positions
        const adlScore = position.adlScore || 0;
        queue.push({
          positionId: position.userId, // One-way mode: userId only
          userId: position.userId,
          side: position.side,
          size: position.size,
          unrealizedPnL: position.unrealizedPnL,
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
    const adlQueue = this.getADLQueue(positions);
    const deleveragedPositions = [];
    let remainingAmount = requiredAmount;
    
    for (const queueItem of adlQueue) {
      if (remainingAmount <= 0) break;
      
      const position = positions.get(queueItem.userId); // One-way mode: userId only
      if (!position || position.side === bankruptPosition.side) continue;
      
      // Calculate how much of this position to close
      const positionValue = position.size * bankruptPosition.avgEntryPrice;
      const closeAmount = Math.min(remainingAmount, positionValue);
      const closeSizeRatio = closeAmount / positionValue;
      const closeSize = position.size * closeSizeRatio;
      
      // Execute ADL
      const adlExecution = {
        positionId: queueItem.positionId,
        userId: position.userId,
        side: position.side,
        originalSize: position.size,
        closedSize: closeSize,
        remainingSize: position.size - closeSize,
        closePrice: bankruptPosition.avgEntryPrice,
        realizedPnL: closeAmount,
        timestamp: Date.now(),
        reason: 'ADL execution'
      };
      
      deleveragedPositions.push(adlExecution);
      
      // Update position
      position.size -= closeSize;
      if (position.size <= 0) {
        positions.delete(queueItem.positionId);
      }
      
      remainingAmount -= closeAmount;
    }
    
    return {
      success: remainingAmount <= 0,
      deleveragedPositions,
      remainingDeficit: Math.max(0, remainingAmount)
    };
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
      
      const positionValue = position.size * bankruptPosition.avgEntryPrice;
      const closeAmount = Math.min(remainingAmount, positionValue);
      
      affectedUsers.push({
        userId: position.userId,
        positionId: queueItem.positionId,
        closeAmount,
        impactPercentage: (closeAmount / positionValue) * 100
      });
      
      remainingAmount -= closeAmount;
    }
    
    return {
      canCover: remainingAmount <= 0,
      affectedUsers,
      totalAffected: affectedUsers.length
    };
  }

  getQueue() {
    // This is a placeholder. The main logic is in getADLQueue,
    // which requires the positions map to be passed in.
    // getState in exchange.js needs a synchronous way to get a basic queue representation.
    return [];
  }
}

module.exports = { ADLEngine }; 