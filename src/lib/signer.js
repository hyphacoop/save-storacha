/**
 * Cryptographic Principal Management Module
 * 
 * This module handles the creation, serialization, and deserialization of
 * cryptographic principals (signers) used for Storacha authentication
 * and delegation operations.
 * 
 * Principals are Ed25519 key pairs that serve as cryptographic identities
 * for users and admins in the system. They are used to:
 * - Sign delegations and proofs
 * - Authenticate with Storacha services
 * - Establish cryptographic identity chains
 * 
 * The module provides safe serialization that converts binary key material
 * to base64 strings for database storage and network transmission.
 */

import { Signer } from '@ucanto/principal/ed25519'

/**
 * Generates a new cryptographic principal with a fresh Ed25519 key pair
 * 
 * This creates a completely new cryptographic identity that can be used
 * for signing operations and establishing trust relationships.
 * 
 * @returns {Promise<import('@ucanto/principal').Signer>} The generated principal
 */
export async function generatePrincipal() {
  return Signer.generate()
}

/**
 * Exports a principal to a JSON string for persistent storage
 * 
 * Converts the binary key material to base64 strings so it can be safely
 * stored in text-based storage systems like databases or configuration files.
 * The resulting JSON contains both the principal ID and the key material
 * needed for reconstruction.
 * 
 * @param {import('@ucanto/principal').Signer} principal - The principal to export
 * @returns {Promise<string>} The exported key data in JSON format
 */
export async function exportPrincipal(principal) {
  const archive = principal.toArchive()
  const serializableArchive = {
    id: archive.id,
    keys: {}
  }
  
  // Convert binary key data to base64 strings for safe serialization
  for (const [key, value] of Object.entries(archive.keys)) {
    serializableArchive.keys[key] = Buffer.from(value).toString('base64')
  }
  
  return JSON.stringify(serializableArchive)
}

/**
 * Imports a principal from its exported JSON representation
 * 
 * Reconstructs a cryptographic principal from its serialized form by
 * converting base64 strings back to binary key material and rebuilding
 * the key pair structure.
 * 
 * @param {string} key - The exported key data in JSON format
 * @returns {Promise<import('@ucanto/principal').Signer>} The reconstructed principal
 */
export async function importPrincipal(key) {
  const archive = JSON.parse(key)
  
  // Convert base64 strings back to binary key material
  const restoredArchive = {
    id: archive.id,
    keys: Object.fromEntries(
      Object.entries(archive.keys).map(([k, v]) => [k, Buffer.from(v, 'base64')])
    )
  }
  
  // Reconstruct the principal from the restored archive
  return Signer.from(restoredArchive)
} 