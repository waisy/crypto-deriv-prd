# E2E Tests

End-to-end integration tests for the derivatives exchange simulator.

## Overview

These tests verify the complete system functionality by connecting to the WebSocket server and executing real trading scenarios. They test the entire flow from order placement to position creation, including balance conservation and zero-sum invariants.

## Prerequisites

- Server must be running on `localhost:3000`
- Start the server with: `npm run start:ts`

## Running Tests

### Single Test
```bash
npm run e2e
```
This runs the basic order/trade test.

### All E2E Tests  
```bash
npm run e2e:all
```
This runs all e2e test files in sequence.

### Combined Tests (Unit + E2E)
```bash
npm run test:all
```
This runs both Jest unit tests and e2e integration tests.

## Test Structure

Each e2e test follows this pattern:
1. **Connect** to WebSocket server
2. **Execute** trading scenario step by step
3. **Capture** system state at each step
4. **Verify** results with comprehensive assertions
5. **Report** detailed results

## Test Files

### 01-basic-order-trade.js
**Purpose**: Tests basic order matching and position creation

**Scenario**:
- Bob places a buy order (1 BTC @ $45,000)
- Eve places a matching sell order (1 BTC @ $45,000)
- Orders should match and create positions for both users

**Verifications**:
- ✅ Both orders execute successfully
- ✅ Both users get positions created (Bob: long, Eve: short)
- ✅ Position sizes are correct (1 BTC each)
- ✅ Balance conservation maintained
- ✅ Zero-sum invariants hold (position sizes and PnL balance)
- ✅ Margin correctly reserved for both users
- ✅ Order book empty after matching

**Expected Output**:
```
🧪 E2E TEST: Basic Order & Trade Functionality
✅ Bob's order placed successfully
✅ Eve's order placed successfully  
✅ Both users have positions created
✅ Balance conservation maintained
✅ Position sizes balance (zero-sum)
✅ PnL balances (zero-sum)
...
🎉 ALL TESTS PASSED!
```

## Test Features

### State Logging
Each test provides detailed logging of system state:
- User balances and margins
- Position details
- Order book status
- Insurance fund balance

### Comprehensive Assertions
Tests verify:
- **Functional**: Orders execute, positions created
- **Financial**: Balance conservation, margin calculations
- **Invariants**: Zero-sum properties maintained
- **Data Integrity**: Correct values and relationships

### Error Handling
- Clear error messages for failures
- Detailed expected vs actual value comparisons
- Graceful connection handling
- Proper cleanup on test completion

## Adding New Tests

1. Create new test file: `e2e-tests/02-your-test.js`
2. Follow the pattern from `01-basic-order-trade.js`
3. Implement your specific scenario
4. Add comprehensive assertions
5. Test will automatically run with `npm run e2e:all`

## Debugging

For debugging failed tests:
1. Check server logs for detailed execution traces
2. Review state logging output in test results
3. Verify server is running and accessible
4. Check WebSocket connection status

## Integration with CI/CD

These tests are designed to run in CI/CD pipelines:
- Exit with code 0 on success
- Exit with code 1 on failure
- Provide detailed success/failure reporting
- Support parallel execution (when tests are independent) 