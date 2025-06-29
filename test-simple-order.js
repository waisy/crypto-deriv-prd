const WebSocket = require('ws');

async function testSimpleOrder() {
  const ws = new WebSocket('ws://localhost:3000');
  
  ws.on('open', async () => {
    console.log('Connected to server');
    
    // Get initial state
    ws.send(JSON.stringify({ type: 'get_state', requestId: 1 }));
  });
  
  ws.on('message', async (data) => {
    const message = JSON.parse(data);
    console.log('Received:', message.type);
    
    if (message.requestId === 1) {
      console.log('Initial users:', message.state.users.map(u => `${u.id}: $${u.availableBalance}`));
      
      // Place Bob's buy order
      console.log('Placing Bob buy order...');
      ws.send(JSON.stringify({
        type: 'place_order',
        userId: 'bob',
        side: 'buy',
        size: 1,
        price: 45000,
        orderType: 'limit',
        leverage: 10,
        requestId: 2
      }));
      
    } else if (message.requestId === 2) {
      console.log('Bob order result:', message);
      
      // Place Eve's sell order
      console.log('Placing Eve sell order...');
      ws.send(JSON.stringify({
        type: 'place_order',
        userId: 'eve',
        side: 'sell',
        size: 1,
        price: 45000,
        orderType: 'limit',
        leverage: 10,
        requestId: 3
      }));
      
    } else if (message.requestId === 3) {
      console.log('Eve order result:', message);
      
      // Get final state
      ws.send(JSON.stringify({ type: 'get_state', requestId: 4 }));
      
    } else if (message.requestId === 4) {
      console.log('Final positions:', message.state.positions.map(p => `${p.userId}: ${p.side} ${p.size} BTC`));
      ws.close();
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
}

testSimpleOrder(); 