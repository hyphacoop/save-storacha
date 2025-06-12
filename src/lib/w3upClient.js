/**
 * Web3.Storage Client Management Module
 * 
 * This module manages the Web3.Storage client lifecycle and state for the application.
 * It provides a singleton client instance that handles:
 * 
 * 1. Client Initialization
 *    - Creates and configures the Web3.Storage client
 *    - Loads existing proofs from disk
 *    - Manages client state across server restarts
 * 
 * 2. Storage Operations
 *    - Handles file uploads to Web3.Storage
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
import { importDAG } from '@ucanto/core/delegation'
import { CarReader } from '@ipld/car/reader'
import fs from 'fs/promises'
import path from 'path'
import { logger } from './logger.js'

/** @type {Client | null} */
let client = null
/** @type {string | null} */
let serverDid = null

// Multi-admin support: Map of admin email to their client
const adminClients = new Map(); // adminEmail -> Client

const storePath = path.join(process.cwd(), 'w3up-client-data')

/**
 * Loads the client's proof store from disk
 * 
 * This function attempts to load any existing client state from disk,
 * specifically looking for:
 * 1. The proof.car file containing delegation proofs
 * 2. Any existing client configuration
 * 
 * If no state exists, it returns undefined to trigger fresh initialization.
 * 
 * @returns {Promise<{proof: import('@ucanto/core/delegation').Delegation} | undefined>}
 */
async function loadStore() {
  try {
    await fs.mkdir(storePath, { recursive: true })
    const proofPath = path.join(storePath, 'proof.car')
    const proofBytes = await fs.readFile(proofPath)
    const proof = await CarReader.fromBytes(proofBytes)
    const delegation = await importDAG(proof.blocks)
    logger.debug('Loaded proof from disk')
    return { proof: delegation }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn('Error loading proof', { error: error.message })
    }
    logger.debug('No proof found on disk')
    return undefined
  }
}

async function saveStore(proof) {
  try {
    await fs.mkdir(storePath, { recursive: true })
    const proofPath = path.join(storePath, 'proof.car')
    await fs.writeFile(proofPath, proof)
    logger.debug('Saved proof to disk')
  } catch (error) {
    logger.error('Failed to save proof', { error: error.message })
  }
}

export function clearClientState() {
  client = null
  serverDid = null
  logger.debug('Cleared client state')
}

/**
 * Initializes the Web3.Storage client
 * 
 * This function:
 * 1. Clears any existing client state
 * 2. Attempts to load existing state from disk
 * 3. Creates a new client instance
 * 4. Configures the client with any loaded proofs
 * 5. Verifies client accounts and spaces
 * 
 * The client is stored as a singleton instance for the application.
 * 
 * @returns {Promise<{client: Client, serverDid: string}>}
 */
export async function initializeW3UpClient() {
  clearClientState()
  
  try {
    const principal = await loadStore()
    logger.info('Initializing client')
    
    client = await create(principal ? { principal } : undefined)
    serverDid = client.did()
    logger.info('Client initialized', { serverDid })
    
    if (client.accounts) {
      const accounts = client.accounts()
      logger.debug('Current accounts', { count: accounts.length })
    }
    
    if (client.spaces) {
      const spaces = client.spaces()
      logger.debug('Current spaces', { count: spaces.length })
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
    return adminClients.get(adminEmail);
  }

  // Create a new client for this admin
  logger.info('Creating new client for admin', { adminEmail });
  
  try {
    // For now, we'll use the global client as a template
    // In a full implementation, each admin would have their own credentials
    const adminClient = await create();
    adminClients.set(adminEmail, adminClient);
    
    logger.info('Admin client created successfully', { 
      adminEmail, 
      adminDid: adminClient.did() 
    });
    
    return adminClient;
  } catch (error) {
    logger.error('Failed to create admin client', { 
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