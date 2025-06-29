const { Decimal } = require('decimal.js');
const { Trade } = require('./trade');

class Position {
  constructor(userId, leverage, initialTrade = null) {
    this.userId = userId;
    this.leverage = leverage;
    this.trades = [];
    this.timestamp = Date.now();
    this.adlScore = 0;
    
    // Add initial trade if provided (for backward compatibility)
    if (initialTrade) {
      this.addTrade(initialTrade);
    }
  }
  
  // Add a trade to this position
  addTrade(trade) {
    if (!(trade instanceof Trade)) {
      throw new Error('Must provide Trade instance');
    }
    if (trade.userId !== this.userId) {
      throw new Error('Trade userId must match position userId');
    }
    this.trades.push(trade);
  }
  
  // Calculate net position size from trades
  get size() {
    return this.trades.reduce((total, trade) => {
      return trade.side === 'buy' 
        ? total.plus(trade.size)
        : total.minus(trade.size);
    }, new Decimal(0)).abs();
  }
  
  // Determine position side from net trades
  get side() {
    const netSize = this.trades.reduce((total, trade) => {
      return trade.side === 'buy' 
        ? total.plus(trade.size)
        : total.minus(trade.size);
    }, new Decimal(0));
    
    if (netSize.isZero()) return null;
    return netSize.gt(0) ? 'long' : 'short';
  }
  
  // Calculate weighted average entry price
  get avgEntryPrice() {
    if (this.trades.length === 0) return new Decimal(0);
    
    let netSize = new Decimal(0);
    let totalCost = new Decimal(0);
    
    for (const trade of this.trades) {
      const cost = trade.size.times(trade.price);
      
      if (trade.side === 'buy') {
        netSize = netSize.plus(trade.size);
        totalCost = totalCost.plus(cost);
      } else {
        netSize = netSize.minus(trade.size);
        totalCost = totalCost.minus(cost);
      }
    }
    
    if (netSize.isZero()) return new Decimal(0);
    return totalCost.dividedBy(netSize).abs();
  }
  
  // Calculate initial margin based on position value and leverage
  get initialMargin() {
    const positionValue = this.getPositionValue();
    return positionValue.dividedBy(this.leverage);
  }
  
  // Calculate maintenance margin (0.5% of position value)
  get maintenanceMargin() {
    const positionValue = this.getPositionValue();
    return positionValue.times(0.005);
  }
  
  // Calculate liquidation price (needs margin calculator for precision)
  get liquidationPrice() {
    if (this.size.isZero()) return new Decimal(0);
    
    // Simplified calculation: entry price +/- (initial margin / size)
    const marginPerUnit = this.initialMargin.dividedBy(this.size);
    
    if (this.side === 'long') {
      return this.avgEntryPrice.minus(marginPerUnit);
    } else {
      return this.avgEntryPrice.plus(marginPerUnit);
    }
  }
  
  // Calculate unrealized PnL (this should be called with current price)
  get unrealizedPnL() {
    // This getter is for backward compatibility - calculateUnrealizedPnL(price) is preferred
    return new Decimal(0);
  }

  addSize(additionalSize, price) {
    const decAdditionalSize = new Decimal(additionalSize);
    const decPrice = new Decimal(price);

    if (decAdditionalSize.isNegative() || decAdditionalSize.isZero() || decPrice.isNegative() || decPrice.isZero()) {
      throw new Error('Invalid size or price for adding to position');
    }

    // Determine trade side based on current position side
    const currentSide = this.side;
    const tradeSide = currentSide === 'long' ? 'buy' : 'sell';
    
    // Create and add trade
    const trade = new Trade(this.userId, tradeSide, additionalSize, price, {
      tradeType: 'position_increase',
      leverage: this.leverage
    });
    
    this.addTrade(trade);
  }

  reduceSize(reductionSize, price) {
    const decReductionSize = new Decimal(reductionSize);
    const decPrice = new Decimal(price);

    if (decReductionSize.isNegative() || decReductionSize.isZero() || decPrice.isNegative() || decPrice.isZero()) {
      throw new Error('Invalid size or price for reducing position');
    }
    
    if (decReductionSize.greaterThan(this.size)) {
      throw new Error('Cannot reduce position by more than current size');
    }

    // Calculate realized PnL before adding the closing trade
    const currentSide = this.side;
    const currentAvgPrice = this.avgEntryPrice;
    
    let realizedPnL;
    if (currentSide === 'long') {
      realizedPnL = decPrice.minus(currentAvgPrice).times(decReductionSize);
    } else {
      realizedPnL = currentAvgPrice.minus(decPrice).times(decReductionSize);
    }

    // Create closing trade (opposite side of current position)
    const closingSide = currentSide === 'long' ? 'sell' : 'buy';
    const trade = new Trade(this.userId, closingSide, reductionSize, price, {
      tradeType: 'position_reduce',
      leverage: this.leverage
    });
    
    this.addTrade(trade);
    
    return realizedPnL;
  }

