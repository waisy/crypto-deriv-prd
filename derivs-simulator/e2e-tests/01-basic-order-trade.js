const WebSocket = require('ws');

class BasicOrderTradeTest {
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
    console.log('─'.repeat(50));
    
    // Users
    state.users.forEach(user => {
      console.log(`👤 ${user.name}:`);
      console.log(`   Balance: $${user.totalBalance} | Available: $${user.availableBalance}`);
      console.log(`   Used Margin: $${user.usedMargin} | Unrealized PnL: $${user.unrealizedPnL}`);
      console.log(`   Leverage: ${user.leverage}x | Equity: $${user.equity}`);
    });

    // Positions
    console.log(`\n📈 Positions (${state.positions.length}):`);
    state.positions.forEach(pos => {
      console.log(`   ${pos.userId}: ${pos.side} ${pos.size} BTC @ $${pos.avgEntryPrice}`);
      console.log(`     PnL: $${pos.unrealizedPnL} | Margin: $${pos.initialMargin}`);
    });

    // Order Book
    console.log(`\n📚 Order Book:`);
    console.log(`   Best Bid: $${state.orderBook.bestBid || 'None'}`);
    console.log(`   Best Ask: $${state.orderBook.bestAsk || 'None'}`);
    
    // Insurance Fund
    console.log(`\n💰 Insurance Fund: $${state.insuranceFund.balance}`);
    
