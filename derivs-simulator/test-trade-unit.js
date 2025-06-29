const { Trade } = require('./engine/trade');

describe('Trade Class Unit Tests', () => {
  describe('Constructor', () => {
    test('should create trade with valid parameters', () => {
      const trade = new Trade('alice', 'buy', 2, 45000);
      
      expect(trade.userId).toBe('alice');
      expect(trade.side).toBe('buy');
      expect(trade.size.toString()).toBe('2');
      expect(trade.price.toString()).toBe('45000');
      expect(trade.direction).toBe(1);
      expect(trade.notionalValue.toString()).toBe('90000');
    });

    test('should create trade with options', () => {
      const options = {
        id: 'TRADE001',
        leverage: 10,
        fee: 50,
        orderId: 'ORDER001',
        tradeType: 'liquidation',
        markPrice: 45100,
        indexPrice: 45050
      };
      
      const trade = new Trade('bob', 'sell', 1.5, 46000, options);
      
      expect(trade.id).toBe('TRADE001');
      expect(trade.leverage).toBe(10);
      expect(trade.fee.toString()).toBe('50');
      expect(trade.orderId).toBe('ORDER001');
      expect(trade.tradeType).toBe('liquidation');
      expect(trade.markPrice.toString()).toBe('45100');
      expect(trade.indexPrice.toString()).toBe('45050');
    });

    test('should generate unique ID if not provided', () => {
      const trade1 = new Trade('alice', 'buy', 1, 45000);
      const trade2 = new Trade('alice', 'buy', 1, 45000);
      
      expect(trade1.id).toBeDefined();
      expect(trade2.id).toBeDefined();
      expect(trade1.id).not.toBe(trade2.id);
    });

    test('should set default values correctly', () => {
      const trade = new Trade('alice', 'buy', 2, 45000);
      
      expect(trade.fee.toString()).toBe('0');
      expect(trade.leverage).toBe(1);
      expect(trade.orderId).toBeNull();
      expect(trade.counterparty).toBeNull();
      expect(trade.tradeType).toBe('normal');
      expect(trade.markPrice).toBeNull();
      expect(trade.indexPrice).toBeNull();
    });
  });

  describe('Validation', () => {
    test('should throw error for invalid userId', () => {
      expect(() => new Trade('', 'buy', 1, 45000)).toThrow('Trade requires valid userId');
      expect(() => new Trade(null, 'buy', 1, 45000)).toThrow('Trade requires valid userId');
      expect(() => new Trade(123, 'buy', 1, 45000)).toThrow('Trade requires valid userId');
    });

    test('should throw error for invalid side', () => {
      expect(() => new Trade('alice', 'long', 1, 45000)).toThrow('Trade side must be "buy" or "sell"');
      expect(() => new Trade('alice', 'short', 1, 45000)).toThrow('Trade side must be "buy" or "sell"');
      expect(() => new Trade('alice', '', 1, 45000)).toThrow('Trade side must be "buy" or "sell"');
    });

    test('should throw error for invalid size', () => {
      expect(() => new Trade('alice', 'buy', 0, 45000)).toThrow('Trade size must be positive');
      expect(() => new Trade('alice', 'buy', -1, 45000)).toThrow('Trade size must be positive');
      expect(() => new Trade('alice', 'buy', null, 45000)).toThrow('Trade size must be positive');
    });

    test('should throw error for invalid price', () => {
      expect(() => new Trade('alice', 'buy', 1, 0)).toThrow('Trade price must be positive');
      expect(() => new Trade('alice', 'buy', 1, -1000)).toThrow('Trade price must be positive');
      expect(() => new Trade('alice', 'buy', 1, null)).toThrow('Trade price must be positive');
    });
  });

  describe('Static Factory Methods', () => {
    test('should create normal trade', () => {
      const trade = Trade.createNormalTrade('alice', 'buy', 2, 45000, { orderId: 'ORDER1' });
      
      expect(trade.tradeType).toBe('normal');
      expect(trade.userId).toBe('alice');
      expect(trade.orderId).toBe('ORDER1');
    });

    test('should create liquidation trade', () => {
      const trade = Trade.createLiquidationTrade('bob', 'sell', 1, 40000);
      
      expect(trade.tradeType).toBe('liquidation');
      expect(trade.userId).toBe('bob');
      expect(trade.side).toBe('sell');
    });

    test('should create ADL trade', () => {
      const trade = Trade.createADLTrade('charlie', 'buy', 0.5, 48000);
      
      expect(trade.tradeType).toBe('adl');
      expect(trade.userId).toBe('charlie');
      expect(trade.size.toString()).toBe('0.5');
    });
  });

  describe('Helper Methods', () => {
    let buyTrade, sellTrade, liquidationTrade, adlTrade;

    beforeEach(() => {
      buyTrade = new Trade('alice', 'buy', 2, 45000);
      sellTrade = new Trade('bob', 'sell', 1.5, 46000);
      liquidationTrade = Trade.createLiquidationTrade('charlie', 'sell', 1, 40000);
      adlTrade = Trade.createADLTrade('dave', 'buy', 0.5, 48000);
    });

    test('should identify long positions correctly', () => {
      expect(buyTrade.isLong()).toBe(true);
      expect(sellTrade.isLong()).toBe(false);
    });

    test('should identify short positions correctly', () => {
      expect(buyTrade.isShort()).toBe(false);
      expect(sellTrade.isShort()).toBe(true);
    });

    test('should identify liquidation trades correctly', () => {
      expect(buyTrade.isLiquidation()).toBe(false);
      expect(liquidationTrade.isLiquidation()).toBe(true);
    });

    test('should identify ADL trades correctly', () => {
      expect(buyTrade.isADL()).toBe(false);
      expect(adlTrade.isADL()).toBe(true);
    });
  });

  describe('Size and Notional Calculations', () => {
    let buyTrade, sellTrade;

    beforeEach(() => {
      buyTrade = new Trade('alice', 'buy', 2, 45000);
      sellTrade = new Trade('bob', 'sell', 1.5, 46000);
    });

    test('should calculate signed size correctly', () => {
      expect(buyTrade.getSignedSize().toString()).toBe('2');
      expect(sellTrade.getSignedSize().toString()).toBe('-1.5');
    });

    test('should calculate signed notional correctly', () => {
      expect(buyTrade.getSignedNotional().toString()).toBe('90000');
      expect(sellTrade.getSignedNotional().toString()).toBe('-69000');
    });

    test('should calculate position size impact correctly', () => {
      expect(buyTrade.getPositionSizeImpact().toString()).toBe('2');
      expect(sellTrade.getPositionSizeImpact().toString()).toBe('-1.5');
    });
  });

  describe('PnL Calculations', () => {
    test('should calculate PnL for sell trade correctly', () => {
      const sellTrade = new Trade('alice', 'sell', 2, 47000);
      // Selling at 47000, entry was 45000: PnL = (47000 - 45000) * 2 = 4000
      const pnl = sellTrade.calculatePnL(45000);
      expect(pnl.toString()).toBe('4000');
    });

    test('should calculate PnL for buy trade (closing short) correctly', () => {
      const buyTrade = new Trade('alice', 'buy', 2, 43000);
      // Buying at 43000 to close short opened at 45000: PnL = (45000 - 43000) * 2 = 4000
      const pnl = buyTrade.calculatePnL(45000);
      expect(pnl.toString()).toBe('4000');
    });

    test('should handle loss scenarios correctly', () => {
      const sellTrade = new Trade('alice', 'sell', 2, 43000);
      // Selling at 43000, entry was 45000: PnL = (43000 - 45000) * 2 = -4000
      const pnl = sellTrade.calculatePnL(45000);
      expect(pnl.toString()).toBe('-4000');
    });
  });

  describe('Position Impact Analysis', () => {
    let trade;

    beforeEach(() => {
      trade = new Trade('alice', 'buy', 2, 45000);
    });

    test('should detect if trade would increase position', () => {
      expect(trade.wouldIncrease('long')).toBe(true);  // Buy increases long
      expect(trade.wouldIncrease('short')).toBe(false); // Buy doesn't increase short
      expect(trade.wouldIncrease(null)).toBe(true);     // Any trade increases empty position
    });

    test('should detect if trade would decrease position', () => {
      expect(trade.wouldDecrease('long')).toBe(false);  // Buy doesn't decrease long
      expect(trade.wouldDecrease('short')).toBe(true);  // Buy decreases short
      expect(trade.wouldDecrease(null)).toBe(false);    // Can't decrease empty position
    });

    test('should handle sell trades correctly', () => {
      const sellTrade = new Trade('alice', 'sell', 1, 46000);
      
      expect(sellTrade.wouldIncrease('short')).toBe(true);
      expect(sellTrade.wouldIncrease('long')).toBe(false);
      expect(sellTrade.wouldDecrease('long')).toBe(true);
      expect(sellTrade.wouldDecrease('short')).toBe(false);
    });
  });

  describe('Validation Method', () => {
    test('should return null for valid trade', () => {
      const trade = new Trade('alice', 'buy', 2, 45000);
      expect(trade.validate()).toBeNull();
    });

    test('should return errors for invalid trade', () => {
      // Create an invalid trade by manually setting properties
      const trade = new Trade('alice', 'buy', 2, 45000);
      trade.userId = '';
      trade.side = 'invalid';
      trade.size = trade.size.negated();
      trade.price = trade.price.negated();
      trade.fee = trade.fee.minus(10);

      const errors = trade.validate();
      expect(errors).toContain('Missing userId');
      expect(errors).toContain('Invalid side');
      expect(errors).toContain('Size must be positive');
      expect(errors).toContain('Price must be positive');
      expect(errors).toContain('Fee cannot be negative');
    });
  });

  describe('JSON Serialization', () => {
    test('should serialize to JSON correctly', () => {
      const options = {
        id: 'TRADE001',
        leverage: 10,
        fee: 50,
        orderId: 'ORDER001',
        counterparty: 'bob',
        tradeType: 'liquidation',
        markPrice: 45100,
        indexPrice: 45050
      };
      
      const trade = new Trade('alice', 'buy', 2, 45000, options);
      const json = trade.toJSON();

      expect(json.id).toBe('TRADE001');
      expect(json.userId).toBe('alice');
      expect(json.side).toBe('buy');
      expect(json.size).toBe('2');
      expect(json.price).toBe('45000');
      expect(json.leverage).toBe(10);
      expect(json.fee).toBe('50');
      expect(json.orderId).toBe('ORDER001');
      expect(json.counterparty).toBe('bob');
      expect(json.tradeType).toBe('liquidation');
      expect(json.markPrice).toBe('45100');
      expect(json.indexPrice).toBe('45050');
      expect(json.notionalValue).toBe('90000');
      expect(json.direction).toBe(1);
    });

    test('should handle null values in JSON', () => {
      const trade = new Trade('alice', 'buy', 2, 45000);
      const json = trade.toJSON();

      expect(json.orderId).toBeNull();
      expect(json.counterparty).toBeNull();
      expect(json.markPrice).toBeNull();
      expect(json.indexPrice).toBeNull();
    });
  });

  describe('JSON Deserialization', () => {
    test('should create trade from JSON correctly', () => {
      const jsonData = {
        id: 'TRADE001',
        userId: 'alice',
        side: 'buy',
        size: '2',
        price: '45000',
        timestamp: 1640995200000,
        fee: '50',
        leverage: 10,
        orderId: 'ORDER001',
        counterparty: 'bob',
        tradeType: 'liquidation',
        markPrice: '45100',
        indexPrice: '45050'
      };

      const trade = Trade.fromJSON(jsonData);

      expect(trade.id).toBe('TRADE001');
      expect(trade.userId).toBe('alice');
      expect(trade.side).toBe('buy');
      expect(trade.size.toString()).toBe('2');
      expect(trade.price.toString()).toBe('45000');
      expect(trade.timestamp).toBe(1640995200000);
      expect(trade.fee.toString()).toBe('50');
      expect(trade.leverage).toBe(10);
      expect(trade.orderId).toBe('ORDER001');
      expect(trade.counterparty).toBe('bob');
      expect(trade.tradeType).toBe('liquidation');
      expect(trade.markPrice.toString()).toBe('45100');
      expect(trade.indexPrice.toString()).toBe('45050');
    });

    test('should roundtrip JSON serialization correctly', () => {
      const originalTrade = new Trade('alice', 'sell', 1.5, 46000, {
        id: 'TRADE002',
        leverage: 5,
        fee: 25,
        tradeType: 'adl'
      });

      const json = originalTrade.toJSON();
      const deserializedTrade = Trade.fromJSON(json);

      expect(deserializedTrade.id).toBe(originalTrade.id);
      expect(deserializedTrade.userId).toBe(originalTrade.userId);
      expect(deserializedTrade.side).toBe(originalTrade.side);
      expect(deserializedTrade.size.toString()).toBe(originalTrade.size.toString());
      expect(deserializedTrade.price.toString()).toBe(originalTrade.price.toString());
      expect(deserializedTrade.leverage).toBe(originalTrade.leverage);
      expect(deserializedTrade.fee.toString()).toBe(originalTrade.fee.toString());
      expect(deserializedTrade.tradeType).toBe(originalTrade.tradeType);
    });
  });

  describe('String Representation', () => {
    test('should provide readable string representation', () => {
      const trade = new Trade('alice', 'buy', 2, 45000, { id: 'TRADE001' });
      const str = trade.toString();
      
      expect(str).toContain('TRADE001');
      expect(str).toContain('alice');
      expect(str).toContain('buy');
      expect(str).toContain('2');
      expect(str).toContain('45000');
    });
  });

  describe('Decimal Precision', () => {
    test('should handle decimal sizes correctly', () => {
      const trade = new Trade('alice', 'buy', 0.123456789, 45000.123456789);
      
      expect(trade.size.toString()).toBe('0.123456789');
      expect(trade.price.toString()).toBe('45000.123456789');
      expect(trade.notionalValue.decimalPlaces()).toBeGreaterThan(10);
    });

    test('should maintain precision in calculations', () => {
      const trade = new Trade('alice', 'buy', 0.1, 45000);
      const signedSize = trade.getSignedSize();
      const notional = trade.getSignedNotional();
      
      expect(signedSize.toString()).toBe('0.1');
      expect(notional.toString()).toBe('4500');
    });
  });

  describe('Edge Cases', () => {
    test('should handle very small sizes', () => {
      const trade = new Trade('alice', 'buy', 0.00000001, 45000);
      expect(trade.size.toString()).toBe('1e-8'); // Decimal.js uses scientific notation for very small numbers
      expect(trade.notionalValue.toString()).toBe('0.00045');
    });

    test('should handle very large prices', () => {
      const trade = new Trade('alice', 'buy', 1, 999999999);
      expect(trade.price.toString()).toBe('999999999');
      expect(trade.notionalValue.toString()).toBe('999999999');
    });

    test('should handle timestamp correctly', () => {
      const customTimestamp = 1640995200000;
      const trade = new Trade('alice', 'buy', 1, 45000, { timestamp: customTimestamp });
      
      expect(trade.timestamp).toBe(customTimestamp);
    });

    test('should generate timestamp if not provided', () => {
      const beforeTime = Date.now();
      const trade = new Trade('alice', 'buy', 1, 45000);
      const afterTime = Date.now();
      
      expect(trade.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(trade.timestamp).toBeLessThanOrEqual(afterTime);
    });
  });
}); 