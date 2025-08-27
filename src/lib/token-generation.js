/**
 * Bridge Token Generation Module
 * 
 * This module handles the generation of bridge tokens for Storacha bridge access.
 * It uses the admin's client to issue coupons that can be used with the Storacha bridge API.
 * 
 * The bridge token system works by:
 * - Using the admin's authenticated client to issue coupons
 * - Creating capability-based coupons for specific resources
 * - Generating X-Auth-Secret and Authorization headers
 * - Supporting token expiration and custom capabilities
 * 
 * Security Features:
 * - Uses admin's authenticated client for coupon issuance
 * - Cryptographic coupon generation with password protection
 * - Capability-based access control
 * - Token expiration support
 */

import * as DID from '@ipld/dag-ucan/did';
import { base64url } from 'multiformats/bases/base64';
import cryptoRandomString from 'crypto-random-string';
import { logger } from './logger.js';
import { getDatabase } from './db.js';

/**
 * Generates bridge tokens using either admin's client or delegated user's client
 * 
 * This function creates bridge tokens that can be used with the Storacha bridge API.
 * It supports two modes:
 * 1. Admin mode: Uses admin's authenticated client to issue coupons
 * 2. Delegated mode: Uses admin's client with user's delegation to issue coupons
 * 
 * The bridge expects:
 * 1. Coupon issued by an admin that actually holds authority over the target space
 * 2. Expiration as unix timestamp (seconds since epoch)
 * 3. Exact capability names: 'store/add', 'upload/add', 'upload/list'
 * 4. Headers: X-Auth-Secret and Authorization (base64url, no prefix)
 * 
 * @param {string} adminEmailOrUserDid - The admin's email OR user's DID
 * @param {string} resource - The resource DID (space DID) to generate tokens for
 * @param {Object} options - Token generation options
 * @param {string[]|string} [options.can] - Capabilities to grant (default: ['store/add', 'upload/add'])
 * @param {number} [options.expiration] - Token expiration time (unix timestamp in seconds)
 * @param {boolean} [options.json] - Whether to return JSON format
 * @param {boolean} [options.isDelegated] - Whether this is a delegated user request
 * @returns {Promise<{xAuthSecret: string, authorization: string, headers: Object}>}
 */
