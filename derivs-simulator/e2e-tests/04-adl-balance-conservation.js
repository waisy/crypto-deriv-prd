const WebSocket = require('ws');

class ADLBalanceConservationTest {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.results = {
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
        this.connected = true;
        resolve();
      });

      this.ws.on('error', (error) => {
        console.error('❌ Connection error:', error.message);
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

  check(description, condition, actual = null, expected = null) {
    if (condition) {
      console.log(`✅ ${description}`);
      this.results.passed++;
      this.results.details.push({ test: description, status: 'PASS' });
    } else {
      console.log(`❌ ${description}`);
      if (actual !== null && expected !== null) {
        console.log(`   Expected: ${expected}, Actual: ${actual}`);
      }
      this.results.failed++;
      this.results.details.push({ test: description, status: 'FAIL', actual, expected });
    }
  }

  async runTest() {
    try {
      console.log('\n🎯 ADL BALANCE CONSERVATION TEST');
      console.log('=================================');
      
      // Reset state
      console.log('\n1. Resetting exchange state...');
      await this.sendMessage({ type: 'reset_state' });
      
      // Set initial mark price to avoid immediate liquidation
      console.log('   Setting mark price to $45,000...');
      await this.sendMessage({
        type: 'update_mark_price',
        price: 45000
      });
      
      // Get initial state
      let stateResponse = await this.sendMessage({ type: 'get_state' });
      let state = stateResponse.state;
      const initialBobBalance = parseFloat(state.users.find(u => u.id === 'bob').totalBalance);
      const initialEveBalance = parseFloat(state.users.find(u => u.id === 'eve').totalBalance);
      const initialSystemTotal = initialBobBalance + initialEveBalance + parseFloat(state.users.find(u => u.id === 'alice').totalBalance);
      
      console.log(`   Initial balances: Bob=$${initialBobBalance}, Eve=$${initialEveBalance}`);
      console.log(`   Initial system total: $${initialSystemTotal}`);

      // Step 2: Create opposing positions (10x leverage for faster liquidation)
      console.log('\n2. Creating opposing positions...');
      await this.sendMessage({
        type: 'place_order',
        userId: 'bob',
        side: 'buy',
        size: 1,
        price: 45000,
        orderType: 'limit',
        leverage: 10
      });

      await this.sendMessage({
        type: 'place_order',
        userId: 'eve',
        side: 'sell',
        size: 1,
        price: 45000,
        orderType: 'limit',
        leverage: 10
      });

      stateResponse = await this.sendMessage({ type: 'get_state' });
      state = stateResponse.state;
      this.check('Positions created', state.positions.length === 2);
      this.check('Bob has long position', state.positions.find(p => p.userId === 'bob')?.side === 'long');
      this.check('Eve has short position', state.positions.find(p => p.userId === 'eve')?.side === 'short');

      // Step 3: Move price to trigger liquidation
      console.log('\n3. Moving price to trigger Eve\'s liquidation...');
      await this.sendMessage({
        type: 'update_mark_price',
        price: 50000
      });

      stateResponse = await this.sendMessage({ type: 'get_state' });
      state = stateResponse.state;
      
      // Check that Eve was liquidated
      const bobPosition = state.positions.find(p => p.userId === 'bob');
      const evePosition = state.positions.find(p => p.userId === 'eve');
      
      this.check('Eve position liquidated', evePosition === undefined);
      this.check('Bob position still exists', bobPosition !== undefined);
      this.check('Liquidation engine has position', state.liquidationPositions && state.liquidationPositions.length === 1);

      // Record balances before ADL
      const bobBalanceBeforeADL = parseFloat(state.users.find(u => u.id === 'bob').totalBalance);
      const eveBalanceBeforeADL = parseFloat(state.users.find(u => u.id === 'eve').totalBalance);
      const systemTotalBeforeADL = bobBalanceBeforeADL + eveBalanceBeforeADL + parseFloat(state.users.find(u => u.id === 'alice').totalBalance);
      
      console.log(`   Before ADL: Bob=$${bobBalanceBeforeADL}, Eve=$${eveBalanceBeforeADL}`);
      console.log(`   System total before ADL: $${systemTotalBeforeADL}`);

      // Step 4: Execute ADL
      console.log('\n4. Executing ADL...');
      await this.sendMessage({
        type: 'liquidation_step',
        method: 'adl'
      });

      // Get final state
      stateResponse = await this.sendMessage({ type: 'get_state' });
      state = stateResponse.state;
      
      const bobBalanceAfterADL = parseFloat(state.users.find(u => u.id === 'bob').totalBalance);
      const eveBalanceAfterADL = parseFloat(state.users.find(u => u.id === 'eve').totalBalance);
      const systemTotalAfterADL = bobBalanceAfterADL + eveBalanceAfterADL + parseFloat(state.users.find(u => u.id === 'alice').totalBalance);
      
      console.log(`   After ADL: Bob=$${bobBalanceAfterADL}, Eve=$${eveBalanceAfterADL}`);
      console.log(`   System total after ADL: $${systemTotalAfterADL}`);

      // Step 5: Critical ADL balance conservation checks
      console.log('\n5. ADL Balance Conservation Verification:');
      
      // Bob should NOT gain money during ADL (the key fix)
      const bobADLGain = bobBalanceAfterADL - bobBalanceBeforeADL;
      this.check(
        'Bob balance unchanged during ADL', 
        Math.abs(bobADLGain) < 0.01, 
        `$${bobADLGain}`, 
        '$0'
      );

      // Eve should not lose additional money during ADL
      const eveADLLoss = eveBalanceBeforeADL - eveBalanceAfterADL;
      this.check(
        'Eve balance unchanged during ADL', 
        Math.abs(eveADLLoss) < 0.01, 
        `$${eveADLLoss}`, 
        '$0'
      );

      // System total should be conserved
      const systemChange = systemTotalAfterADL - systemTotalBeforeADL;
      this.check(
        'System total conserved during ADL', 
        Math.abs(systemChange) < 0.01, 
        `$${systemChange}`, 
        '$0'
      );

      // All positions should be closed
      this.check('All user positions closed', state.positions.length === 0);
      this.check('All liquidation positions closed', !state.liquidationPositions || state.liquidationPositions.length === 0);

      // Step 6: Overall system conservation check
      console.log('\n6. Overall System Conservation:');
      const totalSystemChange = systemTotalAfterADL - initialSystemTotal;
      this.check(
        'Overall system balance conserved', 
        Math.abs(totalSystemChange) < 0.01, 
        `$${totalSystemChange}`, 
        '$0'
      );

      console.log('\n📊 DETAILED BALANCE ANALYSIS:');
      console.log(`   Bob: $${initialBobBalance} → $${bobBalanceAfterADL} (${bobBalanceAfterADL > initialBobBalance ? '+' : ''}${(bobBalanceAfterADL - initialBobBalance).toFixed(2)})`);
      console.log(`   Eve: $${initialEveBalance} → $${eveBalanceAfterADL} (${eveBalanceAfterADL > initialEveBalance ? '+' : ''}${(eveBalanceAfterADL - initialEveBalance).toFixed(2)})`);
      console.log(`   System: $${initialSystemTotal} → $${systemTotalAfterADL} (${systemTotalAfterADL > initialSystemTotal ? '+' : ''}${totalSystemChange.toFixed(2)})`);

    } catch (error) {
      console.error('❌ Test failed with error:', error.message);
      this.results.failed++;
    }
  }

  printResults() {
    console.log('\n' + '='.repeat(50));
    console.log('🎯 ADL BALANCE CONSERVATION TEST RESULTS');
    console.log('='.repeat(50));
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`📊 Success Rate: ${((this.results.passed / (this.results.passed + this.results.failed)) * 100).toFixed(1)}%`);
    
    if (this.results.failed > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.results.details.filter(d => d.status === 'FAIL').forEach(detail => {
        console.log(`   • ${detail.test}`);
        if (detail.actual && detail.expected) {
          console.log(`     Expected: ${detail.expected}, Actual: ${detail.actual}`);
        }
      });
    }

    const overallStatus = this.results.failed === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED';
    console.log(`\n${overallStatus}`);
    console.log('='.repeat(50));
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Run the test
async function runADLBalanceConservationTest() {
  const test = new ADLBalanceConservationTest();
  
  try {
    await test.connect();
    await test.runTest();
  } catch (error) {
    console.error('Test execution failed:', error.message);
  } finally {
    test.printResults();
    test.disconnect();
    process.exit(test.results.failed === 0 ? 0 : 1);
  }
}

// Auto-run if this file is executed directly
if (require.main === module) {
  runADLBalanceConservationTest();
}

module.exports = { ADLBalanceConservationTest }; 