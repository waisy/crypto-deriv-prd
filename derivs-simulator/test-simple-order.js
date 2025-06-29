const WebSocket = require('ws');

describe('Simple Order Tests', () => {
  test('should successfully place matching orders and create positions', async () => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:3000');
      
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Test timeout'));
      }, 15000);
      
      ws.on('open', async () => {
        console.log('Connected to server');
        
        // Get initial state
        ws.send(JSON.stringify({ type: 'get_state', requestId: 1 }));
      });
      
      ws.on('message', async (data) => {
        try {
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
            console.log('Bob order result:', message.success ? 'SUCCESS' : 'ERROR');
            
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
            console.log('Eve order result:', message.success ? 'SUCCESS' : 'ERROR');
            
            // Get final state
            ws.send(JSON.stringify({ type: 'get_state', requestId: 4 }));
            
          } else if (message.requestId === 4) {
            console.log('Final positions:', message.state.positions.map(p => `${p.userId}: ${p.side} ${p.size} BTC`));
            
            // Verify we have positions
            expect(message.state.positions.length).toBe(2);
            expect(message.state.positions.some(p => p.userId === 'bob' && p.side === 'long')).toBe(true);
            expect(message.state.positions.some(p => p.userId === 'eve' && p.side === 'short')).toBe(true);
            
            clearTimeout(timeout);
            
            // Close connection and wait for it to close completely
            ws.close();
            
            // Wait for close event before resolving
            ws.on('close', () => {
              setTimeout(resolve, 50); // Small delay to ensure cleanup
            });
          }
        } catch (error) {
          clearTimeout(timeout);
          ws.close();
          reject(error);
        }
      });
      
      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error: ${error.message}`));
      });
      
      ws.on('close', () => {
        // Don't log after test completion to avoid Jest warnings
      });
    });
  }, 20000); // 20 second timeout
}); 