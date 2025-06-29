const WebSocket = require('ws');

class LiquidationMechanicsTest {
  constructor() {
    this.ws = null;
    this.requestId = 0;
    this.responses = new Map();
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
        reject(error);
      });
      
      this.ws.on('message', (data) => this.handleMessage(JSON.parse(data)));
    });
  }

  handleMessage(message) {
    if (message.requestId) {
      this.responses.set(message.requestId, message);
    }
  }

  async sendMessage(data) {
    const requestId = ++this.requestId;
    const message = { ...data, requestId };
    
    this.ws.send(JSON.stringify(message));
    
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

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

function formatCurrency(amount) {
  if (isNaN(amount)) return '$NaN';
  return `$${amount.toLocaleString()}`;
}

async function testLiquidationMechanics() {
  console.log('🧪 LIQUIDATION MECHANICS TEST');
  console.log('========================================');
  console.log();

  const client = new LiquidationMechanicsTest();
  
  try {
    await client.connect();
    
    // Test 1: Verify position transfer happens at bankruptcy price
    console.log('📋 TEST 1: Position Transfer at Bankruptcy Price');
    console.log('------------------------------------------------');
    
    const initial = await client.getState();
    console.log('Initial state captured');
    
    // Create a position that will be liquidated
    console.log('Creating position for bob (long 1 BTC at $45k, 10x leverage)...');
    const orderResult = await client.placeOrder('bob', 'buy', 1, 45000, 10);
    
    if (orderResult.matches.length === 0) {
      // Need a counterparty - create eves's sell order
      console.log('Creating counterparty order for eve...');
      await client.placeOrder('eve', 'sell', 1, 45000, 10);
    }
    
    const afterPosition = await client.getState();
    const bobPosition = afterPosition.positions.find(p => p.userId === 'bob');
    
    if (bobPosition) {
      console.log(`✅ Position created: ${bobPosition.side} ${bobPosition.size} BTC at $${bobPosition.avgEntryPrice}`);
      console.log(`   Liquidation Price: $${bobPosition.liquidationPrice}`);
      console.log(`   Bankruptcy Price: ${bobPosition.bankruptcyPrice || 'NOT AVAILABLE'}`);
      
      // Calculate expected bankruptcy price
      const entryPrice = parseFloat(bobPosition.avgEntryPrice);
      const leverage = bobPosition.leverage;
      const expectedBankruptcyPrice = entryPrice * (1 - 1/leverage);
      console.log(`   Expected Bankruptcy Price: $${expectedBankruptcyPrice.toFixed(2)}`);
      
      // Test 2: Trigger liquidation and verify transfer price
      console.log();
      console.log('📋 TEST 2: Liquidation Trigger and Transfer Price');
      console.log('------------------------------------------------');
      
      const liquidationPrice = parseFloat(bobPosition.liquidationPrice);
      const triggerPrice = liquidationPrice - 100; // Breach liquidation price
      
      console.log(`Moving price to $${triggerPrice} to trigger liquidation...`);
      const liquidationResult = await client.updateMarkPrice(triggerPrice);
      
      if (liquidationResult.liquidations && liquidationResult.liquidations.length > 0) {
        const liquidation = liquidationResult.liquidations[0];
        console.log('✅ Liquidation triggered!');
        console.log(`   Execution Price: $${liquidation.executionPrice}`);
        console.log(`   Expected (Bankruptcy): $${expectedBankruptcyPrice.toFixed(2)}`);
        console.log(`   Price Match: ${Math.abs(parseFloat(liquidation.executionPrice) - expectedBankruptcyPrice) < 1 ? '✅' : '❌'}`);
        
        // Check liquidation engine state
        const afterLiquidation = await client.getState();
        const lePositions = afterLiquidation.positionLiquidationEngine.positions;
        
        console.log(`   Liquidation Engine Positions: ${lePositions.length}`);
        if (lePositions.length > 0) {
          // Find the most recent liquidation engine position (highest ID or most recent transfer time)
          const lePosition = lePositions.reduce((latest, current) => {
            return current.id > latest.id ? current : latest;
          });
          
          console.log(`   LE Position: ${lePosition.side} ${lePosition.size} BTC (ID: ${lePosition.id})`);
          console.log(`   LE Position Entry Price: $${lePosition.entryPrice || 'N/A'}`);
          console.log(`   LE Position PnL: $${lePosition.unrealizedPnL || 'N/A'}`);
          
          // Test 3: Verify liquidation engine has correct PnL
          console.log();
          console.log('📋 TEST 3: Liquidation Engine Initial PnL');
          console.log('------------------------------------------');
          
          const currentPrice = parseFloat(afterLiquidation.markPrice);
          const actualEntryPrice = parseFloat(lePosition.entryPrice || lePosition.avgEntryPrice || 0);
          const expectedLEPnL = lePosition.side === 'long' ? 
            (currentPrice - actualEntryPrice) * parseFloat(lePosition.size) :
            (actualEntryPrice - currentPrice) * parseFloat(lePosition.size);
            
          console.log(`   Current Mark Price: $${currentPrice}`);
          console.log(`   LE Entry Price: $${actualEntryPrice.toFixed(2)}`);
          console.log(`   Expected LE PnL: $${expectedLEPnL.toFixed(2)}`);
          console.log(`   Actual LE PnL: $${lePosition.unrealizedPnL || 'N/A'}`);
          console.log(`   PnL Match: ${Math.abs(parseFloat(lePosition.unrealizedPnL || 0) - expectedLEPnL) < 1 ? '✅' : '❌'}`);
        }
      } else {
        console.log('❌ No liquidation triggered - check liquidation logic');
      }
      
      // Test 4: Check for aggressive order placement mechanism
      console.log();
      console.log('📋 TEST 4: Aggressive Order Placement');
      console.log('-------------------------------------');
      
      const orderBook = afterLiquidation.orderBook;
      console.log(`   Order Book Bids: ${orderBook.bids.length}`);
      console.log(`   Order Book Asks: ${orderBook.asks.length}`);
      console.log(`   Liquidation Engine Orders: ${orderBook.bids.filter(o => o.userId === 'liquidation_engine').length + orderBook.asks.filter(o => o.userId === 'liquidation_engine').length}`);
      
      if (orderBook.bids.length === 0 && orderBook.asks.length === 0) {
        console.log('❌ No aggressive orders placed by liquidation engine');
        console.log('   Expected: Liquidation engine should place orders to flatten position');
      }
      
    } else {
      console.log('❌ No position created - check order matching');
    }
    
    // Test 5: Insurance fund absorption mechanism
    console.log();
    console.log('📋 TEST 5: Insurance Fund Loss Absorption');
    console.log('-----------------------------------------');
    
    const insuranceFund = afterLiquidation.insuranceFund;
    console.log(`   Insurance Fund Balance: $${insuranceFund.balance}`);
    console.log(`   Insurance Fund At Risk: ${insuranceFund.isAtRisk}`);
    
    // Test 6: ADL mechanism verification
    console.log();
    console.log('📋 TEST 6: ADL Mechanism');
    console.log('------------------------');
    
    const adlQueue = afterLiquidation.adlQueue;
    console.log(`   ADL Queue Length: ${adlQueue.length}`);
    
    if (adlQueue.length > 0) {
      console.log('   ADL Queue:');
      adlQueue.forEach((item, index) => {
        console.log(`     ${index + 1}. ${item.userId} - Score: ${item.adlScore}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    client.disconnect();
  }
}

// Run the test
testLiquidationMechanics().then(() => {
  console.log('\n✅ Test completed');
}).catch(error => {
  console.error('\n❌ Test suite failed:', error);
}); 