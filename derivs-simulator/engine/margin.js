class MarginCalculator {
  constructor() {
    this.maintenanceMarginRate = 0.005; // 0.5%
    this.initialMarginMultiplier = 2; // Initial margin is 2x maintenance margin
  }

  calculateInitialMargin(size, price, leverage) {
    const positionValue = size * price;
    return positionValue / leverage;
  }

  calculateMaintenanceMargin(size, price) {
    const positionValue = size * price;
    return positionValue * this.maintenanceMarginRate;
  }

  calculateMarginRequirements(position, currentPrice) {
    const currentValue = position.size * currentPrice;
    
    return {
      initial: this.calculateInitialMargin(position.size, position.entryPrice, position.leverage),
      maintenance: this.calculateMaintenanceMargin(position.size, currentPrice),
      used: this.calculateInitialMargin(position.size, position.entryPrice, position.leverage)
    };
  }

  // Linear contract liquidation price calculation
  calculateLiquidationPrice(position) {
    const { entryPrice, leverage, side } = position;
    const mmr = this.maintenanceMarginRate;

    if (side === 'long') {
      // Liquidation Price = Entry Price × (1 - 1/Leverage + Maintenance Margin Rate)
      return entryPrice * (1 - 1/leverage + mmr);
    } else {
      // Liquidation Price = Entry Price × (1 + 1/Leverage - Maintenance Margin Rate)
      return entryPrice * (1 + 1/leverage - mmr);
    }
  }

  // Calculate bankruptcy price (where all margin is lost)
  calculateBankruptcyPrice(position) {
    const { entryPrice, leverage, side } = position;

    if (side === 'long') {
      return entryPrice * (1 - 1/leverage);
    } else {
      return entryPrice * (1 + 1/leverage);
    }
  }

  // Check if position should be liquidated
  shouldLiquidate(position, currentPrice) {
    const liquidationPrice = this.calculateLiquidationPrice(position);
    
    if (position.side === 'long') {
      return currentPrice <= liquidationPrice;
    } else {
      return currentPrice >= liquidationPrice;
    }
  }

  // Calculate margin ratio
  calculateMarginRatio(position, availableBalance, currentPrice) {
    const maintenanceMargin = this.calculateMaintenanceMargin(position.size, currentPrice);
    const equity = availableBalance + position.unrealizedPnL;
    
    if (maintenanceMargin === 0) return Infinity;
    return (equity / maintenanceMargin) * 100;
  }

  // Calculate maximum position size for given margin
  calculateMaxPositionSize(availableMargin, price, leverage) {
    return (availableMargin * leverage) / price;
  }

  // Calculate required margin for position size
  calculateRequiredMargin(size, price, leverage) {
    return (size * price) / leverage;
  }
}

module.exports = { MarginCalculator }; 