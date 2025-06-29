const WebSocket = require('ws');
const http = require('http');

class TestClient {
  constructor() {
    this.ws = null;
    this.responses = new Map();
    this.requestId = 0;
  }

  async connect() {
    this.ws = new WebSocket('ws://localhost:3000');
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 5000);
      
      this.ws.on('open', () => {
        clearTimeout(timeout);
        console.log('✅ Connected to server');
        resolve();
      });
      
      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log('❌ Connection error:', error.message);
        reject(error);
      });
      
      this.ws.on('message', (data) => this.handleMessage(JSON.parse(data)));
    });
  }

  handleMessage(message) {
    // Reduce logging to avoid race conditions
    if (message.requestId) {
      this.responses.set(message.requestId, message);
    }
  }

  async sendMessage(data) {
    const requestId = ++this.requestId;
    const message = { ...data, requestId };
    
    this.ws.send(JSON.stringify(message));
    
    // Wait for response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for response to ${message.type}`));
      }, 10000);
      
      const checkResponse = () => {
        if (this.responses.has(requestId)) {
          clearTimeout(timeout);
          const response = this.responses.get(requestId);
          this.responses.delete(requestId);
          resolve(response);
        } else {
          setTimeout(checkResponse, 10);
        }
      };
      checkResponse();
    });
  }

  async getState() {
    const response = await this.sendMessage({ type: 'get_state' });
    return response.state;
  }

  async placeOrder(userId, side, size, price, leverage) {
    return await this.sendMessage({
      type: 'place_order',
      userId,
      side,
      size,
      price,
      orderType: 'limit',
      leverage
    });
  }

  async updateMarkPrice(price) {
    return await this.sendMessage({
      type: 'update_mark_price',
      price
    });
  }

  async executeLiquidationStep(method) {
    return await this.sendMessage({
      type: 'liquidation_step',
      method
    });
  }

  async resetInsuranceFund(amount) {
    return await this.sendMessage({
      type: 'manual_adjustment',
      amount: amount - 1000000, // Adjust from default 1M
      description: 'Test reset'
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

function formatCurrency(amount) {
  return `$${parseFloat(amount).toLocaleString()}`;
}

function calculateSystemTotal(state) {
  let total = 0;
  
  // Add user balances
  state.users.forEach(user => {
    total += parseFloat(user.totalBalance);
  });
  
  // Add insurance fund
  total += parseFloat(state.insuranceFund);
  
  return total;
}

function displaySnapshot(snapshot) {
  console.log(`📸 SNAPSHOT: ${snapshot.label}`);
  Object.entries(snapshot.users).forEach(([userId, data]) => {
    console.log(`  ${userId}: Balance=${formatCurrency(data.balance)}, Available=${formatCurrency(data.available)}, Margin=${formatCurrency(data.usedMargin)}`);
  });
  console.log(`  Insurance Fund: ${formatCurrency(snapshot.insuranceFund)}`);
  
  // Additional debugging info
  console.log(`📊 DETAILED BREAKDOWN:`);
  Object.entries(snapshot.users).forEach(([userId, data]) => {
    console.log(`  ${userId}:`);
    console.log(`    - Total Balance: ${formatCurrency(data.balance)}`);
    console.log(`    - Available: ${formatCurrency(data.available)}`);
    console.log(`    - Used Margin: ${formatCurrency(data.usedMargin)}`);
    console.log(`    - Unrealized PnL: ${formatCurrency(data.unrealizedPnL)}`);
    console.log(`    - Equity: ${formatCurrency(data.equity)}`);
  });
  
  console.log(`  Positions: ${snapshot.positions}`);
  console.log(`  Liquidation Engine Positions: ${snapshot.liquidationPositions}`);
  console.log();
}

function analyzeBalanceChange(before, after, label) {
  console.log(`🔍 COMPARISON: ${label}`);
  
  // Calculate system totals
  const beforeTotal = Object.values(before.users).reduce((sum, user) => sum + user.balance, 0) + (before.insuranceFund || 0);
  const afterTotal = Object.values(after.users).reduce((sum, user) => sum + user.balance, 0) + (after.insuranceFund || 0);
  const totalChange = afterTotal - beforeTotal;
  
  console.log(`System Total: ${formatCurrency(beforeTotal)} → ${formatCurrency(afterTotal)} (${formatCurrency(totalChange)})`);
  
  // Analyze individual user changes
  Object.keys(before.users).forEach(userId => {
    const beforeBalance = before.users[userId].balance;
    const afterBalance = after.users[userId].balance;
    const change = afterBalance - beforeBalance;
    
    if (Math.abs(change) > 0.01) {
      console.log(`  ${userId}: ${formatCurrency(beforeBalance)} → ${formatCurrency(afterBalance)} (${formatCurrency(change)})`);
    }
  });
  
  // Insurance fund changes
  if (!isNaN(before.insuranceFund) && !isNaN(after.insuranceFund)) {
    const fundChange = after.insuranceFund - before.insuranceFund;
    if (Math.abs(fundChange) > 0.01) {
      console.log(`  Insurance Fund: ${formatCurrency(before.insuranceFund)} → ${formatCurrency(after.insuranceFund)} (${formatCurrency(fundChange)})`);
    }
  }
  
  console.log();
  
  return {
    totalChange,
    conserved: Math.abs(totalChange) < 0.01
  };
}

function takeSnapshot(state, label) {
  const users = {};
  
  // Extract user data
  state.users.forEach(user => {
    users[user.id] = {
      balance: parseFloat(user.totalBalance || user.balance),
      available: parseFloat(user.availableBalance),
      usedMargin: parseFloat(user.usedMargin || 0),
      unrealizedPnL: parseFloat(user.unrealizedPnL || 0),
      equity: parseFloat(user.equity || user.totalBalance || user.balance)
    };
  });
  
  // Extract insurance fund balance - try different property names
  let insuranceFundBalance = NaN;
  if (state.insuranceFund) {
    if (typeof state.insuranceFund.balance === 'string') {
      insuranceFundBalance = parseFloat(state.insuranceFund.balance);
    } else if (typeof state.insuranceFund.balance === 'number') {
      insuranceFundBalance = state.insuranceFund.balance;
    }
  }
  
  // Extract positions
  const positions = state.positions || [];
  const liquidationPositions = (state.positionLiquidationEngine?.positions || []).length;
  
  return {
    label,
    users,
    insuranceFund: insuranceFundBalance,
    positions: positions.length,
    liquidationPositions,
    timestamp: Date.now()
  };
}

describe('Simple ADL Balance Tests', () => {
  let client;
  
  beforeEach(async () => {
    client = new TestClient();
    await client.connect();
  }, 10000);
  
  afterEach(async () => {
    if (client && client.ws) {
      // Properly close WebSocket and wait for closure
      client.ws.close();
      await new Promise(resolve => {
        if (client.ws.readyState === client.ws.CLOSED) {
          resolve();
        } else {
          client.ws.on('close', () => resolve());
        }
        // Fallback timeout
        setTimeout(resolve, 200);
      });
    }
  });

  test('should maintain balance conservation through liquidation and ADL process', async () => {
    console.log('🧪 SIMPLE ADL BALANCE TEST');
    console.log('========================================');
    
    // Take initial snapshot (no need to reset insurance fund for this test)
    console.log('📝 Creating positions...');
    const initial = takeSnapshot(await client.getState(), 'initial');
    displaySnapshot(initial);

    // Bob goes long 1 BTC at $45k with 10x leverage
    await client.placeOrder('bob', 'buy', 1, 45000, 10);
    
    // Eve goes short 1 BTC at $45k with 10x leverage  
    await client.placeOrder('eve', 'sell', 1, 45000, 10);
    
    const afterPositions = takeSnapshot(await client.getState(), 'after_positions');
    displaySnapshot(afterPositions);

    // Move price to $50k to trigger Eve's liquidation
    console.log('📈 Moving price to trigger liquidation...');
    await client.updateMarkPrice(50000);
    
    const afterLiquidation = takeSnapshot(await client.getState(), 'after_liquidation');
    displaySnapshot(afterLiquidation);

    // Execute ADL
    console.log('🎯 Executing ADL...');
    await client.executeLiquidationStep('adl');
    
    const afterADL = takeSnapshot(await client.getState(), 'after_adl');
    displaySnapshot(afterADL);

    // Analysis
    console.log('📊 ANALYSIS:');
    
    const analysis1 = analyzeBalanceChange(initial, afterPositions, 'initial → after_positions');
    const analysis2 = analyzeBalanceChange(afterPositions, afterLiquidation, 'after_positions → after_liquidation');
    const analysis3 = analyzeBalanceChange(afterLiquidation, afterADL, 'after_liquidation → after_adl');
    const analysis4 = analyzeBalanceChange(initial, afterADL, 'initial → after_adl');

    // Summary
    console.log('🎯 BALANCE CONSERVATION SUMMARY:');
    console.log(`  Position Creation: ${analysis1.conserved ? '✅ CONSERVED' : '❌ VIOLATED'} (${formatCurrency(analysis1.totalChange)})`);
    console.log(`  Liquidation: ${analysis2.conserved ? '✅ CONSERVED' : '❌ VIOLATED'} (${formatCurrency(analysis2.totalChange)})`);
    console.log(`  ADL: ${analysis3.conserved ? '✅ CONSERVED' : '❌ VIOLATED'} (${formatCurrency(analysis3.totalChange)})`);
    console.log(`  Overall: ${analysis4.conserved ? '✅ CONSERVED' : '❌ VIOLATED'} (${formatCurrency(analysis4.totalChange)})`);
    
    if (!analysis4.conserved) {
      console.log();
      console.log('🚨 BALANCE CONSERVATION VIOLATION DETECTED!');
      console.log(`   System lost/gained: ${formatCurrency(analysis4.totalChange)}`);
      console.log('   This indicates a bug in the margin/balance handling.');
    }

    // Verify overall system conservation with assertions
    expect(Math.abs(analysis4.totalChange)).toBeLessThan(1); // Allow small rounding errors
    console.log('✅ Test completed');
  }, 30000); // 30 second timeout for complex test
});