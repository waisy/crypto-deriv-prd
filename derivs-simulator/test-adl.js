const WebSocket = require('ws');

class ADLTester {
  constructor() {
    this.ws = null;
    this.clientId = Math.random().toString(36).substr(2, 8);
    this.testResults = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:3000');
      
      this.ws.on('open', () => {
        console.log('🔗 Connected to server');
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (error) {
          console.error('❌ Error parsing message:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        reject(error);
      });
    });
  }

  handleMessage(message) {
    if (message.type === 'update') {
      this.logState(message.state);
      this.checkMarginAnomalies(message.state);
    } else {
      console.log('📨 Received:', message.type, message.success ? '✅' : '❌');
    }
  }

  checkMarginAnomalies(state) {
    console.log('\n🔍 MARGIN ANOMALY CHECK:');
    let hasAnomalies = false;
    
    state.users.forEach(user => {
      const position = state.positions.find(p => p.userId === user.userId);
      const usedMargin = parseFloat(user.usedMargin);
      const availableBalance = parseFloat(user.availableBalance);
      const totalBalance = parseFloat(user.balance);
      
      // Check for used margin without position
      if (usedMargin > 0.01 && !position) {
        console.log(`  🚨 ${user.userId}: Has used margin $${usedMargin} but no position!`);
        hasAnomalies = true;
      }
      
      // Check if balance components add up
      const calculatedTotal = availableBalance + usedMargin;
      if (Math.abs(calculatedTotal - totalBalance) > 0.01) {
        console.log(`  🚨 ${user.userId}: Balance mismatch! Available($${availableBalance}) + Used($${usedMargin}) = $${calculatedTotal} ≠ Total($${totalBalance})`);
        hasAnomalies = true;
      }
      
      // Check if position exists but no used margin
      if (position && usedMargin < 0.01) {
        console.log(`  🚨 ${user.userId}: Has position but no used margin!`);
        hasAnomalies = true;
      }
    });
    
    if (!hasAnomalies) {
      console.log('  ✅ No margin anomalies detected');
    }
    
    return hasAnomalies;
  }

  logState(state) {
    console.log('\n📊 CURRENT STATE:');
    console.log('Mark Price:', state.markPrice);
    
    console.log('\n👥 USER ACCOUNTS & POSITIONS:');
    state.users.forEach(user => {
      const position = state.positions.find(p => p.userId === user.userId);
      
      console.log(`\n  👤 ${user.userId.toUpperCase()}:`);
      console.log(`    💰 Balance: $${user.balance} (Available: $${user.availableBalance}, Used Margin: $${user.usedMargin})`);
      
      if (position) {
        console.log(`    📈 Position: ${position.side} ${position.size} BTC @ $${position.avgEntryPrice}`);
        console.log(`    💵 PnL: $${position.unrealizedPnL} | Liq Price: $${position.liquidationPrice}`);
        console.log(`    🔒 Margins - Initial: $${position.initialMargin}, Maintenance: $${position.maintenanceMargin}`);
      } else {
        console.log(`    📈 Position: None`);
      }
      
      // Flag margin issues
      if (parseFloat(user.usedMargin) > 0.01 && !position) {
        console.log(`    🚨 WARNING: Used margin ${user.usedMargin} but no position!`);
      }
    });

    console.log('\n🏭 LIQUIDATION ENGINE POSITIONS:');
    if (state.positionLiquidationEngine && state.positionLiquidationEngine.positions && state.positionLiquidationEngine.positions.length > 0) {
      state.positionLiquidationEngine.positions.forEach(pos => {
        console.log(`  LE Position ${pos.id}: ${pos.side} ${pos.size} @ ${pos.entryPrice} (Original: ${pos.originalUserId}, PnL: ${pos.unrealizedPnL})`);
      });
    } else {
      console.log('  No liquidation positions');
    }

    // Enhanced zero-sum check with detailed breakdown
    let userLong = 0, userShort = 0, leLong = 0, leShort = 0;
    let userPnL = 0, lePnL = 0;
    
    state.positions.forEach(pos => {
      if (pos.side === 'long') {
        userLong += parseFloat(pos.size);
        userPnL += parseFloat(pos.unrealizedPnL);
      }
      if (pos.side === 'short') {
        userShort += parseFloat(pos.size);
        userPnL += parseFloat(pos.unrealizedPnL);
      }
    });

    if (state.positionLiquidationEngine && state.positionLiquidationEngine.positions) {
      state.positionLiquidationEngine.positions.forEach(pos => {
        if (pos.side === 'long') {
          leLong += parseFloat(pos.size);
          lePnL += parseFloat(pos.unrealizedPnL || 0);
        }
        if (pos.side === 'short') {
          leShort += parseFloat(pos.size);
          lePnL += parseFloat(pos.unrealizedPnL || 0);
        }
      });
    }

    const totalLong = userLong + leLong;
    const totalShort = userShort + leShort;
    const totalPnL = userPnL + lePnL;

    console.log(`\n⚖️  ZERO-SUM ANALYSIS:`);
    console.log(`  📊 Quantities: User(L:${userLong}, S:${userShort}) + LE(L:${leLong}, S:${leShort}) = Total(L:${totalLong}, S:${totalShort})`);
    console.log(`  💰 PnL: User($${userPnL.toFixed(2)}) + LE($${lePnL.toFixed(2)}) = Total($${totalPnL.toFixed(2)})`);
    console.log(`  🎯 Position Diff: ${(totalLong - totalShort).toFixed(6)}, PnL Diff: $${totalPnL.toFixed(2)}`);
    
    if (Math.abs(totalLong - totalShort) > 0.001) {
      console.log('  🚨 ZERO-SUM VIOLATION: Position quantities do not balance!');
    }
    if (Math.abs(totalPnL) > 0.01) {
      console.log('  🚨 ZERO-SUM VIOLATION: PnL does not sum to zero!');
    }
    if (Math.abs(totalLong - totalShort) <= 0.001 && Math.abs(totalPnL) <= 0.01) {
      console.log('  ✅ Zero-sum invariant maintained');
    }

    // Insurance fund info
    if (state.insuranceFund) {
      console.log(`\n🏛️  Insurance Fund: $${state.insuranceFund.balance} (At Risk: ${state.insuranceFund.isAtRisk})`);
    }
  }

  async sendMessage(message) {
    return new Promise((resolve) => {
      message.clientId = this.clientId;
      this.ws.send(JSON.stringify(message));
      setTimeout(resolve, 1000); // Wait for processing
    });
  }

  async runTest() {
    try {
      console.log('🧪 Starting ADL Test\n');

      // Step 1: Create opposing positions
      console.log('📝 Step 1: Creating positions...');
      
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

      console.log('\n📈 Step 2: Moving mark price to create profit for bob...');
      await this.sendMessage({
        type: 'update_mark_price',
        price: 50000
      });

      console.log('\n💥 Step 3: Moving mark price to liquidate eve...');
      await this.sendMessage({
        type: 'update_mark_price',
        price: 54000 // Should trigger liquidation for eve's short position
      });

      console.log('\n🎯 Step 4: Executing ADL...');
      await this.sendMessage({
        type: 'liquidation_step',
        method: 'adl'
      });

      console.log('\n✅ Test completed');

    } catch (error) {
      console.error('❌ Test failed:', error);
    } finally {
      this.ws.close();
    }
  }
}

async function main() {
  const tester = new ADLTester();
  await tester.connect();
  await tester.runTest();
}

if (require.main === module) {
  main().catch(console.error);
} 