  closePosition(price) {
    const decPrice = new Decimal(price);
    if (decPrice.isNegative() || decPrice.isZero()) {
      throw new Error('Invalid price for closing position');
    }

    const realizedPnL = this.reduceSize(this.size, decPrice);
    return realizedPnL;
  }

  updatePnL(currentPrice) {
    // This method is kept for backward compatibility
    // In trade-based system, PnL is calculated on demand
    const decCurrentPrice = new Decimal(currentPrice);
    if (decCurrentPrice.isNegative() || decCurrentPrice.isZero()) {
      throw new Error('Invalid current price for PnL calculation');
    }

    // Just call the calculate method - the unrealizedPnL getter is deprecated
    return this.calculateUnrealizedPnL(currentPrice);
  }

  calculateUnrealizedPnL(currentPrice) {
    const decCurrentPrice = new Decimal(currentPrice);
    if (decCurrentPrice.isNegative() || decCurrentPrice.isZero()) {
      throw new Error('Invalid current price for PnL calculation');
    }

    // If no position, no PnL
    if (this.size.isZero() || !this.side) {
      return new Decimal(0);
    }

    if (this.side === 'long') {
      return decCurrentPrice.minus(this.avgEntryPrice).times(this.size);
    } else {
      return this.avgEntryPrice.minus(decCurrentPrice).times(this.size);
    }
  }

  calculateRealizedLoss(executionPrice, executedSize = null) {
    const decExecutionPrice = new Decimal(executionPrice);
    const decExecutedSize = executedSize ? new Decimal(executedSize) : this.size;
    
    if (decExecutionPrice.isNegative() || decExecutionPrice.isZero()) {
      throw new Error('Invalid execution price for loss calculation');
    }

    // Calculate the loss (positive value) when closing at executionPrice
    let loss;
    if (this.side === 'long') {
      // Long: loss when price drops below entry
      loss = this.avgEntryPrice.minus(decExecutionPrice).times(decExecutedSize);
    } else {
      // Short: loss when price rises above entry  
      loss = decExecutionPrice.minus(this.avgEntryPrice).times(decExecutedSize);
    }
    
    // Return max(0, loss) to ensure we only return positive losses
    return Decimal.max(0, loss);
  }

  static calculateRealizedLossStatic(side, entryPrice, executionPrice, executedSize) {
    const decEntryPrice = new Decimal(entryPrice);
    const decExecutionPrice = new Decimal(executionPrice);
    const decExecutedSize = new Decimal(executedSize);
    
    if (decExecutionPrice.isNegative() || decExecutionPrice.isZero()) {
      throw new Error('Invalid execution price for loss calculation');
    }

    // Calculate the loss (positive value) when closing at executionPrice
    let loss;
    if (side === 'long') {
      // Long: loss when price drops below entry
      loss = decEntryPrice.minus(decExecutionPrice).times(decExecutedSize);
    } else {
      // Short: loss when price rises above entry  
      loss = decExecutionPrice.minus(decEntryPrice).times(decExecutedSize);
    }
    
    // Return max(0, loss) to ensure we only return positive losses
    return Decimal.max(0, loss);
  }

  static calculateUnrealizedPnLStatic(side, entryPrice, currentPrice, size) {
    const decEntryPrice = new Decimal(entryPrice);
    const decCurrentPrice = new Decimal(currentPrice);
    const decSize = new Decimal(size);
    
    if (decCurrentPrice.isNegative() || decCurrentPrice.isZero()) {
      throw new Error('Invalid current price for PnL calculation');
    }

    if (side === 'long') {
      return decCurrentPrice.minus(decEntryPrice).times(decSize);
    } else {
      return decEntryPrice.minus(decCurrentPrice).times(decSize);
    }
  }

  getPositionValue() {
    return this.size.times(this.avgEntryPrice);
  }

  getPositionValueAtPrice(price) {
    return this.size.times(new Decimal(price));
  }

  getNotionalValue(currentPrice) {
    return this.size.times(new Decimal(currentPrice));
  }

