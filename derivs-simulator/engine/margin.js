const { Decimal } = require('decimal.js');

class MarginCalculator {
  constructor() {
    this.maintenanceMarginRate = new Decimal(0.005); // 0.5%
    this.initialMarginMultiplier = new Decimal(2); // Initial margin is 2x maintenance margin
  }

  calculateInitialMargin(size, price, leverage) {
    const decSize = new Decimal(size);
    const decPrice = new Decimal(price);
    const decLeverage = new Decimal(leverage);
    const positionValue = decSize.times(decPrice);
    return positionValue.dividedBy(decLeverage);
  }

  calculateMaintenanceMargin(size, price) {
    const decSize = new Decimal(size);
    const decPrice = new Decimal(price);
    const positionValue = decSize.times(decPrice);
    return positionValue.times(this.maintenanceMarginRate);
  }

  calculateMarginRequirements(position, currentPrice) {
    const decCurrentPrice = new Decimal(currentPrice);
    
    return {
      initial: this.calculateInitialMargin(position.size, position.avgEntryPrice, position.leverage),
      maintenance: this.calculateMaintenanceMargin(position.size, decCurrentPrice),
      used: this.calculateInitialMargin(position.size, position.avgEntryPrice, position.leverage)
    };
  }

  // Linear contract liquidation price calculation
  calculateLiquidationPrice(position) {
    const { side } = position;
    const avgEntryPrice = new Decimal(position.avgEntryPrice);
    const leverage = new Decimal(position.leverage);
    const mmr = this.maintenanceMarginRate;

    if (side === 'long') {
      // Liquidation Price = Entry Price × (1 - 1/Leverage + Maintenance Margin Rate)
      return avgEntryPrice.times(new Decimal(1).minus(new Decimal(1).dividedBy(leverage)).plus(mmr));
    } else {
      // Liquidation Price = Entry Price × (1 + 1/Leverage - Maintenance Margin Rate)
      return avgEntryPrice.times(new Decimal(1).plus(new Decimal(1).dividedBy(leverage)).minus(mmr));
    }
  }

  // Calculate bankruptcy price (where all margin is lost)
  calculateBankruptcyPrice(position) {
    const { side } = position;
    const avgEntryPrice = new Decimal(position.avgEntryPrice);
    const leverage = new Decimal(position.leverage);

    if (side === 'long') {
      return avgEntryPrice.times(new Decimal(1).minus(new Decimal(1).dividedBy(leverage)));
    } else {
      return avgEntryPrice.times(new Decimal(1).plus(new Decimal(1).dividedBy(leverage)));
    }
  }

  // Check if position should be liquidated
  shouldLiquidate(position, currentPrice) {
    const decCurrentPrice = new Decimal(currentPrice);
    const liquidationPrice = this.calculateLiquidationPrice(position);
    
    if (position.side === 'long') {
      return decCurrentPrice.lessThanOrEqualTo(liquidationPrice);
    } else {
      return decCurrentPrice.greaterThanOrEqualTo(liquidationPrice);
    }
  }

  // Calculate margin ratio
  calculateMarginRatio(position, availableBalance, currentPrice) {
    const decCurrentPrice = new Decimal(currentPrice);
    const decAvailableBalance = new Decimal(availableBalance);

    const maintenanceMargin = this.calculateMaintenanceMargin(position.size, decCurrentPrice);
    const equity = decAvailableBalance.plus(position.unrealizedPnL);
    
    if (maintenanceMargin.isZero()) return null;
    return equity.dividedBy(maintenanceMargin).times(100);
  }

  // Calculate maximum position size for given margin
  calculateMaxPositionSize(availableMargin, price, leverage) {
    const decAvailableMargin = new Decimal(availableMargin);
    const decPrice = new Decimal(price);
    const decLeverage = new Decimal(leverage);
    return decAvailableMargin.times(decLeverage).dividedBy(decPrice);
  }

  // Calculate required margin for position size
  calculateRequiredMargin(size, price, leverage) {
    const decSize = new Decimal(size);
    const decPrice = new Decimal(price);
    const decLeverage = new Decimal(leverage);
    return decSize.times(decPrice).dividedBy(decLeverage);
  }
}

module.exports = { MarginCalculator }; 