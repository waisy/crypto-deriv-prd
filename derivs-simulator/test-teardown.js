const { TestServerManager } = require('./test-helpers');

module.exports = async () => {
  console.log('🧹 Global test teardown starting...');
  
  try {
    await TestServerManager.cleanup();
    console.log('✅ Test server cleanup completed');
  } catch (error) {
    console.error('❌ Error during test cleanup:', error.message);
  }
  
  console.log('🏁 Test suite completed');
}; 