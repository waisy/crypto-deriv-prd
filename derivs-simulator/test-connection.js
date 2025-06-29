const WebSocket = require('ws');

describe('WebSocket Connection Tests', () => {
  test('should connect to server and receive initial state', async () => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:3000');
      
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timeout'));
      }, 5000);
      
      ws.on('open', () => {
        console.log('✅ Connected successfully!');
        
        // Send a simple message
        ws.send(JSON.stringify({
          type: 'get_state',
          requestId: 1
        }));
      });
      
      let hasResolved = false;
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          console.log('📨 Received message type:', message.type);
          
          // Only process the first valid init message
          if (!hasResolved && message.type === 'init') {
            hasResolved = true;
            clearTimeout(timeout);
            
            // Verify we got a proper response
            expect(message.type).toBe('init');
            expect(message.state).toBeDefined();
            expect(message.state.users).toBeDefined();
            
            // Close connection and wait for it to close completely
            ws.close();
            
            // Wait for close event before resolving
            ws.on('close', () => {
              setTimeout(resolve, 50); // Small delay to ensure cleanup
            });
          }
          
        } catch (error) {
          if (!hasResolved) {
            hasResolved = true;
            clearTimeout(timeout);
            ws.close();
            reject(error);
          }
        }
      });
      
      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Connection error: ${error.message}`));
      });
      
      ws.on('close', () => {
        // Don't log after test completion to avoid Jest warnings
      });
    });
  }, 10000); // 10 second timeout for Jest
}); 