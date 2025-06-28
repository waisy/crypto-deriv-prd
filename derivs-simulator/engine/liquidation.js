class LiquidationEngine {
  constructor() {
    this.liquidationFeeRate = 0.005; // 0.5% liquidation fee
    this.insuranceFund = 1000000; // $1M insurance fund
  }

  shouldLiquidate(position, currentPrice) {
    const liquidationPrice = this.calculateLiquidationPrice(position);
    
    if (position.side === 'long') {
      return currentPrice <= liquidationPrice;
    } else {
      return currentPrice >= liquidationPrice;
    }
  }

  calculateLiquidationPrice(position) {
    const { entryPrice, leverage, side } = position;
    const mmr = 0.005; // 0.5% maintenance margin rate

    if (side === 'long') {
      return entryPrice * (1 - 1/leverage + mmr);
    } else {
      return entryPrice * (1 + 1/leverage - mmr);
    }
  }

  liquidate(position, currentPrice) {
    const positionValue = position.size * currentPrice;
    const liquidationFee = positionValue * this.liquidationFeeRate;
    
    // Calculate bankruptcy price
    const bankruptcyPrice = this.calculateBankruptcyPrice(position);
    
    // Calculate losses
    let totalLoss;
    if (position.side === 'long') {
      totalLoss = (position.entryPrice - currentPrice) * position.size;
    } else {
      totalLoss = (currentPrice - position.entryPrice) * position.size;
    }
    
    // Remaining balance after liquidation
    const remainingBalance = Math.max(0, position.initialMargin - totalLoss - liquidationFee);
    
    // Insurance fund impact
    let insuranceFundLoss = 0;
    if (remainingBalance === 0 && totalLoss > position.initialMargin) {
      insuranceFundLoss = totalLoss - position.initialMargin + liquidationFee;
      this.insuranceFund -= insuranceFundLoss;
    }

    const liquidation = {
      positionId: `${position.userId}-${position.side}`,
      userId: position.userId,
      side: position.side,
      size: position.size,
      entryPrice: position.entryPrice,
      liquidationPrice: currentPrice,
      bankruptcyPrice,
      totalLoss,
      liquidationFee,
      remainingBalance,
      insuranceFundLoss,
      timestamp: Date.now()
    };

    return liquidation;
  }

  calculateBankruptcyPrice(position) {
    const { entryPrice, leverage, side } = position;

    if (side === 'long') {
      return entryPrice * (1 - 1/leverage);
    } else {
      return entryPrice * (1 + 1/leverage);
    }
  }

  getInsuranceFundBalance() {
    return this.insuranceFund;
  }

  // Partial liquidation - reduce position size
  partialLiquidate(position, currentPrice, reductionPercentage = 0.5) {
    const originalSize = position.size;
    const liquidationSize = originalSize * reductionPercentage;
    const remainingSize = originalSize - liquidationSize;
    
    // Create liquidation for the portion being closed
    const partialPosition = {
      ...position,
      size: liquidationSize
    };
    
    const liquidation = this.liquidate(partialPosition, currentPrice);
    
    // Update the original position
    position.size = remainingSize;
    
    return {
      ...liquidation,
      type: 'partial',
      originalSize,
      liquidationSize,
      remainingSize
    };
  }

  // Check if system is at risk (insurance fund low)
  isSystemAtRisk() {
    return this.insuranceFund < 100000; // $100k threshold
  }
}

module.exports = { LiquidationEngine }; 