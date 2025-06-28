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
    } else {
      console.log('📨 Received:', message.type, message.success ? '✅' : '❌');
    }
  }

  logState(state) {
    console.log('\n📊 CURRENT STATE:');
    console.log('Mark Price:', state.markPrice);
    
    console.log('\n👥 User Positions:');
    state.users.forEach(user => {
      const position = state.positions.find(p => p.userId === user.userId);
      if (position) {
        console.log(`  ${user.userId}: ${position.side} ${position.size} @ ${position.avgEntryPrice} (PnL: ${position.unrealizedPnL})`);
      } else {
        console.log(`  ${user.userId}: No position`);
      }
    });

    console.log('\n🏭 Liquidation Engine Positions:');
    if (state.liquidationPositions && state.liquidationPositions.length > 0) {
      state.liquidationPositions.forEach(pos => {
        console.log(`  LE Position ${pos.id}: ${pos.side} ${pos.size} @ ${pos.entryPrice} (Original: ${pos.originalUserId})`);
      });
    } else {
      console.log('  No liquidation positions');
    }

    // Check zero-sum invariant
    let totalLong = 0;
    let totalShort = 0;
    
    state.positions.forEach(pos => {
      if (pos.side === 'long') totalLong += parseFloat(pos.size);
      if (pos.side === 'short') totalShort += parseFloat(pos.size);
    });

    if (state.liquidationPositions) {
      state.liquidationPositions.forEach(pos => {
        if (pos.side === 'long') totalLong += parseFloat(pos.size);
        if (pos.side === 'short') totalShort += parseFloat(pos.size);
      });
    }

    console.log(`\n⚖️  Zero-sum check: Long=${totalLong}, Short=${totalShort}, Diff=${totalLong - totalShort}`);
    if (Math.abs(totalLong - totalShort) > 0.001) {
      console.log('🚨 ZERO-SUM VIOLATION!');
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