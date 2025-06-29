const { Position, LiquidationPosition } = require('./engine/position.ts');
const { Trade } = require('./engine/trade.ts');

describe('Position Class Unit Tests', () => {
  let initialTrade;
  let position;

  beforeEach(() => {
    initialTrade = new Trade('alice', 'buy', 2, 45000);
    position = new Position('alice', 10, initialTrade);
  });

  describe('Constructor', () => {
    test('should create position with initial trade', () => {
      expect(position.userId).toBe('alice');
      expect(position.leverage).toBe(10);
      expect(position.trades).toHaveLength(1);
      expect(position.trades[0]).toBe(initialTrade);
    });

    test('should create empty position without initial trade', () => {
      const emptyPosition = new Position('bob', 5);
      expect(emptyPosition.userId).toBe('bob');
      expect(emptyPosition.leverage).toBe(5);
      expect(emptyPosition.trades).toHaveLength(0);
    });

    test('should throw error for invalid leverage', () => {
      expect(() => new Position('alice', 0)).toThrow('Leverage must be positive');
      expect(() => new Position('alice', -5)).toThrow('Leverage must be positive');
    });
  });

  describe('Size Getter', () => {
    test('should return total size from trades', () => {
      expect(position.size.toString()).toBe('2');
    });

    test('should return 0 for empty position', () => {
      const emptyPosition = new Position('bob', 5);
      expect(emptyPosition.size.toString()).toBe('0');
    });

    test('should handle multiple trades correctly', () => {
      position.addTrade(new Trade('alice', 'buy', 1, 46000));
      expect(position.size.toString()).toBe('3');
    });
  });

  describe('Side Getter', () => {
    test('should return long for net buy position', () => {
      expect(position.side).toBe('long');
    });

    test('should return short for net sell position', () => {
      const sellTrade = new Trade('bob', 'sell', 3, 45000);
      const shortPosition = new Position('bob', 10, sellTrade);
      expect(shortPosition.side).toBe('short');
    });

    test('should return null for empty position', () => {
      const emptyPosition = new Position('bob', 5);
      expect(emptyPosition.side).toBeNull();
    });

    test('should handle mixed trades correctly', () => {
      position.addTrade(new Trade('alice', 'sell', 1, 46000)); // Net: 1 long
      expect(position.side).toBe('long');
      
      position.addTrade(new Trade('alice', 'sell', 2, 47000)); // Net: 1 short
      expect(position.side).toBe('short');
    });
  });

  describe('Average Entry Price Getter', () => {
    test('should calculate weighted average price', () => {
      expect(position.avgEntryPrice.toString()).toBe('45000');
    });

    test('should update with new trades', () => {
      position.addTrade(new Trade('alice', 'buy', 1, 48000));
      expect(position.avgEntryPrice.toString()).toBe('46000');
    });

    test('should return 0 for empty position', () => {
      const emptyPosition = new Position('bob', 5);
      expect(emptyPosition.avgEntryPrice.toString()).toBe('0');
    });
  });

  describe('Margin Calculations', () => {
    test('should calculate initial margin correctly', () => {
      // Size 2, Price 45000, Leverage 10 = 2 * 45000 / 10 = 9000
      expect(position.initialMargin.toString()).toBe('9000');
    });

    test('should calculate maintenance margin correctly', () => {
      // 0.5% of position value (2 * 45000 * 0.005 = 450)
      expect(position.maintenanceMargin.toString()).toBe('450');
    });

    test('should calculate liquidation price correctly for long position', () => {
      // Long: entry - (initial_margin / size) = 45000 - (9000 / 2) = 40500
      expect(position.liquidationPrice.toString()).toBe('40500');
    });

    test('should calculate liquidation price correctly for short position', () => {
      const shortTrade = new Trade('bob', 'sell', 2, 45000);
      const shortPosition = new Position('bob', 10, shortTrade);
      // Short: entry + (initial_margin / size) = 45000 + (9000 / 2) = 49500
      expect(shortPosition.liquidationPrice.toString()).toBe('49500');
    });
  });

  describe('PnL Calculations', () => {
    test('should calculate unrealized PnL for long position', () => {
      // Long: (50000 - 45000) * 2 = 10000
      const pnl = position.calculateUnrealizedPnL(50000);
      expect(pnl.toString()).toBe('10000');
    });

    test('should calculate unrealized PnL for short position', () => {
      const shortTrade = new Trade('bob', 'sell', 2, 45000);
      const shortPosition = new Position('bob', 10, shortTrade);
      // Short: (45000 - 50000) * 2 = -10000
      const pnl = shortPosition.calculateUnrealizedPnL(50000);
      expect(pnl.toString()).toBe('-10000');
    });

    test('should calculate realized loss correctly', () => {
      // Long position losing money: entry 45000, execution 40000, size 1
      // Loss = (45000 - 40000) * 1 = 5000
      const loss = position.calculateRealizedLoss(40000, 1);
      expect(loss.toString()).toBe('5000');
    });

    test('should return 0 for profitable closure', () => {
      // Long position making money: entry 45000, execution 50000
      const loss = position.calculateRealizedLoss(50000);
      expect(loss.toString()).toBe('0');
    });
  });

  describe('Static Methods', () => {
    test('should calculate static unrealized PnL', () => {
      const pnl = Position.calculateUnrealizedPnLStatic('long', 45000, 50000, 2);
      expect(pnl.toString()).toBe('10000');
    });

    test('should calculate static realized loss', () => {
      const loss = Position.calculateRealizedLossStatic('long', 45000, 40000, 1);
      expect(loss.toString()).toBe('5000');
    });
  });

  describe('Position Value Methods', () => {
    test('should calculate position value', () => {
      expect(position.getPositionValue().toString()).toBe('90000');
    });

    test('should calculate position value at specific price', () => {
      expect(position.getPositionValueAtPrice(50000).toString()).toBe('100000');
    });

    test('should calculate notional value', () => {
      expect(position.getNotionalValue(50000).toString()).toBe('100000');
    });

    test('should calculate liquidation fee', () => {
      const fee = position.calculateLiquidationFee(50000, 0.015);
      expect(fee.toString()).toBe('1500');
    });
  });

  describe('ROE Calculation', () => {
    test('should calculate ROE correctly', () => {
      // PnL: 10000, Initial Margin: 9000, ROE = 10000/9000 * 100 = 111.11%
      const roe = position.getRoE(50000);
      expect(parseFloat(roe.toString())).toBeCloseTo(111.11, 2);
    });

    test('should return 0 for zero margin', () => {
      // Test the zero margin check in getRoE method
      const emptyPosition = new Position('alice', 10);
      expect(emptyPosition.getRoE(50000).toString()).toBe('0');
    });
  });

  describe('Bankruptcy Price', () => {
    test('should calculate bankruptcy price for long position', () => {
      const bankruptcyPrice = position.calculateBankruptcyPrice();
      expect(bankruptcyPrice.toString()).toBe('40500');
    });

    test('should calculate bankruptcy price for short position', () => {
      const shortTrade = new Trade('bob', 'sell', 2, 45000);
      const shortPosition = new Position('bob', 10, shortTrade);
      const bankruptcyPrice = shortPosition.calculateBankruptcyPrice();
      expect(bankruptcyPrice.toString()).toBe('49500');
    });
  });

  describe('ADL Score Calculation', () => {
    test('should calculate ADL score for profitable position', () => {
      const score = position.calculateADLScore(100000, 50000);
      expect(score).toBeGreaterThan(0);
      expect(position.adlScore).toBe(score);
    });

    test('should return 0 for losing position', () => {
      const score = position.calculateADLScore(100000, 40000);
      expect(score).toBe(0);
    });
  });

  describe('Position State Methods', () => {
    test('should identify open position', () => {
      expect(position.isOpen()).toBe(true);
    });

    test('should identify closed position', () => {
      const emptyPosition = new Position('bob', 5);
      expect(emptyPosition.isOpen()).toBe(false);
    });

    test('should return correct direction multiplier', () => {
      expect(position.getDirectionMultiplier()).toBe(1);
      
      const shortTrade = new Trade('bob', 'sell', 2, 45000);
      const shortPosition = new Position('bob', 10, shortTrade);
      expect(shortPosition.getDirectionMultiplier()).toBe(-1);
    });
  });

  describe('JSON Serialization', () => {
    test('should serialize to JSON correctly', () => {
      const json = position.toJSON(50000);
      expect(json.userId).toBe('alice');
      expect(json.side).toBe('long');
      expect(json.size).toBe('2');
      expect(json.avgEntryPrice).toBe('45000');
      expect(json.leverage).toBe(10);
      expect(json.unrealizedPnL).toBe('10000');
      expect(json.trades).toHaveLength(1);
    });

    test('should serialize without current price', () => {
      const json = position.toJSON();
      expect(json.unrealizedPnL).toBe('0');
      expect(json.roe).toBe('0');
    });
  });

  describe('Trade Management', () => {
    test('should add trade correctly', () => {
      const newTrade = new Trade('alice', 'buy', 1, 46000);
      position.addTrade(newTrade);
      
      expect(position.trades).toHaveLength(2);
      expect(position.size.toString()).toBe('3');
      expect(position.avgEntryPrice.toString()).toBe('45333.333333333333333');
    });

    test('should handle reducing trades', () => {
      const reduceTrade = new Trade('alice', 'sell', 1, 46000);
      position.addTrade(reduceTrade);
      
      expect(position.size.toString()).toBe('1');
      expect(position.side).toBe('long');
    });

    test('should handle position flipping', () => {
      const flipTrade = new Trade('alice', 'sell', 3, 46000);
      position.addTrade(flipTrade);
      
      expect(position.size.toString()).toBe('1');
      expect(position.side).toBe('short');
    });
  });
});

