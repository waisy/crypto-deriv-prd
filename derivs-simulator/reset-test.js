const WebSocket = require('ws');

class SimpleADLTest {
  constructor() {
    this.ws = null;
    this.clientId = Math.random().toString(36).substr(2, 8);
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
    if (message.type === 'update' && message.state) {
      console.log('\n📊 STATE UPDATE:');
      console.log('Mark Price:', message.state.markPrice);
      
      console.log('User Positions:');
      if (message.state.positions && message.state.positions.length > 0) {
        message.state.positions.forEach(pos => {
          console.log(`  ${pos.userId}: ${pos.side} ${pos.size} @ ${pos.avgEntryPrice} (PnL: ${pos.unrealizedPnL})`);
        });
      } else {
        console.log('  No user positions');
      }

      console.log('Liquidation Positions:');
      if (message.state.liquidationPositions && message.state.liquidationPositions.length > 0) {
        message.state.liquidationPositions.forEach(pos => {
          console.log(`  LE ${pos.id}: ${pos.side} ${pos.size} @ ${pos.entryPrice} (${pos.originalUserId})`);
        });
      } else {
        console.log('  No liquidation positions');
      }

      // Zero-sum check
      let userLong = 0, userShort = 0, leLong = 0, leShort = 0;
      
      if (message.state.positions) {
        message.state.positions.forEach(pos => {
          if (pos.side === 'long') userLong += parseFloat(pos.size);
          if (pos.side === 'short') userShort += parseFloat(pos.size);
        });
      }

      if (message.state.liquidationPositions) {
        message.state.liquidationPositions.forEach(pos => {
          if (pos.side === 'long') leLong += parseFloat(pos.size);
          if (pos.side === 'short') leShort += parseFloat(pos.size);
        });
      }

      const totalLong = userLong + leLong;
      const totalShort = userShort + leShort;
      const diff = totalLong - totalShort;

      console.log(`Zero-sum: User(L:${userLong}, S:${userShort}) + LE(L:${leLong}, S:${leShort}) = Total(L:${totalLong}, S:${totalShort}) Diff:${diff}`);
      if (Math.abs(diff) > 0.001) {
        console.log('🚨 ZERO-SUM VIOLATION!');
      } else {
        console.log('✅ Zero-sum OK');
      }
    } else {
      console.log('📨', message.type, message.success ? '✅' : '❌');
    }
  }

  async send(message) {
    return new Promise((resolve) => {
      message.clientId = this.clientId;
      this.ws.send(JSON.stringify(message));
      setTimeout(resolve, 800);
    });
  }

  async runTest() {
    try {
      console.log('🧪 Starting Clean ADL Test\n');

      console.log('Step 1: Reset system by updating mark price...');
      await this.send({
        type: 'update_mark_price',
        price: 45000
      });

      console.log('\nStep 2: Create buy order for bob...');
      await this.send({
        type: 'place_order',
        userId: 'bob',
        side: 'buy',
        size: 1,
        price: 45000,
        orderType: 'limit',
        leverage: 10
      });

      console.log('\nStep 3: Create sell order for eve...');
      await this.send({
        type: 'place_order',
        userId: 'eve',
        side: 'sell',
        size: 1,
        price: 45000,
        orderType: 'limit',
        leverage: 10
      });

      console.log('\nStep 4: Move price up to make bob profitable...');
      await this.send({
        type: 'update_mark_price',
        price: 50000
      });

      console.log('\nStep 5: Move price higher to liquidate eve...');
      await this.send({
        type: 'update_mark_price',
        price: 54000
      });

      console.log('\nStep 6: Execute ADL...');
      await this.send({
        type: 'liquidation_step',
        method: 'adl'
      });

      console.log('\n✅ Test completed');

    } catch (error) {
      console.error('❌ Test failed:', error);
    } finally {
      setTimeout(() => this.ws.close(), 1000);
    }
  }
}

async function main() {
  const test = new SimpleADLTest();
  await test.connect();
  await test.runTest();
}

main().catch(console.error); 