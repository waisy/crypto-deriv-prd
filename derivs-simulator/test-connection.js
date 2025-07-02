const { TestServerManager, TestWebSocketClient } = require('./test-helpers');

describe('Connection Tests', () => {
  let serverManager;

  beforeAll(async () => {
    serverManager = TestServerManager.getInstance();
    await serverManager.ensureServerRunning();
  }, 35000);

  afterAll(async () => {
    // Don't stop server here - let global cleanup handle it
  });

  test('should connect to WebSocket server and receive responses', async () => {
    console.log('🧪 Connection Test');
    console.log('========================================');

    const client = new TestWebSocketClient();
    
    try {
      await client.connect();
      console.log('✅ Connected to server');
      
      // Test basic state request
      const state = await client.getState();
      expect(state).toBeDefined();
      expect(state.users).toBeDefined();
      expect(typeof state.users).toBe('object');
      
      console.log('✅ State request successful');
      console.log('✅ Connection test passed');
      
    } finally {
      client.disconnect();
    }
  }, 15000);
}); 