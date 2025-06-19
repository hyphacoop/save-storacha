# Test Suite Documentation

## Overview

This test suite provides comprehensive testing for the Storacha token service, including multi-admin support, delegation management, and complete workflow validation.

## Test Organization

### **Unit Tests**
- **`auth.test.js`** - Authentication and session management
- **`delegation.test.js`** - Delegation creation, management, and revocation
- **`multi-admin.test.js`** - Multi-admin client management and isolation

### **Integration Tests**
- **`integration.test.js`** - End-to-end workflow testing including multi-admin scenarios

## Running Tests

### **All Tests**
```bash
npm test
```

### **Watch Mode (Development)**
```bash
npm run test:watch
```

### **With Coverage**
```bash
npm run test:coverage
```

### **Verbose Output**
```bash
npm run test:verbose
```

### **Specific Test Files**
```bash
# Run only authentication tests
npm test -- tests/auth.test.js

# Run only multi-admin tests
npm test -- tests/multi-admin.test.js

# Run tests matching a pattern
npm test -- --testNamePattern="should create delegation"
```

## Test Structure

### **Test Utilities**
Global test utilities are available in all tests:

```javascript
// Create test DIDs
const userDid = testUtils.createTestDid();

// Create test admin emails
const adminEmail = testUtils.createTestEmail();

// Create test file data
const testFile = testUtils.createTestFile('test content');

// Wait for async operations
await testUtils.wait(100);
```

### **Mocking Strategy**
- **External Dependencies**: w3up client, database connections
- **Internal Services**: Auth service, space service
- **Network Calls**: HTTP requests to external APIs

### **Test Categories**

#### **Authentication Tests**
- Session creation and validation
- Admin login flows
- Session expiration handling

#### **Delegation Tests**
- Delegation creation with admin tracking
- Multi-admin delegation isolation
- Delegation revocation
- Expiration handling

#### **Multi-Admin Tests**
- Admin client management
- Space isolation per admin
- Delegation tracking by admin
- Error handling

#### **Integration Tests**
- Complete workflow validation
- Multi-admin scenarios
- Backward compatibility
- Error handling

## Test Data Management

### **Isolation**
Each test runs in isolation with:
- Fresh mocks for each test
- Cleaned up test data
- Reset module state

### **Test Data**
- Generated DIDs and emails for each test
- Mock delegation CARs and CIDs
- Simulated file uploads

## Coverage Goals

- **Unit Tests**: 90%+ coverage for core functions
- **Integration Tests**: Complete workflow coverage
- **Multi-Admin**: Full multi-admin scenario coverage

## Adding New Tests

### **Unit Test Template**
```javascript
describe('Feature Name', () => {
  beforeEach(() => {
    // Setup
  });
  
  afterEach(() => {
    // Cleanup
  });
  
  test('should do something specific', async () => {
    // Arrange
    const input = testUtils.createTestDid();
    
    // Act
    const result = await functionUnderTest(input);
    
    // Assert
    expect(result).toBeDefined();
  });
});
```

### **Integration Test Template**
```javascript
describe('Feature Integration', () => {
  test('should complete full workflow', async () => {
    // 1. Setup
    const adminEmail = testUtils.createTestEmail();
    
    // 2. Execute workflow
    const result = await completeWorkflow(adminEmail);
    
    // 3. Verify results
    expect(result.success).toBe(true);
  });
});
```

## Debugging Tests

### **Verbose Output**
```bash
npm run test:verbose
```

### **Single Test Debug**
```bash
npm test -- --testNamePattern="specific test name" --verbose
```

### **Debug Mode**
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Continuous Integration

Tests are configured to run in CI environments with:
- Parallel test execution
- Coverage reporting
- Fail fast on errors
- Timeout handling

## Best Practices

1. **Test Isolation**: Each test should be independent
2. **Descriptive Names**: Test names should clearly describe what they test
3. **Arrange-Act-Assert**: Structure tests with clear sections
4. **Mock External Dependencies**: Don't rely on external services
5. **Test Edge Cases**: Include error conditions and boundary cases
6. **Maintain Test Data**: Keep test data realistic but minimal 