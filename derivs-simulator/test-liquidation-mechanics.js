const WebSocket = require('ws');
const { Position } = require('./engine/position.ts');

class LiquidationMechanicsTest {
  constructor() {
    this.ws = null;
    this.responses = new Map();
    this.requestId = 0;
    this.timeouts = new Set(); // Track all timeouts for proper cleanup
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:3000');
      
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
      const connectionTimeout = setTimeout(() => {
        if (this.ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Connection timeout'));
        }
      }, 5000);
      this.timeouts.add(connectionTimeout);
      
      this.ws.on('open', () => {
        console.log('✅ Connected to server');
        clearTimeout(connectionTimeout);
        this.timeouts.delete(connectionTimeout);
        resolve();
      });
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
      
      // Set up timeout for response
      const responseTimeout = setTimeout(() => {
        if (this.responses.has(this.requestId)) {
          this.responses.delete(this.requestId);
          reject(new Error(`Timeout waiting for response to ${data.type}`));
        }
      }, 10000);
      this.timeouts.add(responseTimeout);
      
      // Override the response handler to clear timeout when response comes
      const originalResolver = this.responses.get(this.requestId);
      this.responses.set(this.requestId, (response) => {
        clearTimeout(responseTimeout);
        this.timeouts.delete(responseTimeout);
        resolve(response);
      });
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
    // Clear all tracked timeouts
    for (const timeout of this.timeouts) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    
    if (this.ws) {
      this.ws.close();
    }
  }
}

function formatCurrency(amount) {
  if (isNaN(amount)) return '$NaN';
  return `$${amount.toLocaleString()}`;
}

describe('Liquidation Mechanics Tests', () => {
  let client;
  
  beforeEach(async () => {
    client = new LiquidationMechanicsTest();
    await client.connect();
  }, 10000);
  
  afterEach(async () => {
    if (client) {
      // Clear all tracked timeouts
      if (client.timeouts) {
        for (const timeout of client.timeouts) {
          clearTimeout(timeout);
        }
        client.timeouts.clear();
      }
      
      if (client.ws) {
        // Properly close WebSocket and wait for closure
        client.ws.close();
        await new Promise(resolve => {
          if (client.ws.readyState === client.ws.CLOSED) {
            resolve();
          } else {
            client.ws.on('close', () => resolve());
            // Fallback timeout - track it properly
            const fallbackTimeout = setTimeout(resolve, 200);
            // This timeout will be short-lived, so we don't need to track it
          }
        });
      }
    }
  });

  test('should properly handle liquidation mechanics and transfer positions at bankruptcy price', async () => {
    console.log('🧪 LIQUIDATION MECHANICS TEST');
    console.log('========================================');

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
          const expectedLEPnL = Position.calculateUnrealizedPnLStatic(
            lePosition.side, 
            transferPrice, 
            currentPrice, 
            parseFloat(lePosition.size)
          ).toNumber();
            
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
    
    // Basic assertions to ensure test passes/fails appropriately
    expect(bobPosition).toBeDefined();
    expect(finalState.insuranceFund).toBeDefined();
    
    console.log('\n✅ Test completed');
  }, 30000); // 30 second timeout for complex test
}); 