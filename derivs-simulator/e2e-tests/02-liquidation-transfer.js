const WebSocket = require('ws');

class LiquidationTransferTest {
  constructor() {
    this.ws = null;
    this.messageId = 0;
    this.pendingMessages = new Map();
    this.testResults = { passed: 0, failed: 0 };
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:3000');
      
      this.ws.on('open', () => {
        console.log('✅ Connected to exchange server');
        resolve();
      });
      
      this.ws.on('message', (data) => {
        this.handleMessage(JSON.parse(data));
      });
      
      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        reject(error);
      });
    });
  }

  handleMessage(message) {
    const { requestId, ...response } = message;
    if (requestId && this.pendingMessages.has(requestId)) {
      const resolve = this.pendingMessages.get(requestId);
      this.pendingMessages.delete(requestId);
      resolve(response);
    }
  }

  async sendMessage(data) {
    const requestId = Date.now() + Math.random();
    const message = { ...data, requestId };
    
    return new Promise((resolve, reject) => {
      this.pendingMessages.set(requestId, resolve);
      
      this.ws.send(JSON.stringify(message));
      
      const checkResponse = () => {
        if (!this.pendingMessages.has(requestId)) {
          return; // Already resolved
        }
        setTimeout(checkResponse, 100);
      };
      
      setTimeout(checkResponse, 100);
      setTimeout(() => reject(new Error('Message timeout')), 10000);
    });
  }

  assert(condition, description, actualValue = null, expectedValue = null) {
    if (condition) {
      console.log(`✅ ${description}`);
      this.testResults.passed++;
    } else {
      console.log(`❌ ${description}`);
      if (actualValue !== null && expectedValue !== null) {
        console.log(`   Expected: ${expectedValue}, Got: ${actualValue}`);
      }
      this.testResults.failed++;
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
    console.log(`\n📈 User Positions (${state.positions.length}):`);
    if (state.positions.length === 0) {
      console.log('   (none)');
    } else {
      state.positions.forEach(pos => {
        console.log(`   ${pos.userId}: ${pos.side} ${pos.size} BTC @ $${pos.avgEntryPrice}`);
        console.log(`     PnL: $${pos.unrealizedPnL} | Margin: $${pos.initialMargin}`);
        console.log(`     Liquidation Price: $${pos.liquidationPrice}`);
      });
    }
    
    // Liquidation Engine Positions
    console.log(`\n🔥 Liquidation Engine Positions (${state.positionLiquidationEngine.positions.length}):`);
    if (state.positionLiquidationEngine.positions.length === 0) {
      console.log('   (none)');
    } else {
      state.positionLiquidationEngine.positions.forEach(pos => {
        console.log(`   ID: ${pos.id} | Original User: ${pos.originalUserId}`);
        console.log(`   ${pos.side} ${pos.size} BTC @ $${pos.avgEntryPrice}`);
        console.log(`   PnL: $${pos.unrealizedPnL} | Status: ${pos.status}`);
      });
    }
    
    // Order Book
    console.log(`\n📚 Order Book:`);
    console.log(`   Best Bid: $${state.orderBook.bestBid || 'None'}`);
    console.log(`   Best Ask: $${state.orderBook.bestAsk || 'None'}`);
    
    // Mark Price
    console.log(`\n💹 Mark Price: $${state.markPrice}`);
    
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
    let longSize = 0, shortSize = 0;
    let longPnL = 0, shortPnL = 0;
    
    // User positions
    state.positions.forEach(pos => {
      const size = parseFloat(pos.size);
      const pnl = parseFloat(pos.unrealizedPnL);
      
      if (pos.side === 'long') {
        longSize += size;
        longPnL += pnl;
      } else {
        shortSize += size;
        shortPnL += pnl;
      }
    });
    
    // Liquidation engine positions
    state.positionLiquidationEngine.positions.forEach(pos => {
      const size = parseFloat(pos.size);
      const pnl = parseFloat(pos.unrealizedPnL);
      
      if (pos.side === 'long') {
        longSize += size;
        longPnL += pnl;
      } else {
        shortSize += size;
        shortPnL += pnl;
      }
    });
    
    const sizeDiff = Math.abs(longSize - shortSize);
    const pnlTotal = longPnL + shortPnL;
    
    console.log(`\n🔍 Zero-Sum Verification:`);
    console.log(`   Long Size: ${longSize} | Short Size: ${shortSize} | Diff: ${sizeDiff}`);
    console.log(`   Long PnL: $${longPnL} | Short PnL: $${shortPnL} | Total: $${pnlTotal}`);
    
    return { sizeDiff, pnlTotal, longSize, shortSize, longPnL, shortPnL };
  }

  verifyPositionTransferAccuracy(lePosition, preLiquidationData, testName) {
    console.log(`\n   ${testName}: Position Transfer Accuracy Analysis:`);
    
    // Extract LE position values
    const lePnL = parseFloat(lePosition.unrealizedPnL);
    const leEntryPrice = parseFloat(lePosition.avgEntryPrice || lePosition.entryPrice);
    const leSize = parseFloat(lePosition.size);
    const leSide = lePosition.side;
    
    // Log comprehensive comparison
    console.log(`      Original Position: ${preLiquidationData.eveSize} BTC ${preLiquidationData.eveSide} @ $${preLiquidationData.eveEntryPrice}`);
    console.log(`      LE Position:       ${leSize} BTC ${leSide} @ $${leEntryPrice}`);
    console.log(`      Mark Price:        $${preLiquidationData.markPrice}`);
    console.log(`      Original PnL:      $${preLiquidationData.evePnL}`);
    console.log(`      LE PnL:            $${lePnL}`);
    
    // Calculate expected PnL manually for verification
    const expectedLEPnL = (preLiquidationData.markPrice - preLiquidationData.eveEntryPrice) * preLiquidationData.eveSize * (preLiquidationData.eveSide === 'short' ? -1 : 1);
    console.log(`      Expected LE PnL:   $${expectedLEPnL} (manual calculation)`);
    
    // Individual assertions with better messaging
    this.assert(
      leSide === preLiquidationData.eveSide,
      `${testName}a: Position side preserved`,
      leSide,
      preLiquidationData.eveSide
    );
    
    this.assert(
      Math.abs(leSize - preLiquidationData.eveSize) < 0.001,
      `${testName}b: Position size preserved`,
      leSize,
      preLiquidationData.eveSize
    );
    
    this.assert(
      Math.abs(leEntryPrice - preLiquidationData.eveEntryPrice) < 0.01,
      `${testName}c: Entry price preserved`,
      `$${leEntryPrice}`,
      `$${preLiquidationData.eveEntryPrice}`
    );
    
    // Most critical test: PnL consistency
    const pnlDiff = Math.abs(lePnL - preLiquidationData.evePnL);
    const pnlExpectedDiff = Math.abs(lePnL - expectedLEPnL);
    
    console.log(`      PnL Differences:`);
    console.log(`        |LE PnL - Original PnL|: $${pnlDiff}`);
    console.log(`        |LE PnL - Expected PnL|: $${pnlExpectedDiff}`);
    
    this.assert(
      pnlDiff < 10, // Allow for small rounding differences
      `${testName}d: PnL consistency maintained`,
      `$${pnlDiff} difference`,
      '< $10 tolerance'
    );
    
    this.assert(
      pnlExpectedDiff < 10, // Verify against manual calculation
      `${testName}e: PnL calculation accuracy`,
      `$${pnlExpectedDiff} difference`,
      '< $10 tolerance'
    );
  }

  async resetInsuranceFund() {
    console.log('\n💀 Resetting insurance fund to zero...');
    
    try {
      // Drain the insurance fund using manual adjustment
      const result = await this.sendMessage({
        type: 'manual_adjustment',
        amount: -1000000, // Drain $1M
        description: 'E2E Test: Reset insurance fund to zero'
      });
      
      if (result.success) {
        console.log(`✅ Insurance fund drained to: $${result.newBalance}`);
        return true;
      } else {
        console.log(`❌ Failed to drain insurance fund: ${result.error}`);
        return false;
      }
    } catch (error) {
      console.log(`❌ Error draining insurance fund: ${error.message}`);
      return false;
    }
  }

  async runTest() {
    try {
      console.log('\n🧪 E2E TEST: Liquidation & Position Transfer');
      console.log('='.repeat(60));

      // Step 0: Connect and reset state
      await this.connect();
      console.log('🔄 Resetting exchange state...');
      await this.sendMessage({ type: 'reset_state' });

      // Step 1: Reset insurance fund to zero
      console.log('\n📝 Step 1: Setting up zero insurance fund...');
      const fundReset = await this.resetInsuranceFund();
      this.assert(fundReset, 'Insurance fund reset to zero', fundReset, true);

      // Step 2: Disable automatic liquidations
      console.log('\n📝 Step 2: Disabling automatic liquidations...');
      const liquidationDisabled = await this.sendMessage({ 
        type: 'set_liquidation_enabled', 
        enabled: false 
      });
      this.assert(liquidationDisabled.success, 'Automatic liquidations disabled', liquidationDisabled.liquidationEnabled, false);

      // Step 3: Get initial state
      const initialState = await this.sendMessage({ type: 'get_state' });
      this.logState('Initial State', initialState.state);
      
      const initialTotal = this.calculateSystemTotal(initialState.state);
      console.log(`\n💰 Initial System Total: $${initialTotal}`);

      // Step 4: Bob places buy order
      console.log('\n📝 Step 3: Bob places buy order (1 BTC @ $50,000, 10x leverage)...');
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

      // Step 5: Eve places sell order
      console.log('\n📝 Step 4: Eve places sell order (1 BTC @ $50,000, 10x leverage)...');
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

      // Step 6: Verify positions created
      const afterTradeState = await this.sendMessage({ type: 'get_state' });
      this.logState('After Trade State', afterTradeState.state);

      const bobPosition = afterTradeState.state.positions.find(p => p.userId === 'bob');
      const evePosition = afterTradeState.state.positions.find(p => p.userId === 'eve');
      
      this.assert(bobPosition && bobPosition.side === 'long', 'Bob has long position', bobPosition?.side, 'long');
      this.assert(evePosition && evePosition.side === 'short', 'Eve has short position', evePosition?.side, 'short');

      // Step 7: Calculate Eve's liquidation price and set mark price slightly above it
      console.log('\n📝 Step 5: Calculating Eve\'s liquidation price...');
      const eveLiqPrice = parseFloat(evePosition.liquidationPrice);
      const triggerPrice = eveLiqPrice + 1; // Slightly above liquidation price
      
      console.log(`   Eve's liquidation price: $${eveLiqPrice}`);
      console.log(`   Setting mark price to: $${triggerPrice}`);

      // Step 8: Update mark price to trigger liquidation
      console.log('\n📝 Step 6: Updating mark price to trigger liquidation...');
      const priceUpdate = await this.sendMessage({
        type: 'update_mark_price',
        price: triggerPrice
      });
      this.assert(priceUpdate.success, 'Mark price updated successfully', priceUpdate.success, true);

      // Step 9: Detect liquidations (should find Eve)
      console.log('\n📝 Step 7: Detecting liquidations...');
      const liquidationDetection = await this.sendMessage({ type: 'detect_liquidations' });
      this.assert(liquidationDetection.success, 'Liquidation detection successful', liquidationDetection.success, true);
      this.assert(liquidationDetection.liquidationsDetected === 1, 'One liquidation detected', liquidationDetection.liquidationsDetected, 1);
      
      if (liquidationDetection.liquidations.length > 0) {
        const detectedLiquidation = liquidationDetection.liquidations[0];
        console.log(`   Detected liquidation for: ${detectedLiquidation.userId}`);
        console.log(`   Bankruptcy price: $${detectedLiquidation.bankruptcyPrice}`);
        console.log(`   Unrealized PnL: $${detectedLiquidation.unrealizedPnL}`);
        this.assert(detectedLiquidation.userId === 'eve', 'Eve detected for liquidation', detectedLiquidation.userId, 'eve');
      }

      // Step 10: COMPREHENSIVE PRE-LIQUIDATION CAPTURE
      console.log('\n📊 Step 10: Capturing comprehensive pre-liquidation state...');
      const beforeLiquidationState = await this.sendMessage({ type: 'get_state' });
      const eveBeforeLiquidation = beforeLiquidationState.state.users.find(u => u.id === 'eve');
      const evePositionBeforeLiquidation = beforeLiquidationState.state.positions.find(p => p.userId === 'eve');
      
      // Store all critical values for comparison
      const preLiquidationData = {
        evePnL: parseFloat(evePositionBeforeLiquidation.unrealizedPnL),
        eveEntryPrice: parseFloat(evePositionBeforeLiquidation.avgEntryPrice),
        eveSize: parseFloat(evePositionBeforeLiquidation.size),
        eveSide: evePositionBeforeLiquidation.side,
        markPrice: parseFloat(beforeLiquidationState.state.markPrice),
        liquidationPrice: parseFloat(evePositionBeforeLiquidation.liquidationPrice),
        bankruptcyPrice: parseFloat(evePositionBeforeLiquidation.bankruptcyPrice)
      };
      
      console.log(`\n📊 Eve's state before liquidation:`);
      console.log(`   Used Margin: $${eveBeforeLiquidation.usedMargin}`);
      console.log(`   Available Balance: $${eveBeforeLiquidation.availableBalance}`);
      console.log(`   Position Size: ${evePositionBeforeLiquidation.size} BTC ${evePositionBeforeLiquidation.side}`);
      console.log(`   Entry Price: $${preLiquidationData.eveEntryPrice}`);
      console.log(`   Mark Price: $${preLiquidationData.markPrice}`);
      console.log(`   Liquidation Price: $${preLiquidationData.liquidationPrice}`);
      console.log(`   Bankruptcy Price: $${preLiquidationData.bankruptcyPrice}`);
      console.log(`   Position PnL: $${preLiquidationData.evePnL}`);
      console.log(`   Liquidation Valid: ${preLiquidationData.markPrice > preLiquidationData.liquidationPrice ? 'YES' : 'NO'}`);
      
      // Verify liquidation logic is sound
      const expectedPnL = (preLiquidationData.markPrice - preLiquidationData.eveEntryPrice) * preLiquidationData.eveSize * (preLiquidationData.eveSide === 'short' ? -1 : 1);
      console.log(`   Expected PnL (manual calc): $${expectedPnL}`);
      console.log(`   PnL difference: $${Math.abs(expectedPnL - preLiquidationData.evePnL)}`);

      // Step 11: Manually execute liquidation
      console.log('\n📝 Step 8: Manually executing liquidation...');
      const manualLiquidation = await this.sendMessage({
        type: 'manual_liquidate',
        userId: 'eve'
      });
      this.assert(manualLiquidation.success, 'Manual liquidation successful', manualLiquidation.success, true);

      // Step 12: Verify final state
      const finalState = await this.sendMessage({ type: 'get_state' });
      this.logState('Final State', finalState.state);

      const finalTotal = this.calculateSystemTotal(finalState.state);
      console.log(`\n💰 Final System Total: $${finalTotal}`);

      // Verification Tests
      console.log('\n🔍 VERIFICATION TESTS:');
      console.log('='.repeat(40));

      // Test 1: Eve lost her margin
      const eveAfterLiquidation = finalState.state.users.find(u => u.id === 'eve');
      const marginLost = parseFloat(eveBeforeLiquidation.usedMargin) - parseFloat(eveAfterLiquidation.usedMargin);
      this.assert(
        marginLost > 0,
        'Eve lost her margin from liquidation',
        `$${marginLost}`,
        '> $0'
      );

      // Test 2: Eve no longer has position
      const evePositionAfter = finalState.state.positions.find(p => p.userId === 'eve');
      this.assert(
        !evePositionAfter,
        'Eve no longer has position',
        evePositionAfter ? 'exists' : 'none',
        'none'
      );

      // Test 3: Liquidation engine has new position
      this.assert(
        finalState.state.positionLiquidationEngine.positions.length === 1,
        'Liquidation engine has one position',
        finalState.state.positionLiquidationEngine.positions.length,
        1
      );

      // Test 4: Liquidation engine position has correct properties
      if (finalState.state.positionLiquidationEngine.positions.length > 0) {
        const lePosition = finalState.state.positionLiquidationEngine.positions[0];
        
        this.assert(
          lePosition.originalUserId === 'eve',
          'LE position has correct original user',
          lePosition.originalUserId,
          'eve'
        );
        
        this.assert(
          lePosition.side === 'short',
          'LE position has correct side',
          lePosition.side,
          'short'
        );
        
        this.assert(
          parseFloat(lePosition.size) === 1,
          'LE position has correct size',
          parseFloat(lePosition.size),
          1
        );

        // Test 5: Position Transfer Accuracy (comprehensive PnL verification)
        this.verifyPositionTransferAccuracy(lePosition, preLiquidationData, `Test 5`);
      }

      // Test 6: Zero-sum verification
      const zeroSum = this.verifyZeroSum(finalState.state);
      this.assert(
        zeroSum.sizeDiff < 0.001,
        'Position sizes balance (zero-sum)',
        zeroSum.sizeDiff,
        '< 0.001'
      );

      // Test 7: Bob still has position
      const bobPositionAfter = finalState.state.positions.find(p => p.userId === 'bob');
      this.assert(
        bobPositionAfter && bobPositionAfter.side === 'long',
        'Bob still has long position',
        bobPositionAfter?.side,
        'long'
      );

      // Test 8: System balance conservation (margin goes to Insurance Fund)
      const expectedMarginLoss = 5000; // Eve's margin at 10x leverage on $50k position
      const initialInsuranceFund = 0; // We reset it to zero at the start
      const finalInsuranceFund = parseFloat(finalState.state.insuranceFund.balance);
      const expectedFinalTotal = initialTotal; // System total should be conserved
      const balanceDiff = Math.abs(finalTotal - expectedFinalTotal);
      
      console.log(`   Initial Total: $${initialTotal}`);
      console.log(`   Initial Insurance Fund: $${initialInsuranceFund}`);
      console.log(`   Final Insurance Fund: $${finalInsuranceFund}`);
      console.log(`   Expected Final Total: $${expectedFinalTotal} (conserved)`);
      console.log(`   Actual Final Total: $${finalTotal}`);
      console.log(`   Difference: $${balanceDiff}`);
      
      this.assert(
        balanceDiff < 10,
        'System total conserved (margin transferred to Insurance Fund)',
        `$${balanceDiff} difference`,
        '< $10 tolerance'
      );
      
      // Test 8b: Insurance Fund received the margin loss
      const insuranceFundIncrease = finalInsuranceFund - initialInsuranceFund;
      const marginTransferDiff = Math.abs(insuranceFundIncrease - expectedMarginLoss);
      
      console.log(`   Insurance Fund increase: $${insuranceFundIncrease}`);
      console.log(`   Expected margin transfer: $${expectedMarginLoss}`);
      console.log(`   Transfer difference: $${marginTransferDiff}`);
      
      this.assert(
        marginTransferDiff < 10,
        'Insurance Fund received the lost margin',
        `$${marginTransferDiff} difference`,
        '< $10 tolerance'
      );

      // Final Results
      console.log('\n📊 TEST RESULTS:');
      console.log('='.repeat(40));
      console.log(`✅ Passed: ${this.testResults.passed}`);
      console.log(`❌ Failed: ${this.testResults.failed}`);
      console.log(`📈 Success Rate: ${((this.testResults.passed / (this.testResults.passed + this.testResults.failed)) * 100).toFixed(1)}%`);

      if (this.testResults.failed === 0) {
        console.log('\n🎉 ALL TESTS PASSED! Liquidation and position transfer working correctly.');
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
const test = new LiquidationTransferTest();
test.runTest().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 