/**
 * Storacha Client Management Module
 * 
 * This module manages the Storacha client lifecycle and state for the application.
 * It provides a singleton client instance that handles:
 * 
 * 1. Client Initialization
 *    - Creates and configures the Storacha client
 *    - Loads existing proofs from disk
 *    - Manages client state across server restarts
 * 
 * 2. Storage Operations
 *    - Handles file uploads to Storacha
 *    - Manages space access and permissions
 *    - Tracks storage usage and limits
 * 
 * 3. State Management
 *    - Maintains client singleton instance
 *    - Persists client state to disk
 *    - Handles client reinitialization
 * 
 * The module uses a local filesystem store to persist client state
 * between server restarts, ensuring continuity of operations.
 * 
 * IMPORTANT: This module now uses DID-based authentication to avoid
 * access request expiration issues with email-based login.
 */

import { create, Client } from '@web3-storage/w3up-client'
import { StoreMemory } from '@web3-storage/w3up-client/stores/memory'
import { logger } from './logger.js'

/** @type {Client | null} */
let client = null
/** @type {string | null} */
let serverDid = null

// Multi-admin support: Map of admin email to their client
const adminClients = new Map(); // adminEmail -> Client



export function clearClientState() {
  client = null
  serverDid = null
  logger.debug('Cleared client state')
}

/**
 * Initializes the Storacha client
 * 
 * This function:
 * 1. Clears any existing client state
 * 2. Attempts to load existing state from disk
 * 3. Creates a new client instance
 * 4. Configures the client with any loaded proofs
 * 5. Verifies client accounts and spaces
 * 
 * 
 * @returns {Promise<{client: Client, serverDid: string}>}
 */
export async function initializeW3UpClient() {
  clearClientState()
  
  try {
    logger.info('🔍 W3UP INIT - Starting client initialization (no persistent storage)');
    
    // Create a fresh client without any persistent storage to avoid cross-admin space leakage
    client = await create()
    serverDid = client.did()
    logger.info('🔍 W3UP INIT - Fresh client created', { 
      serverDid
    });
    
    if (client.accounts) {
      const accounts = client.accounts()
      logger.info('🔍 W3UP INIT - Initial accounts state', { 
        count: Array.isArray(accounts) ? accounts.length : 0,
        accountsType: typeof accounts,
        accounts: Array.isArray(accounts) ? accounts.map(acc => ({
          did: acc.did(),
          email: acc.email || 'unknown'
        })) : 'Not an array'
      });
    }
    
    if (client.spaces) {
      const spaces = client.spaces()
      logger.info('🔍 W3UP INIT - Initial spaces state', { 
        count: spaces.length,
        concern: spaces.length > 0 ? 'CLIENT HAS SPACES BEFORE ANY LOGIN - POSSIBLE PERSISTENCE ISSUE' : 'No spaces initially (expected)',
        spacesDetails: spaces.map((space, index) => ({
          index: index + 1,
          did: space.did(),
          name: space.name || 'Unnamed'
        }))
      });
    }
    
    return { client, serverDid }
  } catch (error) {
    logger.error('Failed to initialize client', { error: error.message })
    throw error
  }
}

export function getClient() {
  if (!client) {
    throw new Error('w3up client not initialized. Call initializeW3UpClient first.')
  }
  return client
}

export function getServerDid() {
  if (!serverDid) {
    throw new Error('w3up client not initialized or DID not available. Call initializeW3UpClient first.')
  }
  return serverDid
}

/**
 * Multi-Admin Client Management
 * 
 * These functions support multiple admins by maintaining separate client instances
 * for each admin, ensuring that delegations created by one admin can be used
 * by the same admin's client for uploads.
 */

/**
 * Gets or creates a client for a specific admin
 * 
 * @param {string} adminEmail - The admin's email address
 * @returns {Promise<Client>} The admin's client instance
 */
export async function getAdminClient(adminEmail) {
  if (!adminEmail) {
    throw new Error('Admin email is required for multi-admin client management');
  }

  if (adminClients.has(adminEmail)) {
    logger.info('🔍 ADMIN CLIENT - Reusing existing isolated client', { adminEmail });
    return adminClients.get(adminEmail);
  }

  // Create a new isolated client for this admin using StoreMemory
  logger.info('🔍 ADMIN CLIENT - Creating new isolated client for admin', { adminEmail });
  
  try {
    // Each admin gets a completely isolated client with StoreMemory
    // This ensures no cross-admin access to spaces
    const adminClient = await create({
      store: new StoreMemory()
    });
    
    adminClients.set(adminEmail, adminClient);
    
    logger.info('🔍 ADMIN CLIENT - Isolated client created successfully', { 
      adminEmail, 
      adminDid: adminClient.did(),
      initialSpaces: adminClient.spaces().length,
      expectedSpaces: 0
    });
    
    return adminClient;
  } catch (error) {
    logger.error('Failed to create isolated admin client', { 
      adminEmail, 
      error: error.message 
    });
    throw error;
  }
}

/**
 * Gets all admin clients
 * 
 * @returns {Map<string, Client>} Map of admin email to client
 */
export function getAllAdminClients() {
  return new Map(adminClients);
}

/**
 * Clears a specific admin's client
 * 
 * @param {string} adminEmail - The admin's email address
 */
export function clearAdminClient(adminEmail) {
  if (adminClients.has(adminEmail)) {
    adminClients.delete(adminEmail);
    logger.info('Cleared admin client', { adminEmail });
  }
}

/**
 * Clears all admin clients
 */
export function clearAllAdminClients() {
  adminClients.clear();
  logger.info('Cleared all admin clients');
} 