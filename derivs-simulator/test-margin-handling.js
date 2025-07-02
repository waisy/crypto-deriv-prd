const WebSocket = require('ws');

// Test margin handling comprehensively
async function testMarginHandling() {
  console.log('🧪 TESTING MARGIN HANDLING COMPREHENSIVELY');
  console.log('==========================================');

  const ws = new WebSocket('ws://localhost:3000');
  
  await new Promise(resolve => ws.on('open', resolve));
  
  // Helper function to send message and wait for response
  const sendMessage = (message) => {
    return new Promise((resolve) => {
      const messageId = Date.now().toString();
      ws.send(JSON.stringify({ ...message, requestId: messageId }));
      
      const handler = (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.requestId === messageId) {
            ws.removeEventListener('message', handler);
            resolve(response);
          }
        } catch (error) {
          console.log('Received non-JSON message:', data.toString());
        }
      };
      ws.addEventListener('message', handler);
    });
  };

  try {
    // Reset state
    console.log('\n1️⃣ Resetting exchange state...');
    await sendMessage({ type: 'reset_state' });
    console.log('✅ State reset complete');

    // Set mark price
    console.log('\n2️⃣ Setting mark price to $50,000...');
    await sendMessage({ type: 'update_mark_price', price: 50000 });
    console.log('✅ Mark price set');

    // Test 1: Place order and verify margin reservation
    console.log('\n3️⃣ Test 1: Order placement margin reservation');
    console.log('   Placing buy order for 1 BTC at $50,000 with 10x leverage...');
    
    const orderResponse = await sendMessage({
      type: 'place_order',
      userId: 'bob',
      side: 'buy',
      size: 1,
      price: 50000,
      orderType: 'limit',
      leverage: 10
    });
    
    if (orderResponse.success) {
      console.log('✅ Order placed successfully');
    } else {
      console.log('❌ Order placement failed:', orderResponse.error);
      return;
    }

    // Check state after order placement
    const stateAfterOrder = await sendMessage({ type: 'get_state' });
    const bobAfterOrder = stateAfterOrder.data.users.find(u => u.id === 'bob');
    
    console.log('   📊 Bob\'s state after order placement:');
    console.log(`      Available Balance: $${bobAfterOrder.availableBalance}`);
    console.log(`      Used Margin: $${bobAfterOrder.usedMargin}`);
    console.log(`      Total Balance: $${bobAfterOrder.totalBalance}`);
    
    // Verify margin was reserved (available should be 95,000, used should be 5,000)
    const expectedAvailable = 95000;
    const expectedUsed = 5000;
    
    if (parseFloat(bobAfterOrder.availableBalance) === expectedAvailable && 
        parseFloat(bobAfterOrder.usedMargin) === expectedUsed) {
      console.log('✅ Margin reservation correct');
    } else {
      console.log('❌ Margin reservation incorrect');
      console.log(`   Expected: Available=$${expectedAvailable}, Used=$${expectedUsed}`);
      console.log(`   Actual: Available=${bobAfterOrder.availableBalance}, Used=${bobAfterOrder.usedMargin}`);
    }

    // Test 2: Cancel order and verify margin release
    console.log('\n4️⃣ Test 2: Order cancellation margin release');
    console.log('   Canceling the order...');
    
    // Get the order ID from the state
    const orderId = stateAfterOrder.data.orders[0].id;
    const cancelResponse = await sendMessage({
      type: 'cancel_order',
      orderId: orderId
    });
    
    if (cancelResponse.success) {
      console.log('✅ Order canceled successfully');
    } else {
      console.log('❌ Order cancellation failed:', cancelResponse.error);
      return;
    }

    // Check state after cancellation
    const stateAfterCancel = await sendMessage({ type: 'get_state' });
    const bobAfterCancel = stateAfterCancel.data.users.find(u => u.id === 'bob');
    
    console.log('   📊 Bob\'s state after order cancellation:');
    console.log(`      Available Balance: $${bobAfterCancel.availableBalance}`);
    console.log(`      Used Margin: $${bobAfterCancel.usedMargin}`);
    console.log(`      Total Balance: $${bobAfterCancel.totalBalance}`);
    
    // Verify margin was released (should be back to 100,000 available, 0 used)
    if (parseFloat(bobAfterCancel.availableBalance) === 100000 && 
        parseFloat(bobAfterCancel.usedMargin) === 0) {
      console.log('✅ Margin release correct');
    } else {
      console.log('❌ Margin release incorrect');
      console.log(`   Expected: Available=$100000, Used=$0`);
      console.log(`   Actual: Available=${bobAfterCancel.availableBalance}, Used=${bobAfterCancel.usedMargin}`);
    }

    // Test 3: Place orders and execute trade
    console.log('\n5️⃣ Test 3: Trade execution margin handling');
    console.log('   Placing matching buy and sell orders...');
    
    const buyOrder = await sendMessage({
      type: 'place_order',
      userId: 'bob',
      side: 'buy',
      size: 1,
      price: 50000,
      orderType: 'limit',
      leverage: 10
    });
    
    const sellOrder = await sendMessage({
      type: 'place_order',
      userId: 'eve',
      side: 'sell',
      size: 1,
      price: 50000,
      orderType: 'limit',
      leverage: 10
    });
    
    if (buyOrder.success && sellOrder.success) {
      console.log('✅ Orders placed, trade should execute');
    } else {
      console.log('❌ Order placement failed');
      return;
    }

    // Check state after trade
    const stateAfterTrade = await sendMessage({ type: 'get_state' });
    const bobAfterTrade = stateAfterTrade.data.users.find(u => u.id === 'bob');
    const eveAfterTrade = stateAfterTrade.data.users.find(u => u.id === 'eve');
    
    console.log('   📊 State after trade execution:');
    console.log(`   Bob: Available=$${bobAfterTrade.availableBalance}, Used=$${bobAfterTrade.usedMargin}`);
    console.log(`   Eve: Available=$${eveAfterTrade.availableBalance}, Used=$${eveAfterTrade.usedMargin}`);
    
    // Verify no double-counting (used margin should be 5,000 each, not 10,000)
    if (parseFloat(bobAfterTrade.usedMargin) === 5000 && 
        parseFloat(eveAfterTrade.usedMargin) === 5000) {
      console.log('✅ No margin double-counting detected');
    } else {
      console.log('❌ Margin double-counting detected');
      console.log(`   Expected: Used=$5000 each`);
      console.log(`   Actual: Bob=${bobAfterTrade.usedMargin}, Eve=${eveAfterTrade.usedMargin}`);
    }

    // Test 4: Position reduction and margin release
    console.log('\n6️⃣ Test 4: Position reduction margin release');
    console.log('   Placing position-reducing orders...');
    
    const bobReduceOrder = await sendMessage({
      type: 'place_order',
      userId: 'bob',
      side: 'sell',
      size: 0.5,
      price: 50000,
      orderType: 'limit',
      leverage: 10
    });
    
    const eveReduceOrder = await sendMessage({
      type: 'place_order',
      userId: 'eve',
      side: 'buy',
      size: 0.5,
      price: 50000,
      orderType: 'limit',
      leverage: 10
    });
    
    if (bobReduceOrder.success && eveReduceOrder.success) {
      console.log('✅ Position-reducing orders placed');
    } else {
      console.log('❌ Position-reducing order placement failed');
      return;
    }

    // Check state after position reduction
    const stateAfterReduction = await sendMessage({ type: 'get_state' });
    const bobAfterReduction = stateAfterReduction.data.users.find(u => u.id === 'bob');
    const eveAfterReduction = stateAfterReduction.data.users.find(u => u.id === 'eve');
    
    console.log('   📊 State after position reduction:');
    console.log(`   Bob: Available=$${bobAfterReduction.availableBalance}, Used=$${bobAfterReduction.usedMargin}`);
    console.log(`   Eve: Available=$${eveAfterReduction.availableBalance}, Used=$${eveAfterReduction.usedMargin}`);
    
    // Verify margin was released proportionally (should be 2,500 each now)
    if (parseFloat(bobAfterReduction.usedMargin) === 2500 && 
        parseFloat(eveAfterReduction.usedMargin) === 2500) {
      console.log('✅ Position reduction margin release correct');
    } else {
      console.log('❌ Position reduction margin release incorrect');
      console.log(`   Expected: Used=$2500 each`);
      console.log(`   Actual: Bob=${bobAfterReduction.usedMargin}, Eve=${eveAfterReduction.usedMargin}`);
    }

    // Test 5: Full position closure
    console.log('\n7️⃣ Test 5: Full position closure');
    console.log('   Closing remaining positions...');
    
    const bobCloseOrder = await sendMessage({
      type: 'place_order',
      userId: 'bob',
      side: 'sell',
      size: 0.5,
      price: 50000,
      orderType: 'limit',
      leverage: 10
    });
    
    const eveCloseOrder = await sendMessage({
      type: 'place_order',
      userId: 'eve',
      side: 'buy',
      size: 0.5,
      price: 50000,
      orderType: 'limit',
      leverage: 10
    });
    
    if (bobCloseOrder.success && eveCloseOrder.success) {
      console.log('✅ Position closure orders placed');
    } else {
      console.log('❌ Position closure order placement failed');
      return;
    }

    // Check final state
    const finalState = await sendMessage({ type: 'get_state' });
    const bobFinal = finalState.data.users.find(u => u.id === 'bob');
    const eveFinal = finalState.data.users.find(u => u.id === 'eve');
    
    console.log('   📊 Final state after position closure:');
    console.log(`   Bob: Available=$${bobFinal.availableBalance}, Used=$${bobFinal.usedMargin}`);
    console.log(`   Eve: Available=$${eveFinal.availableBalance}, Used=$${eveFinal.usedMargin}`);
    
    // Verify all margin was released
    if (parseFloat(bobFinal.usedMargin) === 0 && 
        parseFloat(eveFinal.usedMargin) === 0) {
      console.log('✅ Full position closure margin release correct');
    } else {
      console.log('❌ Full position closure margin release incorrect');
      console.log(`   Expected: Used=$0 each`);
      console.log(`   Actual: Bob=${bobFinal.usedMargin}, Eve=${eveFinal.usedMargin}`);
    }

    // Verify no positions remain
    if (finalState.data.positions.length === 0) {
      console.log('✅ All positions properly closed');
    } else {
      console.log('❌ Positions still exist:', finalState.data.positions.length);
    }

    console.log('\n🎉 ALL MARGIN HANDLING TESTS COMPLETED');
    console.log('=====================================');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    ws.close();
  }
}

// Run the test
testMarginHandling(); 