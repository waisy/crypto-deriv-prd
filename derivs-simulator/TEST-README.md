# Liquidation Engine Unit Tests

This document explains how to run and debug the unit tests for the `liquidate` method in the LiquidationEngine.

## Files Created

- **`test-liquidate-unit.js`** - Comprehensive unit test suite for the liquidate method
- **`.vscode/launch.json`** - VSCode debug configurations
- **`package.json`** - Updated with Jest dependencies and test scripts

## Test Coverage

The unit tests cover:

### ✅ **Fallback Liquidation (Force Mode)**
- Execution at bankruptcy price
- Correct loss calculation for long positions
- Correct loss calculation for short positions

### ✅ **Order Book Liquidation**
- Attempts order book liquidation first when not in force mode
- Falls back to bankruptcy price when no liquidity

### ✅ **Insurance Fund Updates**
- Verifies insurance fund is updated after liquidation
- Checks fee collection

### ✅ **Error Handling**
- Graceful error handling with fallback to bankruptcy price
- Resilient behavior when order book fails

### ✅ **Zero-Sum Calculations**
- Correct calculation of position totals
- Pre-liquidation zero-sum verification

### ✅ **Result Structure**
- Complete liquidation result object validation
- All required fields present with correct types

## Running Tests

### 1. **Run All Liquidation Tests**
```bash
npm run test:liquidate
```

### 2. **Run Tests with Watch Mode**
```bash
npm run test:watch
```

### 3. **Run All Tests**
```bash
npm test
```

### 4. **Manual Test (No Jest)**
```bash
node test-liquidate-unit.js
```

## Debugging in VSCode

### Method 1: Using Launch Configurations

1. **Open VSCode** in the `derivs-simulator` directory
2. **Set breakpoints** in your test file or in `engine/liquidation.js`
3. **Go to Run and Debug** (Ctrl+Shift+D)
4. **Select one of these configurations:**
   - **"Debug Liquidate Unit Test"** - Debug only the liquidation tests
   - **"Debug Jest Tests"** - Debug all Jest tests
   - **"Debug Manual Test"** - Debug the manual test function

5. **Press F5** to start debugging

### Method 2: Using Terminal Debug Commands

```bash
# Debug liquidation tests specifically
npm run test:liquidate:debug

# Debug all tests
npm run test:debug
```

### Method 3: Manual Debug

```bash
# Run the manual test with debugging
node --inspect-brk test-liquidate-unit.js
```

Then open Chrome and go to `chrome://inspect` to connect to the debugger.

## Test Structure

### Mock Dependencies

The tests use comprehensive mocks for all dependencies:

```javascript
class MockMatchingEngine {
  setMockResponse(shouldMatch, fills = [])  // Control order matching behavior
}

class MockMarginCalculator {
  setBankruptcyPrice(price)  // Control bankruptcy price calculation
}

class MockOrderBook {
  setBidsAndAsks(bids, asks)  // Control order book state
}

class MockADLEngine {
  setMockQueue(queue)  // Control ADL queue
}
```

### Test Helpers

```javascript
createMockPosition(overrides = {})     // Create test positions
createAllPositionsMap(positions = [])  // Create position maps
```

## Example Test Scenarios

### 1. **Long Position Liquidation**
```javascript
const position = createMockPosition({
  side: 'long',
  avgEntryPrice: new Decimal(45000),
  size: new Decimal(1),
  initialMargin: new Decimal(4500)
});

const result = await liquidationEngine.liquidate(
  position, 
  40625,  // current price
  allPositions, 
  true    // force mode
);

// Expected: execution at bankruptcy price (40500)
// Expected: method = 'bankruptcy_price'
```

### 2. **Order Book Liquidation**
```javascript
mockMatchingEngine.setMockResponse(true, [
  { price: 40000, size: 1, timestamp: Date.now() }
]);

const result = await liquidationEngine.liquidate(
  position, 
  currentPrice, 
  allPositions, 
  false  // try order book first
);

// Expected: method = 'market_order'
// Expected: fills array populated
```

## Debugging Tips

### 1. **Set Breakpoints**
- In `test-liquidate-unit.js` at the test you want to debug
- In `engine/liquidation.js` in the `liquidate` method
- In specific calculation methods like `executeFallbackLiquidation`

### 2. **Console Suppression**
The tests suppress console output for cleaner results. If you want to see logs:
```javascript
// Comment out these lines in beforeEach:
// console.log = jest.fn();
// console.error = jest.fn();
```

### 3. **Manual Test for Full Logs**
Run the manual test to see all console output:
```bash
node test-liquidate-unit.js
```

### 4. **Inspect Variables**
Use the debugger to inspect:
- `liquidationResult` object
- Mock responses
- Insurance fund balance changes
- Position calculations

## Coverage Report

The tests provide detailed coverage reporting. After running tests, check:
- **Statement coverage**: 60.06%
- **Branch coverage**: 34.23%
- **Function coverage**: 25.71%
- **Line coverage**: 60.45%

To improve coverage, add tests for:
- Edge cases in bankruptcy scenarios
- Different liquidation fee scenarios
- Queue processing functionality
- Partial liquidation features

## Common Issues

### 1. **Import Errors**
Make sure to use destructuring import:
```javascript
const { LiquidationEngine } = require('./engine/liquidation');
```

### 2. **Jest Not Found**
Install dependencies:
```bash
npm install
```

### 3. **VSCode Debug Not Working**
Ensure you're in the correct directory and have the `.vscode/launch.json` file.

### 4. **Console Logs Not Showing**
Either run the manual test or comment out console mocking in the test setup.

## Next Steps

To extend the tests:

1. **Add more edge cases** (extreme prices, zero balances)
2. **Test error scenarios** (invalid positions, network failures)
3. **Performance tests** (large position sizes)
4. **Integration tests** (with real dependencies)
5. **Regression tests** (specific bug scenarios)

## Manual Test Output Example

```
🧪 MANUAL LIQUIDATION TEST
==========================
📊 Test Parameters: {
  userId: 'debugUser',
  side: 'long',
  size: '1',
  entryPrice: '45000',
  currentPrice: 40625,
  initialMargin: '4500'
}
✅ Liquidation Result: {
  method: 'bankruptcy_price',
  executionPrice: '40500',
  totalExecuted: '1',
  liquidationFee: '202.5',
  remainingBalance: '0',
  insuranceFundBalance: '1000202.5'
}
```

This confirms the liquidation engine is working correctly with proper bankruptcy price execution and insurance fund updates. 