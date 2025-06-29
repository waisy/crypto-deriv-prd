const WebSocket = require('ws');

async function testConnection() {
  console.log('🔌 Testing WebSocket connection...');
  
  try {
    const ws = new WebSocket('ws://localhost:3000');
    
    ws.on('open', () => {
      console.log('✅ Connected successfully!');
      
      // Send a simple message
      ws.send(JSON.stringify({
        type: 'get_state',
        requestId: 1
      }));
    });
    
    ws.on('message', (data) => {
      console.log('📨 Received message:', JSON.parse(data));
      ws.close();
      process.exit(0);
    });
    
    ws.on('error', (error) => {
      console.error('❌ Connection error:', error.message);
      process.exit(1);
    });
    
    ws.on('close', () => {
      console.log('🔌 Connection closed');
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      console.error('⏰ Connection timeout');
      ws.close();
      process.exit(1);
    }, 5000);
    
  } catch (error) {
    console.error('❌ Failed to create WebSocket:', error.message);
    process.exit(1);
  }
}

testConnection(); 