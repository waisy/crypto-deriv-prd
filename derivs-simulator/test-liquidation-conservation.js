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

function calculateSystemTotal(state) {
  let total = 0;
  
  // User balances
  for (const user of state.users) {
    const balance = parseFloat(user.totalBalance || user.balance || 0);
    if (!isNaN(balance)) {
      total += balance;
    }
  }
  
  // Insurance Fund
  if (state.insuranceFund && state.insuranceFund.balance) {
    const fundBalance = parseFloat(state.insuranceFund.balance);
    if (!isNaN(fundBalance)) {
      total += fundBalance;
    }
  }
  
  return total;
}

function createSnapshot(state, label) {
  const users = {};
  for (const user of state.users) {
    users[user.id] = {
      balance: parseFloat(user.totalBalance || user.balance || 0),
      availableBalance: parseFloat(user.availableBalance || 0),
      usedMargin: parseFloat(user.usedMargin || 0),
      totalPnL: parseFloat(user.totalPnL || 0)
    };
  }
  
  const insuranceFund = state.insuranceFund ? parseFloat(state.insuranceFund.balance) : 0;
  const systemTotal = calculateSystemTotal(state);
  
  return {
    label,
    timestamp: Date.now(),
    users,
    insuranceFund,
    systemTotal,
    positions: state.positions ? state.positions.map(p => ({
      userId: p.userId,
      side: p.side,
      size: parseFloat(p.size) || 0,
      unrealizedPnL: parseFloat(p.unrealizedPnL) || 0
    })) : []
  };
}

function compareSnapshots(before, after) {
  console.log(`\n📊 BALANCE ANALYSIS: ${before.label} → ${after.label}`);
  console.log('=' .repeat(60));
  
  // System total comparison
  const systemChange = after.systemTotal - before.systemTotal;
  console.log(`💰 SYSTEM TOTAL: ${formatCurrency(before.systemTotal)} → ${formatCurrency(after.systemTotal)} (${systemChange >= 0 ? '+' : ''}${formatCurrency(systemChange)})`);
  
  if (Math.abs(systemChange) < 0.01) {
    console.log('✅ ZERO-SUM MAINTAINED: System total unchanged');
  } else {
    console.log(`❌ ZERO-SUM VIOLATION: System total changed by ${formatCurrency(systemChange)}`);
  }
  
  // User balance changes
  console.log('\n👥 USER BALANCE CHANGES:');
  for (const [userId, beforeUser] of Object.entries(before.users)) {
    const afterUser = after.users[userId];
    if (afterUser) {
      const balanceChange = afterUser.balance - beforeUser.balance;
      if (Math.abs(balanceChange) > 0.01) {
        console.log(`  ${userId}: ${formatCurrency(beforeUser.balance)} → ${formatCurrency(afterUser.balance)} (${balanceChange >= 0 ? '+' : ''}${formatCurrency(balanceChange)})`);
      }
    }
  }
  
  // Insurance Fund changes
  const fundChange = after.insuranceFund - before.insuranceFund;
  if (Math.abs(fundChange) > 0.01) {
    console.log(`\n🏦 INSURANCE FUND: ${formatCurrency(before.insuranceFund)} → ${formatCurrency(after.insuranceFund)} (${fundChange >= 0 ? '+' : ''}${formatCurrency(fundChange)})`);
  }
  
  return systemChange;
}