    console.log('─'.repeat(50));
  }

  calculateSystemTotal(state) {
    let userTotal = 0;
    state.users.forEach(user => {
      userTotal += parseFloat(user.totalBalance);
    });
    
    const insuranceFund = parseFloat(state.insuranceFund.balance);
    return userTotal + insuranceFund;
  }

  verifyZeroSum(state) {
    let longSize = 0, shortSize = 0, longPnL = 0, shortPnL = 0;
    
    state.positions.forEach(pos => {
      if (pos.side === 'long') {
        longSize += parseFloat(pos.size);
        longPnL += parseFloat(pos.unrealizedPnL);
      } else {
        shortSize += parseFloat(pos.size);
        shortPnL += parseFloat(pos.unrealizedPnL);
      }
    });

    const sizeDiff = Math.abs(longSize - shortSize);
    const pnlTotal = longPnL + shortPnL;

    console.log(`\n🔍 Zero-Sum Verification:`);
    console.log(`   Long Size: ${longSize} | Short Size: ${shortSize} | Diff: ${sizeDiff}`);
    console.log(`   Long PnL: $${longPnL} | Short PnL: $${shortPnL} | Total: $${pnlTotal}`);

    return { sizeDiff, pnlTotal, longSize, shortSize, longPnL, shortPnL };
  }

  async runTest() {
    try {
      console.log('\n🧪 E2E TEST: Basic Order & Trade Functionality');
      console.log('='.repeat(60));

      // Step 0: Connect and reset state to ensure clean test environment
      await this.connect();
      console.log('🔄 Resetting exchange state for clean test...');
      await this.sendMessage({ type: 'reset_state' });

      // Step 1: Get initial state after reset
      const initialState = await this.sendMessage({ type: 'get_state' });
      this.logState('Initial State', initialState.state);
      
      const initialTotal = this.calculateSystemTotal(initialState.state);
      console.log(`\n💰 Initial System Total: $${initialTotal}`);

      // Step 2: Place Bob's buy order
      console.log('\n📝 Step 1: Placing Bob\'s buy order (1 BTC @ $50,000)...');
      
      const bobOrder = await this.sendMessage({
        type: 'place_order',
        userId: 'bob',
        side: 'buy',
        size: 1,
        price: 50000,
        orderType: 'limit',
        leverage: 10
      });

      this.assert(bobOrder.success, 'Bob\'s order placed successfully', bobOrder.success, true);
      
      if (bobOrder.success) {
        console.log(`   Order ID: ${bobOrder.order.id}`);
        console.log(`   Status: ${bobOrder.order.status}`);
      }

      // Get state after Bob's order
      const afterBobState = await this.sendMessage({ type: 'get_state' });
      this.logState('After Bob\'s Order', afterBobState.state);

      // Step 3: Place Eve's sell order
      console.log('\n📝 Step 2: Placing Eve\'s sell order (1 BTC @ $50,000)...');
      
      const eveOrder = await this.sendMessage({
        type: 'place_order',
        userId: 'eve',
        side: 'sell',
        size: 1,
        price: 50000,
        orderType: 'limit',
        leverage: 10
      });

      this.assert(eveOrder.success, 'Eve\'s order placed successfully', eveOrder.success, true);

      if (eveOrder.success) {
        console.log(`   Order ID: ${eveOrder.order.id}`);
        console.log(`   Status: ${eveOrder.order.status}`);
        console.log(`   Matches: ${eveOrder.matches ? eveOrder.matches.length : 0}`);
      }

      // Step 4: Get final state and verify results
      const finalState = await this.sendMessage({ type: 'get_state' });
      this.logState('Final State', finalState.state);

      const finalTotal = this.calculateSystemTotal(finalState.state);
      console.log(`\n💰 Final System Total: $${finalTotal}`);

      // Verification Tests
      console.log('\n🔍 VERIFICATION TESTS:');
      console.log('='.repeat(40));

      // Test 1: Balance Conservation
      const balanceDiff = Math.abs(finalTotal - initialTotal);
      this.assert(
        balanceDiff < 1, 
        'Balance conservation maintained',
        `$${balanceDiff}`,
        '< $1'
      );

      // Test 2: Position Creation
      this.assert(
        finalState.state.positions.length === 2,
        'Both users have positions created',
        finalState.state.positions.length,
        2
      );

      // Test 3: Bob has long position
      const bobPosition = finalState.state.positions.find(p => p.userId === 'bob');
      this.assert(
        bobPosition && bobPosition.side === 'long',
        'Bob has long position',
        bobPosition ? bobPosition.side : 'none',
        'long'
      );

      // Test 4: Eve has short position  
      const evePosition = finalState.state.positions.find(p => p.userId === 'eve');
      this.assert(
        evePosition && evePosition.side === 'short',
        'Eve has short position',
        evePosition ? evePosition.side : 'none',
        'short'
      );

      // Test 5: Position sizes are correct
      if (bobPosition) {
        this.assert(
          parseFloat(bobPosition.size) === 1,
          'Bob\'s position size is correct',
          parseFloat(bobPosition.size),
          1
        );
      }

      if (evePosition) {
        this.assert(
          parseFloat(evePosition.size) === 1,
          'Eve\'s position size is correct',
          parseFloat(evePosition.size),
          1
        );
      }

      // Test 6: Zero-sum verification
      const zeroSum = this.verifyZeroSum(finalState.state);
      this.assert(
        zeroSum.sizeDiff < 0.001,
        'Position sizes balance (zero-sum)',
        zeroSum.sizeDiff,
        '< 0.001'
      );

      this.assert(
        Math.abs(zeroSum.pnlTotal) < 1,
        'PnL balances (zero-sum)',
        `$${zeroSum.pnlTotal}`,
        '< $1'
      );

      // Test 7: Margin usage
      const bobUser = finalState.state.users.find(u => u.id === 'bob');
      const eveUser = finalState.state.users.find(u => u.id === 'eve');

      if (bobUser) {
        this.assert(
          parseFloat(bobUser.usedMargin) > 0,
          'Bob has margin reserved',
          `$${bobUser.usedMargin}`,
          '> $0'
        );
      }

      if (eveUser) {
        this.assert(
          parseFloat(eveUser.usedMargin) > 0,
          'Eve has margin reserved', 
          `$${eveUser.usedMargin}`,
          '> $0'
        );
      }

      // Test 8: Order book should be empty (orders matched)
      this.assert(
        finalState.state.orderBook.totalOrders === 0,
        'Order book empty after matching',
        finalState.state.orderBook.totalOrders,
        0
      );

      // Final Results
      console.log('\n📊 TEST RESULTS:');
      console.log('='.repeat(40));
      console.log(`✅ Passed: ${this.testResults.passed}`);
      console.log(`❌ Failed: ${this.testResults.failed}`);
      console.log(`📈 Success Rate: ${((this.testResults.passed / (this.testResults.passed + this.testResults.failed)) * 100).toFixed(1)}%`);

      if (this.testResults.failed === 0) {
        console.log('\n🎉 ALL TESTS PASSED! Basic order/trade functionality is working correctly.');
      } else {
        console.log('\n⚠️  Some tests failed. See details above.');
        process.exit(1);
      }

    } catch (error) {
      console.error('❌ Test execution failed:', error);
      process.exit(1);
    } finally {
      if (this.ws) {
        this.ws.close();
      }
    }
  }
}

// Run the test
const test = new BasicOrderTradeTest();
test.runTest(); 