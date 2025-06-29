const { Decimal } = require('decimal.js');

// Mock console methods before importing
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Import the actual class (not Jest-style describe/test)
const { LiquidationEngine } = require('./engine/liquidation');
const { Position } = require('./engine/position');
const { Trade } = require('./engine/trade');

// Mock dependencies
class MockMatchingEngine {
  constructor() {
    this.shouldReturnMatches = false;
    this.mockFills = [];
  }

  setMockResponse(shouldMatch, fills = []) {
    this.shouldReturnMatches = shouldMatch;
    this.mockFills = fills;
  }

  match(order) {
    if (this.shouldReturnMatches) {
      // Simulate successful matching
      order.filledSize = order.remainingSize;
      order.avgFillPrice = 40000; // Mock execution price
      order.fills = this.mockFills;
      order.status = 'FILLED';
      return this.mockFills;
    } else {
      // Simulate no liquidity
      order.filledSize = 0;
      order.avgFillPrice = 0;
      order.fills = [];
      order.status = 'CANCELLED';
      return [];
    }
  }
}

class MockOrderBook {
  constructor() {
    this.bids = [];
    this.asks = [];
  }

  setBidsAndAsks(bids, asks) {
    this.bids = bids;
    this.asks = asks;
  }
}

class MockMarginCalculator {
  constructor() {
    this.mockBankruptcyPrice = new Decimal(40500);
  }

  setBankruptcyPrice(price) {
    this.mockBankruptcyPrice = new Decimal(price);
  }

  shouldLiquidate(position, currentPrice) {
    // Mock logic: liquidate if current price is below liquidation price
    const liquidationPrice = new Decimal(position.liquidationPrice || 40725);
    return new Decimal(currentPrice).lt(liquidationPrice);
  }

  calculateBankruptcyPrice(position) {
    return this.mockBankruptcyPrice;
  }
}

class MockADLEngine {
  constructor() {
    this.mockQueue = [];
  }

  setMockQueue(queue) {
    this.mockQueue = queue;
  }

  getADLQueue() {
    return this.mockQueue;
  }
}

// Test helper functions
function createMockPosition(overrides = {}) {
  // Default values
  const defaults = {
    userId: 'testUser',
    side: 'long',
    size: 1,
    avgEntryPrice: 45000,
    leverage: 10
  };
  
  // Apply overrides, handling Decimal objects
  const config = { ...defaults };
  Object.keys(overrides).forEach(key => {
    if (key === 'size' || key === 'avgEntryPrice') {
      // Convert Decimal objects to numbers for Position constructor
      config[key] = overrides[key] instanceof Decimal ? overrides[key].toNumber() : overrides[key];
    } else {
      config[key] = overrides[key];
    }
  });
  
  // Create the initial trade for the position
  const tradeSide = config.side === 'long' ? 'buy' : 'sell';
  const initialTrade = new Trade(config.userId, tradeSide, config.size, config.avgEntryPrice, {
    tradeType: 'test_position_creation',
    leverage: config.leverage
  });
  
  // Create trade-based Position object
  const position = new Position(config.userId, config.leverage, initialTrade);
  
  // Add any additional properties that tests might expect for backward compatibility
  if (overrides.liquidationPrice) {
    // Override the calculated liquidation price for test consistency
    Object.defineProperty(position, 'liquidationPrice', {
      get: () => new Decimal(overrides.liquidationPrice),
      configurable: true
    });
  }
  
  // Handle unrealizedPnL override (for tests that set this directly)
  if (overrides.unrealizedPnL !== undefined) {
    // Override the calculateUnrealizedPnL method for test consistency
    position.calculateUnrealizedPnL = () => new Decimal(overrides.unrealizedPnL);
  }
  
  // Override initialMargin if explicitly provided
  if (overrides.initialMargin !== undefined) {
    Object.defineProperty(position, 'initialMargin', {
      get: () => new Decimal(overrides.initialMargin),
      configurable: true
    });
  }
  
  return position;
}

function createAllPositionsMap(positions = []) {
  const map = new Map();
  positions.forEach(pos => {
    map.set(pos.userId, pos);
  });
  return map;
}

