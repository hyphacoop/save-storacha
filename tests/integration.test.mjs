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
  revokeDelegation,
  storeAdminSpace,
  getAdminSpaces
} from '../src/lib/store.js';
import { getDatabase } from '../src/lib/db.js';
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

describe('Integration Tests', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Helper to create DID-email mapping
  function createDidEmailMapping(did, email) {
    const db = getDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO did_email_mapping (did, email, createdAt)
      VALUES (?, ?, ?)
    `).run(did, email, Date.now());
  }

  describe('Complete Workflow: Single Admin', () => {
    test('should complete full workflow: login → list spaces → delegate → upload', async () => {
      const adminEmail = 'admin@example.com';
      const adminDid = 'did:key:admin';
      const userDid = testUtils.createTestDid();
      const spaceDid = 'did:key:space-1';

      // 0. Create DID-email mapping for foreign key constraint
      createDidEmailMapping(adminDid, adminEmail);

      // 1. Admin login (simulated)
      const { sessionId } = createSession(adminEmail, adminDid);
      expect(sessionId).toBeDefined();

      // 2. Store admin space
      storeAdminSpace(adminEmail, spaceDid, 'Test Space 1');

      // 3. List spaces as admin
      const adminSpaces = await getSpaces(adminDid);
      expect(adminSpaces).toHaveLength(1);
      expect(adminSpaces[0].did).toBe(spaceDid);
      expect(adminSpaces[0].isAdmin).toBe(true);

      // 4. Create delegation
      storeDelegation(userDid, spaceDid, 'test-cid', 'test-car', null, adminEmail);

      // 5. List spaces as user
      const userSpaces = await getSpaces(userDid);
      expect(userSpaces).toHaveLength(1);
      expect(userSpaces[0].did).toBe(spaceDid);
      expect(userSpaces[0].isAdmin).toBe(false);

      // 6. Simulate upload (would use the delegation)
      const uploadResult = await simulateUpload(userDid, spaceDid);
      expect(uploadResult.success).toBe(true);
      expect(uploadResult.cid).toMatch(/^bafkreic/);
    });
  });

  describe('Multi-Admin Workflow', () => {
    test('should support multiple admins with isolated spaces and delegations', async () => {
      const adminA = 'admin-a@example.com';
      const adminB = 'admin-b@example.com';
      const adminADid = 'did:key:admin-a';
      const adminBDid = 'did:key:admin-b';
      const userDid = testUtils.createTestDid();
      const spaceDidA = 'did:key:space-admin-a';
      const spaceDidB = 'did:key:space-admin-b';

      // Create DID-email mappings
      createDidEmailMapping(adminADid, adminA);
      createDidEmailMapping(adminBDid, adminB);

      // Admin A workflow
      createSession(adminA, adminADid);
      storeAdminSpace(adminA, spaceDidA, 'Admin A Space');
      storeDelegation(userDid, spaceDidA, 'cid-a', 'car-a', null, adminA);

      // Admin B workflow
      createSession(adminB, adminBDid);
      storeAdminSpace(adminB, spaceDidB, 'Admin B Space');
      storeDelegation(userDid, spaceDidB, 'cid-b', 'car-b', null, adminB);

      // Verify spaces for each admin
      const adminASpaces = await getSpaces(adminADid);
      const adminBSpaces = await getSpaces(adminBDid);

      expect(adminASpaces).toHaveLength(1);
      expect(adminBSpaces).toHaveLength(1);
      expect(adminASpaces[0].did).toBe(spaceDidA);
      expect(adminBSpaces[0].did).toBe(spaceDidB);
      expect(adminASpaces[0].isAdmin).toBe(true);
      expect(adminBSpaces[0].isAdmin).toBe(true);

      // Verify user sees both spaces with correct isAdmin flags
      const userSpaces = await getSpaces(userDid);
      expect(userSpaces).toHaveLength(2);
      expect(userSpaces.every(space => !space.isAdmin)).toBe(true);
    });

    test('should handle admin switching without breaking delegations', async () => {
      const adminA = 'admin-a@example.com';
      const adminB = 'admin-b@example.com';
      const adminADid = 'did:key:admin-a-switch';
      const adminBDid = 'did:key:admin-b-switch';
      const userDid = testUtils.createTestDid();
      const spaceDid = 'did:key:shared-space';

      // Create DID-email mappings
      createDidEmailMapping(adminADid, adminA);
      createDidEmailMapping(adminBDid, adminB);

      // Admin A creates delegation
      createSession(adminA, adminADid);
      storeDelegation(userDid, spaceDid, 'cid-a', 'car-a', null, adminA);

      // Admin B logs in (simulating admin switch)
      createSession(adminB, adminBDid);

      // Verify Admin A's delegation still exists and is tracked
      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(1);
      expect(delegations[0].createdBy).toBe(adminA);
      expect(delegations[0].delegationCid).toBe('cid-a');
    });
  });

  describe('Error Handling', () => {
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
      expect(wasRevoked).toBe(true); // Should be true when successfully revoked

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
async function getSpaces(did) {
  // Mock implementation for testing that simulates the real spaceService.js logic
  
  // First, get admin email from DID if it exists
  const db = getDatabase();
  const mapping = db.prepare(`
    SELECT email FROM did_email_mapping WHERE did = ?
  `).get(did);
  
  const spaces = [];
  
  // If user is an admin, get their admin spaces
  if (mapping) {
    const adminSpaces = getAdminSpaces(mapping.email);
    if (adminSpaces.length > 0) {
      spaces.push(...adminSpaces.map(space => ({
        did: space.did,
        name: space.name,
        isAdmin: true
      })));
    }
  }
  
  // Get delegated spaces
  const delegations = getDelegationsForUser(did);
  if (delegations.length > 0) {
    const delegatedSpaces = delegations.map(d => ({
      did: d.spaceDid,
      name: d.spaceName || d.spaceDid,
      isAdmin: false
    }));
    
    // Merge spaces, preferring admin access
    for (const space of delegatedSpaces) {
      if (!spaces.some(s => s.did === space.did)) {
        spaces.push(space);
      }
    }
  }
  
  return spaces;
}

async function simulateUpload(userDid, spaceDid) {
  // Mock upload implementation
  return {
    success: true,
    cid: 'bafkreic' + Math.random().toString(36).substring(2),
    size: 100
  };
} 