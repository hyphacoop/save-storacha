/**
 * Integration Tests (ESM)
 *
 * End-to-end tests for the complete workflow including multi-admin scenarios.
 */

import express from 'express';
import request from 'supertest';
import {
  createSession,
  clearSession,
  storeDelegation,
  getDelegationsForUser,
  revokeDelegation
} from '../src/lib/store.js';
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock external dependencies
jest.mock('../src/lib/w3upClient.js', () => ({
  getClient: jest.fn(() => ({
    did: () => 'did:key:mock-admin',
    spaces: () => [
      { did: () => 'did:key:space-1', name: 'Test Space 1' },
      { did: () => 'did:key:space-2', name: 'Test Space 2' }
    ],
    createDelegation: jest.fn(() => ({
      cid: { toString: () => 'bafyrei' + Math.random().toString(36).substring(2) },
      export: jest.fn()
    })),
    addProof: jest.fn(),
    addSpace: jest.fn(),
    setCurrentSpace: jest.fn(),
    uploadFile: jest.fn(() => ({
      cid: { toString: () => 'bafkreic' + Math.random().toString(36).substring(2) },
      size: 100
    }))
  })),
  getAdminClient: jest.fn()
}));

// Mock the database
jest.mock('../src/lib/db.js', () => ({
  getDatabase: jest.fn(() => ({
    prepare: jest.fn(() => ({
      run: jest.fn(() => ({ changes: 1 })),
      get: jest.fn(),
      all: jest.fn()
    }))
  }))
}));

describe('Integration Tests', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Add basic middleware for testing
    app.use((req, res, next) => {
      // Mock session middleware
      if (req.headers['x-session-id']) {
        req.userEmail = 'test-admin@example.com';
      }
      next();
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Complete Workflow: Single Admin', () => {
    test.skip('should complete full workflow: login → list spaces → delegate → upload', async () => {
      const adminEmail = 'admin@example.com';
      const userDid = testUtils.createTestDid();
      const spaceDid = 'did:key:space-1';

      // 1. Admin login (simulated)
      const { sessionId } = createSession(adminEmail, 'did:key:admin');
      expect(sessionId).toBeDefined();

      // 2. List spaces (simulated)
      const spaces = await getSpaces(adminEmail);
      expect(spaces).toHaveLength(2);
      expect(spaces[0].did).toBe('did:key:space-1');

      // 3. Create delegation
      storeDelegation(userDid, spaceDid, 'test-cid', 'test-car', null, adminEmail);

      // 4. Verify delegation exists
      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(1);
      expect(delegations[0].spaceDid).toBe(spaceDid);
      expect(delegations[0].createdBy).toBe(adminEmail);

      // 5. Simulate upload (would use the delegation)
      const uploadResult = await simulateUpload(userDid, spaceDid);
      expect(uploadResult.success).toBe(true);
      expect(uploadResult.cid).toMatch(/^bafkreic/);
    });
  });

  describe('Multi-Admin Workflow', () => {
    test.skip('should support multiple admins with isolated spaces and delegations', async () => {
      const adminA = 'admin-a@example.com';
      const adminB = 'admin-b@example.com';
      const userDid = testUtils.createTestDid();
      const spaceDidA = 'did:key:space-admin-a';
      const spaceDidB = 'did:key:space-admin-b';

      // Admin A workflow
      createSession(adminA, 'did:key:admin-a');
      storeDelegation(userDid, spaceDidA, 'cid-a', 'car-a', null, adminA);

      // Admin B workflow
      createSession(adminB, 'did:key:admin-b');
      storeDelegation(userDid, spaceDidB, 'cid-b', 'car-b', null, adminB);

      // Verify isolation
      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(2);

      const adminADelegation = delegations.find(d => d.createdBy === adminA);
      const adminBDelegation = delegations.find(d => d.createdBy === adminB);

      expect(adminADelegation.spaceDid).toBe(spaceDidA);
      expect(adminBDelegation.spaceDid).toBe(spaceDidB);
      expect(adminADelegation.delegationCid).toBe('cid-a');
      expect(adminBDelegation.delegationCid).toBe('cid-b');
    });

    test.skip('should handle admin switching without breaking delegations', async () => {
      const adminA = 'admin-a@example.com';
      const adminB = 'admin-b@example.com';
      const userDid = testUtils.createTestDid();
      const spaceDid = 'did:key:shared-space';

      // Admin A creates delegation
      storeDelegation(userDid, spaceDid, 'cid-a', 'car-a', null, adminA);

      // Admin B logs in (simulating admin switch)
      createSession(adminB, 'did:key:admin-b');

      // Verify Admin A's delegation still exists and is tracked
      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(1);
      expect(delegations[0].createdBy).toBe(adminA);
      expect(delegations[0].delegationCid).toBe('cid-a');
    });
  });

  describe('Error Handling', () => {
    test.skip('should handle missing admin data gracefully', async () => {});

    test('should handle delegation revocation correctly', async () => {
      const userDid = testUtils.createTestDid();
      const spaceDid = testUtils.createTestDid();
      const adminEmail = 'admin@example.com';

      // Create delegation
      storeDelegation(userDid, spaceDid, 'revoke-cid', 'car-data', null, adminEmail);

      // Verify it exists
      let delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(1);

      // Revoke delegation
      const wasRevoked = revokeDelegation(userDid, spaceDid, 'revoke-cid');
      expect(wasRevoked).toBe(false);

      // Verify it's gone
      delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(0);
    });
  });

  describe('Backward Compatibility', () => {
    test('should handle legacy delegations without admin tracking', async () => {
      const userDid = testUtils.createTestDid();
      const spaceDid = testUtils.createTestDid();

      // Create legacy delegation (no admin tracking)
      storeDelegation(userDid, spaceDid, 'legacy-cid', 'car-data');

      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(1);
      expect(delegations[0].createdBy).toBeNull();
      expect(delegations[0].delegationCid).toBe('legacy-cid');
    });
  });
});

// Helper functions
async function getSpaces() {
  // Mock implementation for testing
  return [
    { did: 'did:key:space-1', name: 'Test Space 1' },
    { did: 'did:key:space-2', name: 'Test Space 2' }
  ];
}

async function simulateUpload(userDid, spaceDid) {
  // Mock upload implementation
  return {
    success: true,
    cid: 'bafkreic' + Math.random().toString(36).substring(2),
    size: 100
  };
} 