  calculateLiquidationFee(currentPrice, feeRate) {
    const decCurrentPrice = new Decimal(currentPrice);
    const decFeeRate = new Decimal(feeRate);
    return this.size.times(decCurrentPrice).times(decFeeRate);
  }

  getRoE(currentPrice = null) {
    if (this.initialMargin.isZero() || this.initialMargin === null || this.initialMargin === undefined) {
      return new Decimal(0);
    }
    
    // If no current price provided, can't calculate RoE
    if (!currentPrice) {
      return new Decimal(0);
    }
    
    const unrealizedPnL = this.calculateUnrealizedPnL(currentPrice);
    return unrealizedPnL.dividedBy(this.initialMargin).times(100);
  }

  calculateBankruptcyPrice() {
    // Margin-based calculation: more robust than leverage-based
    // Bankruptcy price is where total loss equals initial margin
    const marginPerUnit = this.initialMargin.dividedBy(this.size);
    
    if (this.side === 'long') {
      // For long: bankruptcy price = entry price - (margin per unit)
      return this.avgEntryPrice.minus(marginPerUnit);
    } else {
      // For short: bankruptcy price = entry price + (margin per unit)  
      return this.avgEntryPrice.plus(marginPerUnit);
    }
  }

  calculateADLScore(totalBalance, currentPrice) {
    const decTotalBalance = new Decimal(totalBalance);
    if (decTotalBalance.isNegative() || decTotalBalance.isZero()) {
      return 0;
    }

    const unrealizedPnL = this.calculateUnrealizedPnL(currentPrice);
    
    if (unrealizedPnL.isNegative() || unrealizedPnL.isZero()) {
      this.adlScore = 0;
      return this.adlScore;
    }

    const profitPercentage = unrealizedPnL.dividedBy(this.initialMargin);
    
    const adjustedBalance = decTotalBalance.plus(unrealizedPnL);
    if (adjustedBalance.isZero()) return 0; // Prevent division by zero

    const effectiveLeverage = this.getPositionValue().dividedBy(adjustedBalance);
    
    this.adlScore = profitPercentage.times(effectiveLeverage).toNumber();
    return this.adlScore;
  }

  isOpen() {
    return this.size.greaterThan(0);
  }

  getDirectionMultiplier() {
    return this.side === 'long' ? 1 : -1;
  }

  toJSON(currentPrice = null) {
    return {
      userId: this.userId,
      side: this.side,
      size: this.size.toString(),
      avgEntryPrice: this.avgEntryPrice.toString(),
      leverage: this.leverage,
      unrealizedPnL: currentPrice ? this.calculateUnrealizedPnL(currentPrice).toString() : "0",
      initialMargin: this.initialMargin.toString(),
      maintenanceMargin: this.maintenanceMargin.toString(),
      liquidationPrice: this.liquidationPrice.toString(),
      bankruptcyPrice: this.calculateBankruptcyPrice().toString(),
      timestamp: this.timestamp,
      positionValue: this.getPositionValue().toString(),
      roe: currentPrice ? this.getRoE(currentPrice).toString() : "0",
      adlScore: this.adlScore,
      isOpen: this.isOpen(),
      trades: this.trades.map(trade => trade.toJSON()),
      tradeCount: this.trades.length
    };
  }
}

class LiquidationPosition extends Position {
  constructor(originalPosition, bankruptcyPrice, userId, liquidationId) {
    // Convert position side to trade side for liquidation transfer
    const tradeSide = originalPosition.side === 'long' ? 'buy' : 'sell';
    
    // Create initial trade at bankruptcy price to represent position transfer
    const initialTrade = new Trade(userId, tradeSide, originalPosition.size, bankruptcyPrice, {
      tradeType: 'liquidation_transfer',
      originalUserId: originalPosition.userId,
      transferTime: Date.now()
    });
    
    super(userId, 1, initialTrade); // Leverage 1 for liquidation engine
    
    // Liquidation-specific properties
    this.id = liquidationId; // ID managed by the liquidation engine
    this.originalUserId = originalPosition.userId;
    this.originalPositionId = originalPosition.id || originalPosition.userId; // Fallback for positions without id
    this.bankruptcyPrice = new Decimal(bankruptcyPrice);
    this.originalEntryPrice = new Decimal(originalPosition.avgEntryPrice);
    this.transferTime = Date.now();
    this.status = 'pending'; // pending, attempting_orderbook, orderbook_failed, adl_required, completed
    this.attempts = 0;
    this.lastAttemptTime = null;
  }
}

module.exports = { Position, LiquidationPosition }; 