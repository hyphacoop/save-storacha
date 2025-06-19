/**
 * Jest Test Setup
 * 
 * This file configures the test environment and provides global test utilities.
 * It runs before each test file.
 */

// Global test timeout
jest.setTimeout(30000);

// Global test utilities
global.testUtils = {
  // Helper to create test DIDs
  createTestDid: () => `did:key:z6Mk${Math.random().toString(36).substring(2, 15)}`,
  
  // Helper to create test admin email
  createTestEmail: () => `test-${Date.now()}@example.com`,
  
  // Helper to wait for async operations
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Helper to create test file data
  createTestFile: (content = 'test content') => ({
    originalname: 'test.txt',
    buffer: Buffer.from(content),
    size: content.length
  })
};

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Global test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3001'; // Use different port for tests 