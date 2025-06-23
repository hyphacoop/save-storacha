export default {
  // Test environment
  testEnvironment: 'node',
  
  // File extensions to test
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js',
    '**/tests/**/*.test.mjs',
    '**/tests/**/*.spec.mjs',
    '**/tests/**/*.test.cjs',
    '**/tests/**/*.spec.cjs',
    '**/__tests__/**/*.js',
    '**/__tests__/**/*.cjs'
  ],
  
  // Directories to ignore
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/build/'
  ],
  
  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/*.spec.js'
  ],
  
  // Coverage directory
  coverageDirectory: 'coverage',
  
  // Coverage reporters
  coverageReporters: [
    'text',
    'lcov',
    'html'
  ],
  
  // Global setup/teardown for database
  globalSetup: '<rootDir>/tests/_dbSetup.cjs',
  globalTeardown: '<rootDir>/tests/_dbTeardown.cjs',
  
  // Setup files executed after env
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.cjs',
    '<rootDir>/tests/_perTest.cjs'
  ],
  
  // Test timeout
  testTimeout: 30000,
  
  // Verbose output
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Reset modules between tests
  resetModules: true,
  
  // Transform configuration for ES modules
  transform: {},
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$))'
  ],
}; 