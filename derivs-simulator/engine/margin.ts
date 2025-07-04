import { Decimal } from 'decimal.js';

export interface MarginRequirements {
  initial: Decimal;
  maintenance: Decimal;
  used: Decimal;
}

export interface PositionForMargin {
  side: 'long' | 'short';
  size: Decimal;
  avgEntryPrice: Decimal;
  leverage: Decimal;
  initialMargin: Decimal;
  unrealizedPnL: Decimal;
}

export class MarginCalculator {
  public maintenanceMarginRate: Decimal;
  public initialMarginMultiplier: Decimal;

  constructor() {
    this.maintenanceMarginRate = new Decimal(0.005); // 0.5%
    this.initialMarginMultiplier = new Decimal(2); // Initial margin is 2x maintenance margin
  }

  calculateInitialMargin(size: Decimal, price: Decimal, leverage: Decimal): Decimal {
    const decSize = new Decimal(size);
    const decPrice = new Decimal(price);
    const decLeverage = new Decimal(leverage);
    const positionValue = decSize.times(decPrice);
    return positionValue.dividedBy(decLeverage);
  }

  calculateMaintenanceMargin(size: Decimal, price: Decimal): Decimal {

    const positionValue = size.times(price);
    return positionValue.times(this.maintenanceMarginRate);
  }

  calculateMarginRequirements(position: PositionForMargin, currentPrice: Decimal): MarginRequirements {
    const decCurrentPrice = new Decimal(currentPrice);
    
    return {
      initial: this.calculateInitialMargin(position.size, position.avgEntryPrice, position.leverage),
      maintenance: this.calculateMaintenanceMargin(position.size, decCurrentPrice),
      used: this.calculateInitialMargin(position.size, position.avgEntryPrice, position.leverage)
    };
  }

  // Linear contract liquidation price calculation
  calculateLiquidationPrice(position: PositionForMargin): Decimal {
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
  calculateBankruptcyPrice(position: PositionForMargin): Decimal {
    const { side } = position;
    const avgEntryPrice = new Decimal(position.avgEntryPrice);
    const initialMargin = new Decimal(position.initialMargin);
    const size = new Decimal(position.size);
    
    // Margin-based calculation: more robust than leverage-based
    // Bankruptcy price is where total loss equals initial margin
    const marginPerUnit = initialMargin.dividedBy(size);
    
    if (side === 'long') {
      // For long: bankruptcy price = entry price - (margin per unit)
      return avgEntryPrice.minus(marginPerUnit);
    } else {
      // For short: bankruptcy price = entry price + (margin per unit)
      return avgEntryPrice.plus(marginPerUnit);
    }
  }

  // Check if position should be liquidated
  shouldLiquidate(position: PositionForMargin, currentPrice: Decimal): boolean {
    const decCurrentPrice = new Decimal(currentPrice);
    const liquidationPrice = this.calculateLiquidationPrice(position);
    
    if (position.side === 'long') {
      return decCurrentPrice.lessThanOrEqualTo(liquidationPrice);
    } else {
      return decCurrentPrice.greaterThanOrEqualTo(liquidationPrice);
    }
  }

  // Calculate margin ratio
  calculateMarginRatio(position: PositionForMargin, availableBalance: Decimal, currentPrice: Decimal): Decimal | null {
    const decCurrentPrice = new Decimal(currentPrice);
    const decAvailableBalance = new Decimal(availableBalance);

    const maintenanceMargin = this.calculateMaintenanceMargin(position.size, decCurrentPrice);
    const equity = decAvailableBalance.plus(position.unrealizedPnL);
    
    if (maintenanceMargin.isZero()) return null;
    return equity.dividedBy(maintenanceMargin).times(100);
  }

  // Calculate maximum position size for given margin
  calculateMaxPositionSize(availableMargin: Decimal, price: Decimal, leverage: Decimal): Decimal {
    const decAvailableMargin = new Decimal(availableMargin);
    const decPrice = new Decimal(price);
    const decLeverage = new Decimal(leverage);
    return decAvailableMargin.times(decLeverage).dividedBy(decPrice);
  }

  // Calculate required margin for position size
  calculateRequiredMargin(size: Decimal, price: Decimal, leverage: Decimal): Decimal {
    const decSize = new Decimal(size);
    const decPrice = new Decimal(price);
    const decLeverage = new Decimal(leverage);
    return decSize.times(decPrice).dividedBy(decLeverage);
  }
} 