import { Signer } from '@ucanto/principal/ed25519';
import { CarWriter } from '@ipld/car';
import { base64 } from "multiformats/bases/base64";
import { importDAG } from '@ucanto/core/delegation';
import { CarReader } from '@ipld/car/reader';
import { create } from '@web3-storage/w3up-client';
import { StoreMemory } from '@web3-storage/access/stores/store-memory';
import { logger } from './logger.js';
import { getUserPrincipal, getDelegationsForUser } from './store.js';

/**
 * Generates authentication headers for a user and space
 * @param {string} userDid - The user's DID
 * @param {string} spaceDid - The space DID to generate headers for
 * @returns {Promise<{headers: {[key: string]: string}, delegationInfo: Object}>}
 */
export async function generateAuthHeaders(userDid, spaceDid) {
    try {
        // Get the principal that was created for this user
        const userPrincipal = await getUserPrincipal(userDid);
        if (!userPrincipal) {
            throw new Error('No principal found for user');
        }
        logger.info('Token generation: User principal DID:', userPrincipal.did());

        // Get delegations for the user
        const delegations = await getDelegationsForUser(userDid);
        if (!delegations || delegations.length === 0) {
            throw new Error('No valid delegation found');
        }

        // Filter delegations for the specific space
        const spaceDelegations = delegations.filter(d => d.spaceDid === spaceDid);
        if (spaceDelegations.length === 0) {
            throw new Error('No valid delegation found for this space');
        }

        // Use the most recent valid delegation
        const existingDelegation = spaceDelegations[0];
        logger.info('Token generation: Using delegation:', {
            delegationCid: existingDelegation.delegationCid,
            spaceDid,
            userDid,
            expiresAt: existingDelegation.expiresAt ? new Date(existingDelegation.expiresAt).toISOString() : 'never'
        });

        // Create a new memory store and client with the user's principal
        const memoryStore = new StoreMemory();
        const client = await create({ 
            principal: userPrincipal,
            store: memoryStore 
        });

        // Import the delegation
        const delegationBytes = base64.decode(existingDelegation.delegationCar);
        const carReader = await CarReader.fromBytes(delegationBytes);
        const blocks = [];
        const iterator = carReader.blocks();
        for await (const block of iterator) {
            blocks.push(block);
            logger.debug('Delegation chain block:', {
                cid: block.cid.toString(),
                size: block.bytes.length
            });
        }
        const importedDelegation = await importDAG(blocks);
        if (!importedDelegation) {
            throw new Error('Failed to import delegation');
        }

        // Add the delegation proof to the client
        await client.addProof(importedDelegation);
        logger.info('Token generation: Added delegation proof to client');

        // Generate X-Auth-Secret by hashing the user's DID
        const userDidBytes = new TextEncoder().encode(userDid);
        const xAuthSecret = makeBase64UrlSafe(base64.encode(userDidBytes));

        return {
            headers: {
                'X-Auth-Secret': xAuthSecret,
                'Authorization': makeBase64UrlSafe(existingDelegation.delegationCar)
            },
            delegationInfo: {
                delegationCid: existingDelegation.delegationCid,
                spaceDid,
                userDid,
                expiresAt: existingDelegation.expiresAt ? new Date(existingDelegation.expiresAt).toISOString() : 'never'
            }
        };

    } catch (error) {
        logger.error('Token generation failed:', error);
        throw error;
    }
}

/**
 * Makes a base64 string URL-safe by replacing characters
 * @param {string} base64Str - The base64 string to make URL-safe
 * @returns {string} URL-safe base64 string
 */
function makeBase64UrlSafe(base64Str) {
    return base64Str
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * Validates a token by checking if the delegation is still valid
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
        logger.error('Token validation failed:', error);
        return false;
    }
} 