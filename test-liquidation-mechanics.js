const WebSocket = require('ws');

class LiquidationMechanicsTest {
  constructor() {
    this.ws = null;
    this.responses = new Map();
    this.requestId = 0;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:3000');
      
      this.ws.on('open', () => {
        console.log('✅ Connected to server');
        resolve();
      });
      
      this.ws.on('error', (error) => {
        reject(new Error(`Connection error: ${error.message}`));
      });
      
      this.ws.on('close', () => {
        reject(new Error('Connection closed'));
      });

      this.ws.on('message', (data) => {
        this.handleMessage(JSON.parse(data));
      });

      // Connection timeout
      setTimeout(() => {
        if (this.ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Connection timeout'));
        }
      }, 5000);
    });
  }

  handleMessage(message) {
    if (message.requestId) {
      const resolver = this.responses.get(message.requestId);
      if (resolver) {
        resolver(message);
        this.responses.delete(message.requestId);
      }
    }
  }

  async sendMessage(data) {
    this.requestId++;
    const message = { ...data, requestId: this.requestId };
    
    return new Promise((resolve, reject) => {
      this.responses.set(this.requestId, resolve);
      
      this.ws.send(JSON.stringify(message));
      
      const checkResponse = () => {
        if (this.responses.has(this.requestId)) {
          setTimeout(() => {
            if (this.responses.has(this.requestId)) {
              this.responses.delete(this.requestId);
              reject(new Error(`Timeout waiting for response to ${data.type}`));
            }
          }, 10000);
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
    console.log('✅ Initial state captured');
    
    // Create a position that will be liquidated
    console.log('Creating position for Bob (long 1 BTC at $45k, 10x leverage)...');
    const orderResult = await client.placeOrder('bob', 'buy', 1, 45000, 10);
    
    if (orderResult.matches.length === 0) {
      // Need a counterparty - create Eve's sell order
      console.log('Creating counterparty order for Eve...');
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
        var afterLiquidation = await client.getState();
        const lePositions = afterLiquidation.positionLiquidationEngine.positions;
        
        console.log(`   Liquidation Engine Positions: ${lePositions.length}`);
        if (lePositions.length > 0) {
          const lePosition = lePositions[0];
          console.log(`   LE Position: ${lePosition.side} ${lePosition.size} BTC`);
          console.log(`   LE Position PnL: $${lePosition.unrealizedPnL || 'N/A'}`);
          
          // Test 3: Verify liquidation engine has positive PnL
          console.log();
          console.log('📋 TEST 3: Liquidation Engine Initial PnL');
          console.log('------------------------------------------');
          
          const currentPrice = parseFloat(afterLiquidation.markPrice);
          const transferPrice = expectedBankruptcyPrice;
          const expectedLEPnL = lePosition.side === 'short' ? 
            (transferPrice - currentPrice) * parseFloat(lePosition.size) :
            (currentPrice - transferPrice) * parseFloat(lePosition.size);
            
          console.log(`   Current Mark Price: $${currentPrice}`);
          console.log(`   Transfer Price: $${transferPrice.toFixed(2)}`);
          console.log(`   Expected LE PnL: $${expectedLEPnL.toFixed(2)}`);
          console.log(`   Actual LE PnL: $${lePosition.unrealizedPnL || 'N/A'}`);
          console.log(`   LE Should be Profitable: ${expectedLEPnL > 0 ? '✅' : '❌'}`);
        }
        
        // Test 4: Check for aggressive order placement mechanism
        console.log();
        console.log('📋 TEST 4: Aggressive Order Placement');
        console.log('-------------------------------------');
        
        const orderBook = afterLiquidation.orderBook;
        console.log(`   Order Book Bids: ${orderBook.bids.length}`);
        console.log(`   Order Book Asks: ${orderBook.asks.length}`);
        console.log(`   Total Orders: ${orderBook.totalOrders}`);
        
        const leOrders = [...(orderBook.bids || []), ...(orderBook.asks || [])].filter(o => o.userId === 'liquidation_engine');
        console.log(`   Liquidation Engine Orders: ${leOrders.length}`);
        
        if (leOrders.length === 0) {
          console.log('❌ No aggressive orders placed by liquidation engine');
          console.log('   Expected: Liquidation engine should place orders to flatten position');
        } else {
          console.log('✅ Liquidation engine has placed orders');
          leOrders.forEach((order, i) => {
            console.log(`     ${i+1}. ${order.side} ${order.size} at $${order.price}`);
          });
        }
        
      } else {
        console.log('❌ No liquidation triggered - check liquidation logic');
      }
      
    } else {
      console.log('❌ No position created - check order matching');
      console.log('Available positions:', afterPosition.positions.map(p => `${p.userId}: ${p.side} ${p.size}`));
    }
    
    // Test 5: Insurance fund absorption mechanism
    let finalState;
    try {
      finalState = await client.getState();
    } catch (error) {
      finalState = initial; // fallback to initial state
    }
    console.log();
    console.log('📋 TEST 5: Insurance Fund Loss Absorption');
    console.log('-----------------------------------------');
    
    const insuranceFund = finalState.insuranceFund;
    console.log(`   Insurance Fund Balance: $${insuranceFund.balance}`);
    console.log(`   Insurance Fund At Risk: ${insuranceFund.isAtRisk}`);
    
    // Test 6: ADL mechanism verification
    console.log();
    console.log('📋 TEST 6: ADL Mechanism');
    console.log('------------------------');
    
    const adlQueue = finalState.adlQueue;
    console.log(`   ADL Queue Length: ${adlQueue.length}`);
    
    if (adlQueue.length > 0) {
      console.log('   ADL Queue:');
      adlQueue.forEach((item, index) => {
        console.log(`     ${index + 1}. ${item.userId} - Score: ${item.adlScore}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    client.disconnect();
  }
}

// Run the test
testLiquidationMechanics().then(() => {
  console.log('\n✅ Test completed');
}).catch(error => {
  console.error('\n❌ Test suite failed:', error);
  console.error('Stack trace:', error.stack);
}); 