describe('LiquidationPosition Class Unit Tests', () => {
  let originalPosition;
  let liquidationPosition;

  beforeEach(() => {
    const trade = new Trade('charlie', 'buy', 2, 45000);
    originalPosition = new Position('charlie', 10, trade);
    liquidationPosition = new LiquidationPosition(
      originalPosition, 
      40500, 
      'liquidation_engine', 
      'LP001'
    );
  });

  describe('Constructor', () => {
    test('should create liquidation position from original position', () => {
      expect(liquidationPosition.id).toBe('LP001');
      expect(liquidationPosition.originalUserId).toBe('charlie');
      expect(liquidationPosition.userId).toBe('liquidation_engine');
      expect(liquidationPosition.size.toString()).toBe('2');
      expect(liquidationPosition.side).toBe('long');
    });

    test('should set liquidation-specific properties', () => {
      expect(liquidationPosition.bankruptcyPrice.toString()).toBe('40500');
      expect(liquidationPosition.originalEntryPrice.toString()).toBe('45000');
      expect(liquidationPosition.status).toBe('pending');
      expect(liquidationPosition.attempts).toBe(0);
    });

    test('should handle short position conversion', () => {
      const shortTrade = new Trade('dave', 'sell', 2, 45000);
      const shortPosition = new Position('dave', 10, shortTrade);
      const shortLiquidation = new LiquidationPosition(
        shortPosition, 
        49500, 
        'liquidation_engine', 
        'LP002'
      );
      
      expect(shortLiquidation.side).toBe('short');
      expect(shortLiquidation.bankruptcyPrice.toString()).toBe('49500');
    });
  });

  describe('Inheritance', () => {
    test('should inherit all position methods', () => {
      const pnl = liquidationPosition.calculateUnrealizedPnL(42000);
      expect(pnl.toString()).toBe('3000'); // (42000 - 40500) * 2
    });

    test('should maintain original position calculations', () => {
      expect(liquidationPosition.initialMargin.toString()).toBe('81000'); // Size 2 * Price 40500 / Leverage 1
      expect(liquidationPosition.liquidationPrice.toString()).toBe('0'); // Entry 40500 - margin per unit 40500 = 0
    });
  });

  describe('Position Entry Price Conversion', () => {
    test('should use bankruptcy price as new entry price', () => {
      expect(liquidationPosition.avgEntryPrice.toString()).toBe('40500');
    });

    test('should store original entry price', () => {
      expect(liquidationPosition.originalEntryPrice.toString()).toBe('45000');
    });
  });
});

describe('Error Handling', () => {
  test('should handle invalid prices in PnL calculation', () => {
    const trade = new Trade('alice', 'buy', 2, 45000);
    const position = new Position('alice', 10, trade);
    
    expect(() => position.calculateUnrealizedPnL(0)).toThrow('Invalid current price');
    expect(() => position.calculateUnrealizedPnL(-1000)).toThrow('Invalid current price');
  });

  test('should handle invalid execution prices in loss calculation', () => {
    const trade = new Trade('alice', 'buy', 2, 45000);
    const position = new Position('alice', 10, trade);
    
    expect(() => position.calculateRealizedLoss(0)).toThrow('Invalid execution price');
    expect(() => position.calculateRealizedLoss(-1000)).toThrow('Invalid execution price');
  });

  test('should handle empty trade history gracefully', () => {
    const emptyPosition = new Position('alice', 10);
    
    expect(emptyPosition.size.toString()).toBe('0');
    expect(emptyPosition.side).toBeNull();
    expect(emptyPosition.avgEntryPrice.toString()).toBe('0');
    expect(emptyPosition.calculateUnrealizedPnL(50000).toString()).toBe('0');
  });
}); 