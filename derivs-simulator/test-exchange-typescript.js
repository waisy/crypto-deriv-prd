const { TestServerManager, TestWebSocketClient } = require('./test-helpers');

describe('TypeScript Exchange Conversion', () => {
  let serverManager;
  let client;

  beforeAll(async () => {
    serverManager = TestServerManager.getInstance();
    await serverManager.startServer();
  }, 35000);

  beforeEach(async () => {
    client = new TestWebSocketClient();
    await client.connect();
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
    }
  });

  test('should instantiate TypeScript Exchange class', async () => {
    console.log('🧪 TypeScript Exchange Instantiation Test');
    console.log('========================================');

    // Test that we can get state from the exchange
    const state = await client.getState();
    expect(state).toBeDefined();
    expect(state.users).toBeDefined();
    expect(state.positions).toBeDefined();
    expect(state.markPrice).toBeDefined();
    expect(state.insuranceFund).toBeDefined();
    
    // Verify users are initialized correctly
    expect(state.users.bob).toBeDefined();
    expect(state.users.eve).toBeDefined();
    expect(state.users.alice).toBeDefined();
    expect(state.users.bob.totalBalance).toBe(100000);
    
    // Verify initial state
    expect(state.positions).toHaveLength(0);
    expect(state.liquidationPositions).toHaveLength(0);
    expect(state.markPrice).toBe(50000);
    expect(state.insuranceFund).toBe(1000000);
    
    console.log('✅ TypeScript Exchange class instantiated successfully');
    console.log('✅ Basic state retrieval works');
    console.log('✅ All initial values are correct');
  });

  test('should handle unknown message types gracefully', async () => {
    console.log('🧪 TypeScript Exchange Error Handling Test');
    console.log('========================================');

    // Send an unknown message type
    const response = await client.sendMessage({
      type: 'unknown_message_type',
      data: 'test'
    });

    expect(response.success).toBe(false);
    expect(response.error).toContain('Unknown message type');
    
    console.log('✅ Unknown message types handled gracefully');
  });
}); 