export async function generateTokens(adminEmailOrUserDid, resource, options = {}) {
    // Default to 1 hour from now as unix timestamp (seconds)
    const defaultExpiration = Math.floor(Date.now() / 1000) + 60 * 60;
    const { can = ['store/add', 'upload/add'], expiration = defaultExpiration, json = false, isDelegated = false } = options;
    
    logger.info(`[bridge] Generating bridge tokens for resource: ${resource}`, { 
        adminEmailOrUserDid, 
        capabilities: can, 
        expiration,
        isDelegated
    });

    try {
        // Ensure capabilities is an array
        const abilities = can ? [can].flat() : [];
        if (!abilities.length) {
            throw new Error('Missing capabilities for coupon');
        }

        let client;
        let adminEmail;

        if (isDelegated) {
            // DELEGATED USER MODE: Use admin's client with user's delegation
            const userDid = adminEmailOrUserDid;
            
            // Get delegations for the user
            const { getDelegationsForUser } = await import('./store.js');
            const delegations = await getDelegationsForUser(userDid);
            
            if (!delegations || delegations.length === 0) {
                throw new Error(`No valid delegations found for user: ${userDid}`);
            }

            // Filter delegations for the specific space
            const spaceDelegations = delegations.filter(d => d.spaceDid === resource);
            if (spaceDelegations.length === 0) {
                throw new Error(`No valid delegation found for user ${userDid} and space ${resource}`);
            }

            // Use the first valid delegation
            const delegation = spaceDelegations[0];
            adminEmail = delegation.createdBy;
            
            if (!adminEmail) {
                throw new Error('Delegation missing admin information');
            }

            logger.info(`[bridge] Using delegated user mode`, { userDid, adminEmail, resource });

        } else {
            // ADMIN MODE: Direct admin access
            adminEmail = adminEmailOrUserDid;
        }

        // Get the admin's client with their loaded delegations from login
        const db = getDatabase();
        const adminAgent = db.prepare('SELECT agentData, status FROM admin_agents WHERE adminEmail = ?').get(adminEmail);
        
        if (!adminAgent || adminAgent.status !== 'active') {
            throw new Error(`No active admin agent found for ${adminEmail}`);
        }
        
        // Create the admin's client (which has delegations loaded from login)
        const { getAdminClient } = await import('./adminClientManager.js');
        client = await getAdminClient(adminEmail, adminAgent.agentData);
        
        // Ensure we have the latest delegations
        try {
            await client.capability.access.claim();
            logger.info(`[bridge] Refreshed delegations for admin`, { adminEmail });
        } catch (error) {
            logger.warn(`[bridge] Could not refresh delegations for admin, using cached info`, { adminEmail, error: error.message });
        }
        
        logger.info(`[bridge] Using admin client with delegations for coupon issuance`, {
            adminEmail,
            adminDid: client.did(),
            isDelegated
        });

        // If this is a delegated user request, add the user's delegation proof
        if (isDelegated) {
            const userDid = adminEmailOrUserDid;
            const { getDelegationsForUser } = await import('./store.js');
            const delegations = await getDelegationsForUser(userDid);
            const spaceDelegation = delegations.find(d => d.spaceDid === resource);
            
            if (spaceDelegation) {
                try {
                    const { importDAG } = await import('@ucanto/core/delegation');
                    const { base64 } = await import('multiformats/bases/base64');
                    const { CarReader } = await import('@ipld/car/reader');
                    
                    // Import the delegation CAR
                    const delegationBytes = base64.decode(spaceDelegation.delegationCar);
                    const carReader = await CarReader.fromBytes(delegationBytes);
                    
                    // Get all blocks from the CAR file
                    const blocks = [];
                    const iterator = carReader.blocks();
                    for await (const block of iterator) {
                        blocks.push(block);
                    }
                    
                    // Import the delegation and add it as proof
                    const importedDelegation = await importDAG(blocks);
                    if (importedDelegation) {
                        await client.addProof(importedDelegation);
                        await client.addSpace(importedDelegation);
                        await client.setCurrentSpace(resource);
                        logger.info(`[bridge] Added user delegation proof and set space for ${userDid}`);
                    }
                } catch (error) {
                    logger.warn(`[bridge] Could not add user delegation proof, continuing with admin capabilities`, { error: error.message });
                }
            }
        }

        // Parse the resource DID
        const withDid = DID.parse(resource).did();
        
        // Create capabilities array
        const capabilities = abilities.map(c => ({ can: c, with: withDid }));
        
        logger.debug(`[bridge] Created capabilities:`, capabilities);

        // Generate password for the coupon
        const password = cryptoRandomString({ length: 32 });
        
        logger.debug(`[bridge] Generated password for coupon`);

        // Issue the coupon using the client (which is created from the space owner principal)
        // Bridge expects expiration as unix timestamp (seconds since epoch)
        const coupon = await client.coupon.issue({
            capabilities,
            expiration: expiration, // Already in unix timestamp format
            password,
        });

        logger.debug(`[bridge] Issued coupon via client`);

        // Archive the coupon to bytes
        const { ok: bytes, error } = await coupon.archive();
        if (!bytes) {
            throw new Error(`Failed to archive coupon: ${error?.message || 'Unknown error'}`);
        }

        logger.debug(`[bridge] Archived coupon to bytes`);

        // Create bridge-compatible headers
        const xAuthSecret = base64url.encode(new TextEncoder().encode(password));
        const token = base64url.encode(bytes);

        // Bridge expects exactly these headers (no prefix on Authorization)
        const headers = {
            'X-Auth-Secret': xAuthSecret,
            'Authorization': token, // No prefix, just base64url
            'Content-Type': 'application/json',
        };

        if (json) {
            return {
                'X-Auth-Secret': xAuthSecret,
                'Authorization': token,
            };
        }

        return {
            xAuthSecret,
            authorization: token,
            headers,
        };

    } catch (error) {
        logger.error(`[bridge] Failed to generate bridge tokens:`, { 
            adminEmailOrUserDid, 
            resource, 
            error: error.message,
            isDelegated
        });
        throw error;
    }
}
