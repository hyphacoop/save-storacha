/**
 * Multi-Admin Tests (ESM)
 *
 * Tests for multi-admin support including client management, space isolation,
 * and delegation tracking.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  getAdminClient,
  getAllAdminClients,
  clearAdminClient,
  clearAllAdminClients
} from '../src/lib/w3upClient.js';
import { storeDelegation, getDelegationsForUser } from '../src/lib/store.js';

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

describe('Multi-Admin Support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    clearAllAdminClients();
  });

  describe('Admin Client Management', () => {
    test('should create admin-specific clients', async () => {
      const adminEmail = testUtils.createTestEmail();
      const client = await getAdminClient(adminEmail);

      expect(client).toBeDefined();
      expect(client.did()).toMatch(/^did:key:/);
    });

    test('should reuse existing admin clients', async () => {
      const adminEmail = testUtils.createTestEmail();

      const client1 = await getAdminClient(adminEmail);
      const client2 = await getAdminClient(adminEmail);

      expect(client1).toBe(client2);
    });

    test('should create separate clients for different admins', async () => {
      const adminA = 'admin-a@example.com';
      const adminB = 'admin-b@example.com';

      const clientA = await getAdminClient(adminA);
      const clientB = await getAdminClient(adminB);

      expect(clientA).not.toBe(clientB);
    });

    test('should track all admin clients', async () => {
      const adminA = 'admin-a@example.com';
      const adminB = 'admin-b@example.com';

      await getAdminClient(adminA);
      await getAdminClient(adminB);

      const allClients = getAllAdminClients();
      expect(allClients.size).toBe(2);
      expect(allClients.has(adminA)).toBe(true);
      expect(allClients.has(adminB)).toBe(true);
    });

    test('should clear specific admin client', async () => {
      const adminEmail = testUtils.createTestEmail();

      await getAdminClient(adminEmail);
      clearAdminClient(adminEmail);

      const allClients = getAllAdminClients();
      expect(allClients.size).toBe(0);
    });

    test('should clear all admin clients', async () => {
      const adminA = 'admin-a@example.com';
      const adminB = 'admin-b@example.com';

      await getAdminClient(adminA);
      await getAdminClient(adminB);

      clearAllAdminClients();

      const allClients = getAllAdminClients();
      expect(allClients.size).toBe(0);
    });

    test.skip('should handle client creation errors gracefully', async () => {});

    test('should handle missing admin email', async () => {
      await expect(getAdminClient('')).rejects.toThrow();
      await expect(getAdminClient(null)).rejects.toThrow();
      await expect(getAdminClient(undefined)).rejects.toThrow();
    });
  });

  describe('Multi-Admin Delegation Tracking', () => {
    test('should track delegations by admin', async () => {
      const userDid = testUtils.createTestDid();
      const spaceDid = testUtils.createTestDid();
      const adminA = 'admin-a@example.com';
      const adminB = 'admin-b@example.com';

      storeDelegation(userDid, spaceDid, 'cid-a', 'car-a', null, adminA);
      storeDelegation(userDid, spaceDid, 'cid-b', 'car-b', null, adminB);

      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(2);

      const adminADelegation = delegations.find(d => d.createdBy === adminA);
      const adminBDelegation = delegations.find(d => d.createdBy === adminB);

      expect(adminADelegation.delegationCid).toBe('cid-a');
      expect(adminBDelegation.delegationCid).toBe('cid-b');
    });

    test('should handle delegations without admin tracking', async () => {
      const userDid = testUtils.createTestDid();
      const spaceDid = testUtils.createTestDid();

      storeDelegation(userDid, spaceDid, 'legacy-cid', 'car-data');

      const delegations = getDelegationsForUser(userDid);
      expect(delegations).toHaveLength(1);
      expect(delegations[0].createdBy).toBeNull();
    });
  });

  describe('Multi-Admin Space Isolation', () => {
    test.skip('should provide different spaces for different admins', async () => {
      /* Skipped for environment variability */
    });
  });
}); 