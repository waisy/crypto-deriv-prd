const WebSocket = require('ws');

async function testEquityCalculation() {
  console.log('🧪 TESTING EQUITY CALCULATION WITH UNREALIZED P&L');
  console.log('='.repeat(60));
  
  const ws = new WebSocket('ws://localhost:3000');
  
  await new Promise(resolve => ws.on('open', resolve));
  
  // Helper function to send message and wait for response
  const sendMessage = (message) => {
    return new Promise((resolve) => {
      ws.send(JSON.stringify(message));
      ws.once('message', (data) => {
        const response = JSON.parse(data.toString());
        resolve(response);
      });
    });
  };
  
  try {
    // 1. Reset state
    console.log('1. Resetting exchange state...');
    await sendMessage({ type: 'reset_state' });
    
    // 2. Set mark price to $45,000
    console.log('2. Setting mark price to $45,000...');
    await sendMessage({ type: 'update_mark_price', price: 45000 });
    
    // 3. Create positions (Bob long, Eve short)
    console.log('3. Creating positions...');
    await sendMessage({
      type: 'place_order',
      userId: 'bob',
      side: 'buy',
      size: 1,
      price: 45000,
      orderType: 'limit',
      leverage: 2
    });
    
    await sendMessage({
      type: 'place_order',
      userId: 'eve',
      side: 'sell',
      size: 1,
      price: 45000,
      orderType: 'limit',
      leverage: 2
    });
    
    // 4. Get state after position creation
    console.log('4. State after position creation:');
    const state1 = await sendMessage({ type: 'get_state' });
    const bob1 = state1.state.users.find(u => u.id === 'bob');
    const eve1 = state1.state.users.find(u => u.id === 'eve');
    
    console.log(`   Bob: Balance $${bob1.totalBalance}, Unrealized P&L $${bob1.unrealizedPnL}, Equity $${bob1.equity}`);
    console.log(`   Eve: Balance $${eve1.totalBalance}, Unrealized P&L $${eve1.unrealizedPnL}, Equity $${eve1.equity}`);
    
    // 5. Move price to $46,000 (create P&L)
    console.log('5. Moving price to $46,000...');
    await sendMessage({ type: 'update_mark_price', price: 46000 });
    
    // 6. Get state after price move
    console.log('6. State after price move:');
    const state2 = await sendMessage({ type: 'get_state' });
    const bob2 = state2.state.users.find(u => u.id === 'bob');
    const eve2 = state2.state.users.find(u => u.id === 'eve');
    
    console.log(`   Bob: Balance $${bob2.totalBalance}, Unrealized P&L $${bob2.unrealizedPnL}, Equity $${bob2.equity}`);
    console.log(`   Eve: Balance $${eve2.totalBalance}, Unrealized P&L $${eve2.unrealizedPnL}, Equity $${eve2.equity}`);
    
    // 7. Verify equity calculation
    console.log('7. Equity calculation verification:');
    const bobExpectedEquity = parseFloat(bob2.totalBalance) + parseFloat(bob2.unrealizedPnL);
    const eveExpectedEquity = parseFloat(eve2.totalBalance) + parseFloat(eve2.unrealizedPnL);
    
    console.log(`   Bob: Expected Equity = $${bob2.totalBalance} + $${bob2.unrealizedPnL} = $${bobExpectedEquity}`);
    console.log(`   Bob: Actual Equity = $${bob2.equity}`);
    console.log(`   Eve: Expected Equity = $${eve2.totalBalance} + $${eve2.unrealizedPnL} = $${eveExpectedEquity}`);
    console.log(`   Eve: Actual Equity = $${eve2.equity}`);
    
    // 8. Check if equity calculation is correct
    const bobEquityCorrect = Math.abs(bobExpectedEquity - parseFloat(bob2.equity)) < 0.01;
    const eveEquityCorrect = Math.abs(eveExpectedEquity - parseFloat(eve2.equity)) < 0.01;
    
    console.log(`\n📊 RESULTS:`);
    console.log(`   Bob equity calculation: ${bobEquityCorrect ? '✅ CORRECT' : '❌ INCORRECT'}`);
    console.log(`   Eve equity calculation: ${eveEquityCorrect ? '✅ CORRECT' : '❌ INCORRECT'}`);
    
    if (bobEquityCorrect && eveEquityCorrect) {
      console.log('🎉 EQUITY CALCULATION IS WORKING CORRECTLY!');
    } else {
      console.log('🚨 EQUITY CALCULATION NEEDS FIXING!');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    ws.close();
  }
}

testEquityCalculation(); 