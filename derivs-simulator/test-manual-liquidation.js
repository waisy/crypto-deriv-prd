const WebSocket = require('ws');

class TestClient {
  constructor(url = 'ws://localhost:3000') {
    this.url = url;
    this.ws = null;
    this.requestId = 0;
    this.responses = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const message = JSON.parse(data);
        if (message.requestId) {
          const resolve = this.responses.get(message.requestId);
          if (resolve) {
            this.responses.delete(message.requestId);
            resolve(message);
          }
        }
      });
    });
  }

  async sendRequest(data) {
    const requestId = ++this.requestId;
    const message = { ...data, requestId };
    
    return new Promise((resolve) => {
      this.responses.set(requestId, resolve);
      this.ws.send(JSON.stringify(message));
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

function formatCurrency(amount) {
  if (typeof amount === 'string') amount = parseFloat(amount);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

async function testManualLiquidation() {
  console.log('🧪 MANUAL LIQUIDATION TEST');
  console.log('='.repeat(50));
  console.log('Testing manual liquidation to verify Insurance Fund receives lost margin\n');

  const client = new TestClient();
  
  try {
    await client.connect();
    console.log('✅ Connected to server\n');

    // Reset state
    await client.sendRequest({ type: 'reset_state' });
    
    // Take initial snapshot
    let response = await client.sendRequest({ type: 'get_state' });
    const initialFund = parseFloat(response.state.insuranceFund.balance);
    console.log(`📸 Initial Insurance Fund: ${formatCurrency(initialFund)}`);

    // Create positions (Bob long, Eve short at $45k)
    console.log('\n🔨 Creating positions...');
    await client.sendRequest({
      type: 'place_order',
      userId: 'bob',
      side: 'buy',
      size: 1,
      price: 45000,
      orderType: 'limit',
      leverage: 2
    });

    await client.sendRequest({
      type: 'place_order',
      userId: 'eve',
      side: 'sell',
      size: 1,
      price: 45000,
      orderType: 'limit',
      leverage: 2
    });

    response = await client.sendRequest({ type: 'get_state' });
    console.log('✅ Positions created');
    console.log(`   Bob balance: ${formatCurrency(parseFloat(response.state.users.find(u => u.id === 'bob').totalBalance))}`);
    console.log(`   Eve balance: ${formatCurrency(parseFloat(response.state.users.find(u => u.id === 'eve').totalBalance))}`);
    console.log(`   Eve used margin: ${formatCurrency(parseFloat(response.state.users.find(u => u.id === 'eve').usedMargin))}`);

    // Move price to make Eve's position underwater
    console.log('\n📈 Moving price to $51,000...');
    await client.sendRequest({
      type: 'update_mark_price',
      price: 51000
    });

    response = await client.sendRequest({ type: 'get_state' });
    const eveBeforeLiquidation = response.state.users.find(u => u.id === 'eve');
    console.log('✅ Price moved');
    console.log(`   Eve balance: ${formatCurrency(parseFloat(eveBeforeLiquidation.totalBalance))}`);
    console.log(`   Eve used margin: ${formatCurrency(parseFloat(eveBeforeLiquidation.usedMargin))}`);
    console.log(`   Eve unrealized P&L: ${formatCurrency(parseFloat(eveBeforeLiquidation.unrealizedPnL))}`);

    // Check if liquidation is warranted
    response = await client.sendRequest({ type: 'detect_liquidations' });
    console.log(`\n🔍 Liquidations detected: ${response.liquidationsDetected}`);
    if (response.liquidations && response.liquidations.length > 0) {
      console.log('   Eve liquidation details:', response.liquidations[0]);
    }

    // Manually trigger liquidation
    console.log('\n⚡ Manually triggering liquidation...');
    response = await client.sendRequest({
      type: 'manual_liquidate',
      userId: 'eve'
    });

    if (response.success) {
      console.log('✅ Manual liquidation successful');
      
      // Check final state
      response = await client.sendRequest({ type: 'get_state' });
      const finalFund = parseFloat(response.state.insuranceFund.balance);
      const eveAfterLiquidation = response.state.users.find(u => u.id === 'eve');
      
      console.log('\n📊 LIQUIDATION RESULTS:');
      console.log(`   Insurance Fund: ${formatCurrency(initialFund)} → ${formatCurrency(finalFund)} (${formatCurrency(finalFund - initialFund)})`);
      console.log(`   Eve balance: ${formatCurrency(parseFloat(eveBeforeLiquidation.totalBalance))} → ${formatCurrency(parseFloat(eveAfterLiquidation.totalBalance))}`);
      console.log(`   Eve used margin: ${formatCurrency(parseFloat(eveBeforeLiquidation.usedMargin))} → ${formatCurrency(parseFloat(eveAfterLiquidation.usedMargin))}`);
      
      const marginLost = parseFloat(eveBeforeLiquidation.usedMargin) - parseFloat(eveAfterLiquidation.usedMargin);
      const fundGain = finalFund - initialFund;
      
      console.log('\n🔍 CONSERVATION CHECK:');
      console.log(`   Eve margin lost: ${formatCurrency(marginLost)}`);
      console.log(`   Insurance Fund gain: ${formatCurrency(fundGain)}`);
      
      if (Math.abs(marginLost - fundGain) < 0.01) {
        console.log('✅ SUCCESS: Lost margin transferred to Insurance Fund - zero-sum maintained');
      } else {
        console.log('❌ FAILURE: Margin loss does not match fund gain');
      }
      
      console.log(`\n📋 Liquidation engine positions: ${response.state.positionLiquidationEngine.positions.length}`);
      if (response.state.positionLiquidationEngine.positions.length > 0) {
        console.log('   Position transferred to liquidation engine for further processing');
      }
      
    } else {
      console.log('❌ Manual liquidation failed:', response.error);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    client.disconnect();
  }
}

// Run the test
if (require.main === module) {
  testManualLiquidation().catch(console.error);
}

module.exports = { testManualLiquidation }; 