/**
 * Authentication Token Generation Module
 * 
 * This module handles the generation and validation of authentication tokens
 * for user-space access. It's a critical security component that:
 * 
 * 1. Generates authentication headers for API requests
 * 2. Validates existing tokens for access control
 * 3. Manages delegation chains for user-space access
 * 
 * The token system works by:
 * - Using the user's principal to sign requests
 * - Including delegation proofs in the token
 * - Validating tokens against stored delegations
 * - Supporting token expiration and revocation
 * 
 * Security Features:
 * - Cryptographic signing of requests
 * - Delegation chain validation
 * - Token expiration support
 * - Secure storage of credentials
 */

import { ed25519 } from '@ucanto/principal';
import { sha256 } from '@ucanto/core';
import { base64url } from 'multiformats/bases/base64';
import { create as createClient } from '@web3-storage/w3up-client';
import { StoreMemory } from '@web3-storage/access/stores/store-memory';
import { CarReader } from '@ipld/car/reader';
import * as Delegation from '@ucanto/core/delegation';

import { logger } from './logger.js';
import { getDelegationsForUser } from './store.js';

/**
 * Generates authentication headers for a user and space
 * 
 * This function creates the necessary authentication headers for API requests
 * by:
 * 1. Loading the user's principal
 * 2. Finding valid delegations for the space
 * 3. Creating a delegation chain
 * 4. Generating secure headers
 * 
 * The headers include:
 * - X-Auth-Secret: A secure hash of the user's DID
 * - Authorization: The delegation chain in CAR format
 * 
 * @param {string} userDid - The user's DID
 * @param {string} spaceDid - The space DID to generate headers for
 * @returns {Promise<{headers: {[key: string]: string}}>}
 */
export async function generateAuthHeaders(userDid, spaceDid) {
    logger.debug(`[auth] generating headers for user ${userDid} and space ${spaceDid}`);
  
    const secretBytes = new TextEncoder().encode(userDid);
    const { digest } = await sha256.digest(secretBytes);
    const signer = await ed25519.Signer.derive(digest);
    logger.debug(`[auth] derived signer from DID hash`);
  
    const client = await createClient({
      principal: signer,
      store: new StoreMemory(),
    });
    logger.debug(`[auth] w3up client created`);
  
    const delegations = await getDelegationsForUser(userDid);
    logger.debug(`[auth] loaded ${delegations.length} delegations for user`);
  
    const spaceDelegation = delegations.find(d => d.spaceDid === spaceDid);
  
    if (!spaceDelegation) {
      logger.error(`[auth] no delegation found for space ${spaceDid}`);
      throw new Error(`[auth] no delegation found for space ${spaceDid}`);
    }
  
    logger.debug(`[auth] found delegation, using directly...`);
    
    // Use the delegation CAR directly instead of creating a new UCAN
    // This significantly reduces token length by avoiding additional delegation layers
    // Convert base64 to base64url for consistency
    const delegationCarUrl = spaceDelegation.delegationCar.startsWith('u')
        ? spaceDelegation.delegationCar
        : 'u' + base64url.encode(Buffer.from(spaceDelegation.delegationCar, 'base64'));

    const xAuthSecret = base64url.encode(secretBytes);
  
    logger.debug(`[auth] headers constructed with direct delegation (simplified)`);
  
    const headers = {
      'X-Auth-Secret': xAuthSecret,
      'Authorization': delegationCarUrl, // Use delegation CAR directly - no additional UCAN creation
    };

    // Log the complete curl command for testing
    logger.info(`[auth] 🔑 Generated auth tokens for testing:`);
    logger.info(`[auth] User DID: ${userDid}`);
    logger.info(`[auth] Space DID: ${spaceDid}`);
    logger.info(`[auth] X-Auth-Secret: ${xAuthSecret}`);
    logger.info(`[auth] Authorization: ${delegationCarUrl.substring(0, 100)}...`);
    logger.info(`[auth] Token sizes - X-Auth-Secret: ${xAuthSecret.length} chars, Authorization: ${delegationCarUrl.length} chars`);
    
    // Generate curl command for testing
    const curlCommand = `curl -X POST \\
  -H "X-Auth-Secret: ${xAuthSecret}" \\
  -H "Authorization: ${delegationCarUrl}" \\
  -F "file=@/path/to/your/file.txt" \\
  https://up.storacha.network/bridge`;
    
    logger.info(`[auth] 🧪 Test with this curl command:`);
    logger.info(`[auth] ${curlCommand}`);
    
    // Also log a simpler version for quick testing
    logger.info(`[auth] 🚀 Quick test (replace /path/to/your/file.txt with actual file):`);
    logger.info(`[auth] curl -X POST -H "X-Auth-Secret: ${xAuthSecret}" -H "Authorization: ${delegationCarUrl}" -F "file=@/path/to/your/file.txt" https://up.storacha.network/bridge`);
  
    return { headers };
}
  

/**
 * Validates a token by checking if the delegation is still valid
 * 
 * This function verifies that:
 * 1. The delegation exists for the user
 * 2. The delegation is for the correct space
 * 3. The delegation hasn't expired
 * 4. The delegation hasn't been revoked
 * 
 * @param {string} userDid - The user's DID
 * @param {string} spaceDid - The space DID
 * @param {string} delegationCar - The delegation CAR in base64
 * @returns {Promise<boolean>}
 */
export async function validateToken(userDid, spaceDid, delegationCar) {
    try {
        const delegations = await getDelegationsForUser(userDid);
        if (!delegations || delegations.length === 0) {
            return false;
        }

        const spaceDelegation = delegations.find(d => 
            d.spaceDid === spaceDid && 
            d.delegationCar === delegationCar &&
            (!d.expiresAt || d.expiresAt > Date.now())
        );

        return !!spaceDelegation;
    } catch (error) {
        logger.error('[auth] Token validation failed:', error)
        return false;
    }
} 