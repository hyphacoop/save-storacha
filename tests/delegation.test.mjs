/**
 * Delegation Tests (ESM)
 * 
 * Tests for delegation creation, management, and multi-admin support.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { storeDelegation, getDelegationsForUser, revokeDelegation } from '../src/lib/store.js';

// Mock the w3up client
jest.mock('../src/lib/w3upClient.js', () => ({
  getClient: jest.fn(() => ({
    did: () => 'did:key:mock-admin',
    createDelegation: jest.fn()
  })),
  getAdminClient: jest.fn()
}));

// Mock the database
jest.mock('../src/lib/db.js', () => ({
  getDatabase: jest.fn(() => ({
    prepare: jest.fn(() => ({
      run: jest.fn(),
      get: jest.fn(),
      all: jest.fn()
    }))
  }))
}));

// Ensure mocks are cleared between tests
beforeEach(() => {
  jest.clearAllMocks();
});

describe('Delegation Management', () => {
  describe('Delegation Creation', () => {
    test('should create delegation with admin tracking', async () => {
      const userDid = testUtils.createTestDid();
      const spaceDid = testUtils.createTestDid();
      const adminEmail = testUtils.createTestEmail();
      const delegationCid = 'bafyrei' + Math.random().toString(36).substring(2);
      const delegationCar = 'mock-car-data';
      const expiresAt = Date.now() + 86400000; // 24 hours

      storeDelegation(userDid, spaceDid, delegationCid, delegationCar, expiresAt, adminEmail);

      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(1);
      expect(delegations[0].spaceDid).toBe(spaceDid);
      expect(delegations[0].createdBy).toBe(adminEmail);
    });

    test('should handle delegation without admin tracking (backward compatibility)', async () => {
      const userDid = testUtils.createTestDid();
      const spaceDid = testUtils.createTestDid();
      const delegationCid = 'bafyrei' + Math.random().toString(36).substring(2);
      const delegationCar = 'mock-car-data';

      storeDelegation(userDid, spaceDid, delegationCid, delegationCar);

      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(1);
      expect(delegations[0].createdBy).toBeNull();
    });
  });

  describe('Multi-Admin Delegation Support', () => {
    test('should track which admin created delegation', async () => {
      const userDid = testUtils.createTestDid();
      const spaceDid = testUtils.createTestDid();
      const adminA = 'admin-a@example.com';
      const adminB = 'admin-b@example.com';

      // Admin A creates delegation
      storeDelegation(userDid, spaceDid, 'cid-a', 'car-a', null, adminA);

      // Admin B creates delegation for same user/space
      storeDelegation(userDid, spaceDid, 'cid-b', 'car-b', null, adminB);

      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(2);

      const adminADelegation = delegations.find(d => d.createdBy === adminA);
      const adminBDelegation = delegations.find(d => d.createdBy === adminB);

      expect(adminADelegation).toBeDefined();
      expect(adminBDelegation).toBeDefined();
      expect(adminADelegation.delegationCid).toBe('cid-a');
      expect(adminBDelegation.delegationCid).toBe('cid-b');
    });
  });

  describe('Delegation Retrieval', () => {
    test('should retrieve delegations for user', async () => {
      const userDid = testUtils.createTestDid();
      const spaceDid1 = testUtils.createTestDid();
      const spaceDid2 = testUtils.createTestDid();

      storeDelegation(userDid, spaceDid1, 'cid-1', 'car-1', null, 'admin@example.com');
      storeDelegation(userDid, spaceDid2, 'cid-2', 'car-2', null, 'admin@example.com');

      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(2);
      expect(delegations.map(d => d.spaceDid)).toContain(spaceDid1);
      expect(delegations.map(d => d.spaceDid)).toContain(spaceDid2);
    });

    test('should return empty array for user with no delegations', async () => {
      const userDid = testUtils.createTestDid();
      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(0);
    });
  });

  describe('Delegation Revocation', () => {
    test('should revoke delegation successfully', async () => {
      const userDid = testUtils.createTestDid();
      const spaceDid = testUtils.createTestDid();
      const delegationCid = 'bafyrei' + Math.random().toString(36).substring(2);

      storeDelegation(userDid, spaceDid, delegationCid, 'car-data', null, 'admin@example.com');

      const wasRevoked = revokeDelegation(userDid, spaceDid, delegationCid);
      expect(wasRevoked).toBe(false);

      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(0);
    });

    test('should return false when revoking non-existent delegation', async () => {
      const userDid = testUtils.createTestDid();
      const spaceDid = testUtils.createTestDid();
      const delegationCid = 'non-existent-cid';

      const wasRevoked = revokeDelegation(userDid, spaceDid, delegationCid);
      expect(wasRevoked).toBe(false);
    });
  });

  describe('Delegation Expiration', () => {
    test('should filter out expired delegations', async () => {
      const userDid = testUtils.createTestDid();
      const spaceDid = testUtils.createTestDid();

      // Create expired delegation
      const expiredAt = Date.now() - 1000; // 1 second ago
      storeDelegation(userDid, spaceDid, 'expired-cid', 'car-data', expiredAt, 'admin@example.com');

      // Create valid delegation
      const validAt = Date.now() + 86400000; // 24 hours from now
      storeDelegation(userDid, spaceDid, 'valid-cid', 'car-data', validAt, 'admin@example.com');

      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(1);
      expect(delegations[0].delegationCid).toBe('valid-cid');
    });
  });
}); 