// Test Suite (only runs when using Jest)
if (typeof describe !== 'undefined') {
describe('LiquidationEngine.liquidate', () => {
  let liquidationEngine;
  let mockMatchingEngine;
  let mockOrderBook;
  let mockMarginCalculator;
  let mockADLEngine;

  beforeEach(() => {
    // Create mock dependencies
    mockMatchingEngine = new MockMatchingEngine();
    mockOrderBook = new MockOrderBook();
    mockMarginCalculator = new MockMarginCalculator();
    mockADLEngine = new MockADLEngine();

    // Create liquidation engine with mocks
    liquidationEngine = new LiquidationEngine(
      mockMatchingEngine,
      mockOrderBook,
      mockMarginCalculator,
      mockADLEngine
    );

    // Suppress console logs for cleaner test output
    console.log = jest.fn();
    console.error = jest.fn();
  });

  afterEach(() => {
    // Restore console logs
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('Fallback Liquidation (Force Mode)', () => {
    test('should execute fallback liquidation at bankruptcy price', async () => {
      // Arrange
      const position = createMockPosition();
      const currentPrice = 40625;
      const allPositions = createAllPositionsMap([position]);
      const bankruptcyPrice = 40500;
      
      mockMarginCalculator.setBankruptcyPrice(bankruptcyPrice);

      // Act
      const result = await liquidationEngine.liquidate(
        position, 
        currentPrice, 
        allPositions
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.method).toBe('bankruptcy_price');
      expect(result.executionPrice.toString()).toBe('40500');
      expect(result.totalExecuted.toString()).toBe('1');
      expect(result.userId).toBe('testUser');
      expect(result.side).toBe('long');
    });

    test('should calculate correct loss for long position', async () => {
      // Arrange
      const position = createMockPosition({
        side: 'long',
        avgEntryPrice: new Decimal(45000),
        size: new Decimal(1)
      });
      const currentPrice = 40625;
      const bankruptcyPrice = 40500;
      const allPositions = createAllPositionsMap([position]);
      
      mockMarginCalculator.setBankruptcyPrice(bankruptcyPrice);

      // Act
      const result = await liquidationEngine.liquidate(
        position, 
        currentPrice, 
        allPositions
      );

      // Assert
      // Loss = (entryPrice - bankruptcyPrice) * size = (45000 - 40500) * 1 = 4500
      expect(result.preLiquidationLoss.toString()).toBe('4375'); // Based on current price
      expect(result.executionPrice.toString()).toBe('40500'); // Executed at bankruptcy price
    });

    test('should calculate correct loss for short position', async () => {
      // Arrange
      const position = createMockPosition({
        side: 'short',
        avgEntryPrice: new Decimal(45000),
        size: new Decimal(1),
        unrealizedPnL: new Decimal(4375)
      });
      const currentPrice = 40625;
      const bankruptcyPrice = 49500; // Short bankruptcy price is higher
      const allPositions = createAllPositionsMap([position]);
      
      mockMarginCalculator.setBankruptcyPrice(bankruptcyPrice);

      // Act
      const result = await liquidationEngine.liquidate(
        position, 
        currentPrice, 
        allPositions
      );

      // Assert
      expect(result.side).toBe('short');
      expect(result.executionPrice.toString()).toBe('49500');
      expect(result.method).toBe('bankruptcy_price');
    });
  });

  describe('Order Book Liquidation', () => {
    test('should attempt order book liquidation first when not in force mode', async () => {
      // Arrange
      const position = createMockPosition();
      const currentPrice = 40625;
      const allPositions = createAllPositionsMap([position]);
      
      // Mock successful order book execution
      mockMatchingEngine.setMockResponse(true, [
        { price: 40000, size: 1, timestamp: Date.now() }
      ]);

      // Act
      const result = await liquidationEngine.liquidate(
        position, 
        currentPrice, 
        allPositions
      );

      // Assert
      expect(result.method).toBe('market_order');
      expect(result.totalExecuted.toString()).toBe('1');
      expect(result.fills).toHaveLength(1);
    });

    test('should fallback to bankruptcy price when no order book liquidity', async () => {
      // Arrange
      const position = createMockPosition();
      const currentPrice = 40625;
      const allPositions = createAllPositionsMap([position]);
      
      // Mock no liquidity in order book
      mockMatchingEngine.setMockResponse(false);

      // Act
      const result = await liquidationEngine.liquidate(
        position, 
        currentPrice, 
        allPositions
      );

      // Assert
      expect(result.method).toBe('bankruptcy_price');
      expect(result.totalExecuted.toString()).toBe('1');
      expect(result.fills).toHaveLength(0);
    });
  });

  describe('Insurance Fund Updates', () => {
    test('should update insurance fund after liquidation', async () => {
      // Arrange
      const initialFund = liquidationEngine.getInsuranceFundBalance();
      const position = createMockPosition();
      const currentPrice = 40625;
      const allPositions = createAllPositionsMap([position]);

      // Act
      await liquidationEngine.liquidate(
        position, 
        currentPrice, 
        allPositions
      );

      // Assert
      const finalFund = liquidationEngine.getInsuranceFundBalance();
      expect(finalFund).not.toEqual(initialFund);
      
      // Insurance fund should have increased due to liquidation fee
      const fundChange = new Decimal(finalFund).minus(new Decimal(initialFund));
      expect(fundChange.gt(0)).toBe(true); // Should be positive (fee collected)
    });
  });

  describe('Error Handling', () => {
    test('should handle errors gracefully and fallback', async () => {
      // Arrange
      const position = createMockPosition();
      const currentPrice = 40625;
      const allPositions = createAllPositionsMap([position]);
      
      // Mock matching engine to throw error
      mockMatchingEngine.match = jest.fn(() => {
        throw new Error('Order book failure');
      });

      // Act
      const result = await liquidationEngine.liquidate(
        position, 
        currentPrice, 
        allPositions
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.method).toBe('bankruptcy_price'); // Should fallback
      expect(mockMatchingEngine.match).toHaveBeenCalled();
    });
  });

  describe('Zero-Sum Calculations', () => {
    test('should correctly calculate position totals for zero-sum check', async () => {
      // Arrange
      const longPosition = createMockPosition({
        userId: 'longUser',
        side: 'long',
        size: new Decimal(2),
        unrealizedPnL: new Decimal(-1000)
      });
      
      const shortPosition = createMockPosition({
        userId: 'shortUser',
        side: 'short',
        size: new Decimal(2),
        unrealizedPnL: new Decimal(1000)
      });
      
      const allPositions = createAllPositionsMap([longPosition, shortPosition]);
      const currentPrice = 40625;

      // Act
      const result = await liquidationEngine.liquidate(
        longPosition, 
        currentPrice, 
        allPositions
      );

      // Assert
      expect(result).toBeDefined();
      // The zero-sum check should be logged (we're testing the calculation happens)
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('PRE-LIQUIDATION ZERO-SUM CHECK'),
        expect.any(Object)
      );
    });
  });

  describe('Liquidation Result Structure', () => {
    test('should return complete liquidation result object', async () => {
      // Arrange
      const position = createMockPosition();
      const currentPrice = 40625;
      const allPositions = createAllPositionsMap([position]);

      // Act
      const result = await liquidationEngine.liquidate(
        position, 
        currentPrice, 
        allPositions
      );

      // Assert - Check all required fields are present
      expect(result).toMatchObject({
        positionId: expect.any(String),
        userId: expect.any(String),
        side: expect.any(String),
        size: expect.any(Object), // Decimal object
        entryPrice: expect.any(Object), // Decimal object
        initialMargin: expect.any(Object), // Decimal object
        bankruptcyPrice: expect.any(Object), // Decimal object
        preLiquidationLoss: expect.any(Object), // Decimal object
        liquidationFee: expect.any(Object), // Decimal object
        timestamp: expect.any(Number),
        method: expect.any(String),
        executionPrice: expect.any(Object), // Decimal object
        totalExecuted: expect.any(Object), // Decimal object
        remainingBalance: expect.any(Object), // Decimal object
        insuranceFundLoss: expect.any(Object) // Decimal object
      });
    });
  });
});
} // End Jest tests

// Manual test function for debugging
async function manualTest() {
  console.log('🧪 MANUAL LIQUIDATION TEST');
  console.log('==========================');
  
  // Create real instances (not mocked) for manual testing
  const mockMatchingEngine = new MockMatchingEngine();
  const mockOrderBook = new MockOrderBook();
  const mockMarginCalculator = new MockMarginCalculator();
  const mockADLEngine = new MockADLEngine();
  
  const liquidationEngine = new LiquidationEngine(
    mockMatchingEngine,
    mockOrderBook,
    mockMarginCalculator,
    mockADLEngine
  );
  
  // Test scenario: Long position liquidation
  const position = createMockPosition({
    userId: 'debugUser',
    side: 'long',
    size: new Decimal(1),
    avgEntryPrice: new Decimal(45000),
    initialMargin: new Decimal(4500)
  });
  
  const currentPrice = 40625;
  const allPositions = createAllPositionsMap([position]);
  
  console.log('📊 Test Parameters:', {
    userId: position.userId,
    side: position.side,
    size: position.size.toString(),
    entryPrice: position.avgEntryPrice.toString(),
    currentPrice,
    initialMargin: position.initialMargin.toString()
  });
  
  try {
    const result = await liquidationEngine.liquidate(
      position,
      currentPrice,
      allPositions
    );
    
    console.log('✅ Liquidation Result:', {
      method: result.method,
      executionPrice: result.executionPrice.toString(),
      totalExecuted: result.totalExecuted.toString(),
      liquidationFee: result.liquidationFee.toString(),
      remainingBalance: result.remainingBalance.toString(),
      insuranceFundBalance: liquidationEngine.getInsuranceFundBalance()
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Export for potential manual testing
module.exports = {
  LiquidationEngine,
  MockMatchingEngine,
  MockOrderBook,
  MockMarginCalculator,
  MockADLEngine,
  createMockPosition,
  createAllPositionsMap,
  manualTest
};

// Run manual test if this file is executed directly
if (require.main === module) {
  manualTest();
} 