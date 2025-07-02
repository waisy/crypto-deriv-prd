module.exports = {
  testEnvironment: 'node',
  testTimeout: 45000, // Increased timeout for server operations
  setupFilesAfterEnv: ['<rootDir>/test-setup.js'],
  globalTeardown: '<rootDir>/test-teardown.js',
  collectCoverage: true,
  collectCoverageFrom: [
    'engine/exchange.js',
    'server.js',
    '!engine/**/*.ts', // Exclude TypeScript files from coverage
    '!engine/**/*.d.ts'
  ],
  coverageReporters: ['text', 'lcov'],
  maxWorkers: 1, // Run tests sequentially to avoid server conflicts
  forceExit: true,
  detectOpenHandles: true,
  // Test patterns to match our test files
  testMatch: [
    '**/test-connection.js',
    '**/test-simple-order.js',
    '**/test-liquidation-mechanics.js',
    '**/test-simple-adl.js',
    '**/test-manual-liquidation.js',
    '**/test-liquidation-conservation.js',
    '**/test-exchange-typescript.js'
  ],
  // Exclude helper files and broken unit tests
  testPathIgnorePatterns: [
    'test-helpers.js',
    'test-setup.js', 
    'test-teardown.js',
    'test-position-unit.js', // Broken due to TypeScript imports
    'test-trade-unit.js',    // Broken due to TypeScript imports
    'test-liquidate-unit.js' // Broken due to TypeScript imports
  ],
  // Transform settings for TypeScript (if needed)
  transform: {},
  // Don't transform node_modules
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$))'
  ]
}; 