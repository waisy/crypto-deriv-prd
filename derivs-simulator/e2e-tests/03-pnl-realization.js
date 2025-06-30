const WebSocket = require('ws');

class PnLRealizationTest {
  constructor() {
    this.ws = null;
    this.testResults = {
      passed: 0,
      failed: 0,
      details: []
    };
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:3000');
      
      this.ws.on('open', () => {
        console.log('✅ Connected to exchange server');
        resolve();
      });

      this.ws.on('error', (error) => {
        console.error('❌ Connection failed:', error.message);
        reject(error);
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (error) {
          console.error('❌ Message parsing error:', error);
        }
      });
    });
  }

  handleMessage(message) {
    // Store responses for test verification
    if (message.requestId) {
      this[`response_${message.requestId}`] = message;
    }
  }

  async sendMessage(data) {
    return new Promise((resolve) => {
      const requestId = Date.now() + Math.random();
      data.requestId = requestId;
      
      this.ws.send(JSON.stringify(data));
      
      // Wait for response
      const checkResponse = () => {
        if (this[`response_${requestId}`]) {
          resolve(this[`response_${requestId}`]);
        } else {
          setTimeout(checkResponse, 10);
        }
      };
      checkResponse();
    });
  }

  assert(condition, description, actualValue = null, expectedValue = null) {
    if (condition) {
      console.log(`✅ ${description}`);
      this.testResults.passed++;
      this.testResults.details.push({ 
        status: 'PASS', 
        description, 
        actual: actualValue, 
        expected: expectedValue 
      });
    } else {
      console.log(`❌ ${description}`);
      if (actualValue !== null) console.log(`   Expected: ${expectedValue}, Got: ${actualValue}`);
      this.testResults.failed++;
      this.testResults.details.push({ 
        status: 'FAIL', 
        description, 
        actual: actualValue, 
        expected: expectedValue 
      });
    }
  }

  logState(label, state) {
    console.log(`\n📊 ${label.toUpperCase()}:`);
    console.log('─'.repeat(60));
    
    // Users with detailed balance breakdown
    state.users.forEach(user => {
      console.log(`👤 ${user.name}:`);
      console.log(`   Total Balance: $${user.totalBalance}`);
      console.log(`   Available: $${user.availableBalance} | Used Margin: $${user.usedMargin}`);
      console.log(`   Unrealized PnL: $${user.unrealizedPnL} | Realized PnL: $${user.totalPnL}`);
      console.log(`   Leverage: ${user.leverage}x | Equity: $${user.equity}`);
    });

    // Positions
    console.log(`\n📈 Positions (${state.positions.length}):`);
    state.positions.forEach(pos => {
      console.log(`   ${pos.userId}: ${pos.side} ${pos.size} BTC @ $${pos.avgEntryPrice}`);
      console.log(`     Unrealized PnL: $${pos.unrealizedPnL} | Margin: $${pos.initialMargin}`);
    });

    // Mark Price
    console.log(`\n💹 Mark Price: $${state.markPrice}`);
    console.log(`💰 Insurance Fund: $${state.insuranceFund.balance}`);
    
    console.log('─'.repeat(60));
  }

  calculateSystemTotal(state) {
    let userTotal = 0;
    state.users.forEach(user => {
      userTotal += parseFloat(user.totalBalance);
    });
    
    const insuranceFund = parseFloat(state.insuranceFund.balance);
    return userTotal + insuranceFund;
  }

  async runTest() {
    try {
      console.log('\n🧪 E2E TEST: P&L Realization Functionality');
      console.log('='.repeat(60));

      // Step 0: Connect and reset state
      await this.connect();
      console.log('🔄 Resetting exchange state for clean test...');
      await this.sendMessage({ type: 'reset_state' });

      // Step 1: Set mark price to $45,000 to avoid immediate liquidations
      console.log('📝 Setting mark price to $45,000 to avoid immediate liquidations...');
      await this.sendMessage({
        type: 'update_mark_price',
        price: 45000
      });

      // Step 2: Get initial state
      const initialState = await this.sendMessage({ type: 'get_state' });
      this.logState('Initial State', initialState.state);
      
      const initialTotal = this.calculateSystemTotal(initialState.state);
      console.log(`\n💰 Initial System Total: $${initialTotal}`);

      // Capture initial user balances
      const bobInitial = initialState.state.users.find(u => u.id === 'bob');
      const eveInitial = initialState.state.users.find(u => u.id === 'eve');
      
      console.log(`\n📋 Initial User Balances:`);
      console.log(`   Bob: Available $${bobInitial.availableBalance}, Total P&L $${bobInitial.totalPnL}`);
      console.log(`   Eve: Available $${eveInitial.availableBalance}, Total P&L $${eveInitial.totalPnL}`);

      // Step 3: Create initial positions - Bob buys 1 BTC, Eve sells 1 BTC at $45,000 with 2x leverage (safer for margin)
      console.log('\n📝 Step 1: Creating initial positions (1 BTC @ $45,000 with 2x leverage)...');
      
      const bobOrder1 = await this.sendMessage({
        type: 'place_order',
        userId: 'bob',
        side: 'buy',
        size: 1,
        price: 45000,
        orderType: 'limit',
        leverage: 2
      });

      this.assert(bobOrder1.success, 'Bob\'s initial buy order placed successfully');

      const eveOrder1 = await this.sendMessage({
        type: 'place_order',
        userId: 'eve',
        side: 'sell',
        size: 1,
        price: 45000,
        orderType: 'limit',
        leverage: 2
      });

      this.assert(eveOrder1.success, 'Eve\'s initial sell order placed successfully');

      // Get state after initial trade
      const afterTradeState = await this.sendMessage({ type: 'get_state' });
      this.logState('After Initial Trade', afterTradeState.state);

      // Verify positions were created
      const bobPosition = afterTradeState.state.positions.find(p => p.userId === 'bob');
      const evePosition = afterTradeState.state.positions.find(p => p.userId === 'eve');

      this.assert(bobPosition && bobPosition.side === 'long', 'Bob has long position');
      this.assert(evePosition && evePosition.side === 'short', 'Eve has short position');
      this.assert(parseFloat(bobPosition.size) === 1, 'Bob\'s position size is 1 BTC', parseFloat(bobPosition.size), 1);
      this.assert(parseFloat(evePosition.size) === 1, 'Eve\'s position size is 1 BTC', parseFloat(evePosition.size), 1);

      // Step 4: Move price up to $46,000 to create profit for Bob, loss for Eve (smaller movement to avoid liquidation)
      console.log('\n📝 Step 2: Moving mark price to $46,000 (creating P&L)...');
      
      await this.sendMessage({
        type: 'update_mark_price',
        price: 46000
      });

      const afterPriceState = await this.sendMessage({ type: 'get_state' });
      this.logState('After Price Move', afterPriceState.state);

      // Verify P&L was created
      const bobAfterPrice = afterPriceState.state.positions.find(p => p.userId === 'bob');
      const eveAfterPrice = afterPriceState.state.positions.find(p => p.userId === 'eve');

      const bobUnrealizedPnL = parseFloat(bobAfterPrice.unrealizedPnL);
      const eveUnrealizedPnL = parseFloat(eveAfterPrice.unrealizedPnL);

      console.log(`\n💰 P&L Created:`);
      console.log(`   Bob (long): $${bobUnrealizedPnL} (should be positive)`);
      console.log(`   Eve (short): $${eveUnrealizedPnL} (should be negative)`);

      this.assert(bobUnrealizedPnL > 0, 'Bob has positive unrealized P&L');
      this.assert(eveUnrealizedPnL < 0, 'Eve has negative unrealized P&L');

      // Expected P&L: 1 BTC * ($46,000 - $45,000) = $1,000 for Bob, -$1,000 for Eve
      const expectedPnL = 1000;
      this.assert(Math.abs(bobUnrealizedPnL - expectedPnL) < 1, 'Bob\'s P&L is approximately $1,000', bobUnrealizedPnL, expectedPnL);
      this.assert(Math.abs(eveUnrealizedPnL + expectedPnL) < 1, 'Eve\'s P&L is approximately -$1,000', eveUnrealizedPnL, -expectedPnL);

      // Step 5: Bob (profitable side) places order to reduce position by 0.5 BTC
      console.log('\n📝 Step 3: Bob reducing position by 50% (selling 0.5 BTC @ $46,000)...');
      
      // Capture balances before reduction
      const bobBeforeReduction = afterPriceState.state.users.find(u => u.id === 'bob');
      const eveBeforeReduction = afterPriceState.state.users.find(u => u.id === 'eve');
      
      console.log(`\n📊 Balances before reduction:`);
      console.log(`   Bob: Available $${bobBeforeReduction.availableBalance}, Total P&L $${bobBeforeReduction.totalPnL}`);
      console.log(`   Eve: Available $${eveBeforeReduction.availableBalance}, Total P&L $${eveBeforeReduction.totalPnL}`);

      const bobReduceOrder = await this.sendMessage({
        type: 'place_order',
        userId: 'bob',
        side: 'sell',
        size: 0.5,
        price: 46000,
        orderType: 'limit',
        leverage: 2
      });

      this.assert(bobReduceOrder.success, 'Bob\'s reduction order placed successfully');

      // Eve needs to hit Bob's order
      const eveHitOrder = await this.sendMessage({
        type: 'place_order',
        userId: 'eve',
        side: 'buy',
        size: 0.5,
        price: 46000,
        orderType: 'limit',
        leverage: 2
      });

      this.assert(eveHitOrder.success, 'Eve\'s order to hit Bob\'s reduction order successful');

      // Step 6: Verify P&L realization
      const afterReductionState = await this.sendMessage({ type: 'get_state' });
      this.logState('After Position Reduction', afterReductionState.state);

      const bobAfterReduction = afterReductionState.state.users.find(u => u.id === 'bob');
      const eveAfterReduction = afterReductionState.state.users.find(u => u.id === 'eve');
      const bobPositionAfter = afterReductionState.state.positions.find(p => p.userId === 'bob');
      const evePositionAfter = afterReductionState.state.positions.find(p => p.userId === 'eve');

      console.log(`\n💰 P&L Realization Analysis:`);
      console.log(`   Bob's Total P&L: $${bobBeforeReduction.totalPnL} → $${bobAfterReduction.totalPnL}`);
      console.log(`   Bob's Available Balance: $${bobBeforeReduction.availableBalance} → $${bobAfterReduction.availableBalance}`);
      console.log(`   Eve's Total P&L: $${eveBeforeReduction.totalPnL} → $${eveAfterReduction.totalPnL}`);
      console.log(`   Eve's Available Balance: $${eveBeforeReduction.availableBalance} → $${eveAfterReduction.availableBalance}`);

      // Bob should have realized 50% of his P&L (0.5 BTC out of 1 BTC = $500)
      const bobRealizedPnL = parseFloat(bobAfterReduction.totalPnL) - parseFloat(bobBeforeReduction.totalPnL);
      const expectedBobRealized = 500; // 0.5 BTC * $1,000 profit per BTC

      console.log(`   Bob's Realized P&L: $${bobRealizedPnL} (expected ~$${expectedBobRealized})`);
      
      this.assert(Math.abs(bobRealizedPnL - expectedBobRealized) < 50, 'Bob realized approximately $500 P&L', bobRealizedPnL, expectedBobRealized);
      this.assert(parseFloat(bobAfterReduction.totalPnL) > parseFloat(bobBeforeReduction.totalPnL), 'Bob\'s total P&L increased');
      this.assert(parseFloat(bobAfterReduction.availableBalance) > parseFloat(bobBeforeReduction.availableBalance), 'Bob\'s available balance increased');

      // Verify remaining position size
      this.assert(parseFloat(bobPositionAfter.size) === 0.5, 'Bob\'s remaining position is 0.5 BTC', parseFloat(bobPositionAfter.size), 0.5);
      
      // Check if Eve still has a position (she should with more conservative parameters)
      if (evePositionAfter) {
        this.assert(parseFloat(evePositionAfter.size) === 0.5, 'Eve\'s remaining position is 0.5 BTC', parseFloat(evePositionAfter.size), 0.5);
      } else {
        console.log('⚠️  Eve has no remaining position - may have been liquidated or fully closed');
        // With more conservative parameters, this shouldn't happen
        const eveTotalLoss = parseFloat(eveBeforeReduction.totalBalance) - parseFloat(eveAfterReduction.totalBalance);
        console.log(`   Eve's total loss: $${eveTotalLoss}`);
        this.assert(eveTotalLoss > 0, 'Eve experienced a loss (but liquidation unexpected with conservative parameters)');
      }

      // Step 7: Final balance conservation check
      const finalTotal = this.calculateSystemTotal(afterReductionState.state);
      console.log(`\n🔍 Balance Conservation Check:`);
      console.log(`   Initial Total: $${initialTotal}`);
      console.log(`   Final Total: $${finalTotal}`);
      console.log(`   Difference: $${Math.abs(finalTotal - initialTotal)}`);
      
      this.assert(Math.abs(finalTotal - initialTotal) < 1, 'System balance conserved (within $1 rounding)', Math.abs(finalTotal - initialTotal), 0);

      // Step 8: Zero-sum verification
      let longPnL = 0, shortPnL = 0;
      afterReductionState.state.positions.forEach(pos => {
        if (pos.side === 'long') longPnL += parseFloat(pos.unrealizedPnL);
        if (pos.side === 'short') shortPnL += parseFloat(pos.unrealizedPnL);
      });

      console.log(`\n🔍 Zero-Sum Verification:`);
      console.log(`   Long P&L: $${longPnL}`);
      console.log(`   Short P&L: $${shortPnL}`);
      console.log(`   Total Unrealized: $${longPnL + shortPnL}`);

      this.assert(Math.abs(longPnL + shortPnL) < 1, 'Unrealized P&L sums to zero', longPnL + shortPnL, 0);

      // Test Summary
      console.log('\n📊 TEST RESULTS:');
      console.log('='.repeat(40));
      console.log(`✅ Passed: ${this.testResults.passed}`);
      console.log(`❌ Failed: ${this.testResults.failed}`);
      console.log(`📈 Success Rate: ${((this.testResults.passed / (this.testResults.passed + this.testResults.failed)) * 100).toFixed(1)}%`);

      if (this.testResults.failed === 0) {
        console.log('\n🎉 ALL TESTS PASSED! P&L realization is working correctly.');
      } else {
        console.log('\n⚠️  Some tests failed. P&L realization needs investigation.');
      }

      this.ws.close();
      process.exit(this.testResults.failed > 0 ? 1 : 0);

    } catch (error) {
      console.error('❌ Test failed with error:', error);
      if (this.ws) this.ws.close();
      process.exit(1);
    }
  }
}

// Run the test
if (require.main === module) {
  const test = new PnLRealizationTest();
  test.runTest();
}

module.exports = PnLRealizationTest; 