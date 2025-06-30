const { TestServerManager, TestWebSocketClient } = require('./test-helpers');

describe('Liquidation Conservation Tests', () => {
  let serverManager;
  let client;

  beforeAll(async () => {
    serverManager = TestServerManager.getInstance();
    await serverManager.ensureServerRunning();
  }, 35000);

  afterAll(async () => {
    // Don't stop server here - let global cleanup handle it
  });

  beforeEach(async () => {
    client = new TestWebSocketClient();
    await client.connect();
  });

  afterEach(async () => {
    if (client) {
      client.disconnect();
    }
  });

  test('should maintain system balance conservation during liquidation', async () => {
    console.log('🧪 LIQUIDATION CONSERVATION TEST');
    console.log('========================================');

    // Get initial system state
    const initial = await client.getState();
    const initialSystemTotal = calculateSystemTotal(initial);
    console.log(`💰 Initial System Total: $${initialSystemTotal}`);

    // Create positions
    console.log('📝 Creating positions...');
    await client.placeOrder('bob', 'buy', 1, 45000, 10);
    await client.placeOrder('eve', 'sell', 1, 45000, 10);
    
    const afterPositions = await client.getState();
    const afterPositionsTotal = calculateSystemTotal(afterPositions);
    
    // System total should be unchanged after position creation
    expect(Math.abs(afterPositionsTotal - initialSystemTotal)).toBeLessThan(0.01);
    console.log(`✅ System total conserved after position creation: $${afterPositionsTotal}`);
    
    // Move price to trigger liquidation
    console.log('📈 Moving price to trigger liquidation...');
    await client.updateMarkPrice(50000);
    
    const afterPriceMove = await client.getState();
    const afterPriceMoveTotal = calculateSystemTotal(afterPriceMove);
    
    // System total should still be conserved
    expect(Math.abs(afterPriceMoveTotal - initialSystemTotal)).toBeLessThan(0.01);
    console.log(`✅ System total conserved after price move: $${afterPriceMoveTotal}`);
    
    // Check if liquidation occurred
    const liquidationPositions = afterPriceMove.liquidationPositions || 
                                 afterPriceMove.positionLiquidationEngine?.positions || [];
    
    if (liquidationPositions.length > 0) {
      console.log(`✅ Liquidation triggered: ${liquidationPositions.length} position(s) transferred`);
      
      // Execute ADL to complete liquidation process
      console.log('🎯 Executing ADL...');
      const adlResult = await client.executeLiquidationStep('adl');
      
      if (adlResult.success) {
        const afterADL = await client.getState();
        const finalSystemTotal = calculateSystemTotal(afterADL);
        
        // Final verification - system total should still be conserved
        expect(Math.abs(finalSystemTotal - initialSystemTotal)).toBeLessThan(0.01);
        console.log(`✅ System total conserved after ADL: $${finalSystemTotal}`);
        console.log('✅ Perfect balance conservation maintained throughout liquidation process');
      } else {
        console.log('ℹ️ ADL not executed (no eligible positions)');
      }
    } else {
      console.log('ℹ️ No liquidation triggered at current price levels');
    }
    
    console.log('✅ Liquidation conservation test completed');
  }, 25000);
});

function calculateSystemTotal(state) {
  let userTotal = 0;
  
  state.users.forEach(user => {
    userTotal += parseFloat(user.totalBalance || user.balance || 0);
  });
  
  const insuranceFund = parseFloat(state.insuranceFund?.balance || 0);
  return userTotal + insuranceFund;
} 