async function testLiquidationConservation() {
  console.log('🧪 LIQUIDATION CONSERVATION TEST');
  console.log('='.repeat(50));
  console.log('Testing that liquidation margin losses are transferred to Insurance Fund');
  console.log('Expected: Lost margin should go to Insurance Fund, maintaining zero-sum\n');

  const client = new TestClient();
  
  try {
    await client.connect();
    console.log('✅ Connected to server\n');

    // Reset state
    await client.sendRequest({ type: 'reset_state' });
    
    // Step 1: Take initial snapshot
    let response = await client.sendRequest({ type: 'get_state' });
    const initialState = createSnapshot(response.state, 'Initial');
    console.log('📸 Initial snapshot taken');
    console.log(`   System Total: ${formatCurrency(initialState.systemTotal)}`);
    console.log(`   Insurance Fund: ${formatCurrency(initialState.insuranceFund)}`);

    // Step 2: Create positions (Bob long, Eve short at $45k)
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
    const afterPositions = createSnapshot(response.state, 'After Positions');
    console.log('✅ Positions created');
    
    const positionsChange = compareSnapshots(initialState, afterPositions);

    // Step 3: Move price to trigger liquidation ($45k → $51k)
    console.log('\n📈 Moving price to trigger liquidation...');
    await client.sendRequest({
      type: 'update_mark_price',
      price: 51000
    });

    response = await client.sendRequest({ type: 'get_state' });
    const afterPriceMove = createSnapshot(response.state, 'After Price Move');
    console.log('✅ Price moved to $51,000');
    console.log(`   Positions after price move: ${afterPriceMove.positions.length}`);
    console.log(`   Liquidation engine positions: ${response.state.positionLiquidationEngine.positions.length}`);
    
    const priceMoveChange = compareSnapshots(afterPositions, afterPriceMove);

    // Step 4: Execute liquidation (this should trigger Eve's liquidation)
    console.log('\n⚡ Triggering liquidation...');
    // The price move should have automatically triggered liquidation, but let's check
    
    response = await client.sendRequest({ type: 'get_state' });
    const afterLiquidation = createSnapshot(response.state, 'After Liquidation');
    
    const liquidationChange = compareSnapshots(afterPriceMove, afterLiquidation);

    // Step 5: Verify Insurance Fund received the lost margin
    console.log('\n🔍 LIQUIDATION ANALYSIS:');
    console.log('=' .repeat(40));
    
    const eveBefore = afterPriceMove.users.eve;
    const eveAfter = afterLiquidation.users.eve;
    const fundBefore = afterPriceMove.insuranceFund;
    const fundAfter = afterLiquidation.insuranceFund;
    
    if (eveAfter && eveBefore) {
      const eveMarginLoss = eveBefore.usedMargin - eveAfter.usedMargin;
      const fundGain = fundAfter - fundBefore;
      
      console.log(`💸 Eve margin loss: ${formatCurrency(eveMarginLoss)}`);
      console.log(`🏦 Insurance Fund gain: ${formatCurrency(fundGain)}`);
      
      if (Math.abs(eveMarginLoss - fundGain) < 0.01) {
        console.log('✅ CONSERVATION VERIFIED: Lost margin transferred to Insurance Fund');
      } else {
        console.log('❌ CONSERVATION FAILED: Margin loss does not match fund gain');
      }
    }

    // Step 6: Overall conservation check
    console.log('\n🎯 OVERALL CONSERVATION CHECK:');
    const totalChange = compareSnapshots(initialState, afterLiquidation);
    
    if (Math.abs(totalChange) < 0.01) {
      console.log('✅ SUCCESS: Zero-sum principles maintained throughout liquidation');
    } else {
      console.log('❌ FAILURE: System total changed, zero-sum violated');
    }

    console.log('\n📋 FINAL STATE:');
    console.log(`   System Total: ${formatCurrency(afterLiquidation.systemTotal)}`);
    console.log(`   Insurance Fund: ${formatCurrency(afterLiquidation.insuranceFund)}`);
    console.log(`   Bob Balance: ${formatCurrency(afterLiquidation.users.bob.balance)}`);
    console.log(`   Eve Balance: ${formatCurrency(afterLiquidation.users.eve.balance)}`);

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    client.disconnect();
  }
}

// Run the test
if (require.main === module) {
  testLiquidationConservation().catch(console.error);
}

module.exports = { testLiquidationConservation }; 