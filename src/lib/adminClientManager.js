import { create as createClient } from '@web3-storage/w3up-client';
import { StoreMemory } from '@web3-storage/w3up-client/stores/memory';
import * as Signer from '@ucanto/principal/ed25519';
import { logger } from './logger.js';
import { Agent } from '@web3-storage/access';

const clientCache = new Map();

/**
 * Creates a w3up client initialized with a specific private key (principal).
 * This is for non-interactive use by the server on behalf of an admin.
 *
 * @param {string} principalKey - The private key string for the agent.
 * @returns {Promise<import('@web-storage/w3up-client').Client>}
 */
async function getClientForPrincipal(principalKey) {
    const archive = JSON.parse(principalKey);
    const restoredArchive = {
        id: archive.id,
        keys: Object.fromEntries(
            Object.entries(archive.keys).map(([k, v]) => [k, Buffer.from(v, 'base64')])
        )
    };
    const principal = await Signer.from(restoredArchive);
    const store = new StoreMemory();
    const client = await createClient({ principal, store });
    return client;
}

/**
 * Creates a new agent and client for a first-time admin onboarding.
 * This function will trigger the interactive email verification flow.
 *
 * @param {string} email - The email of the admin to onboard.
 * @returns {Promise<{client: import('@web-storage/w3up-client').Client, principalKey: string}>}
 */
export async function createAndAuthorizeNewClient(email) {
    logger.info('Creating a new agent for first-time login', { email });
    const principal = await Signer.generate();
    const store = new StoreMemory();
    const client = await createClient({ principal, store });

    logger.info('Starting interactive authorization flow', { email });
    await client.authorize(email);
    logger.info('Interactive authorization successful', { email });

    const archive = principal.toArchive();
    const serializableArchive = {
        id: archive.id,
        keys: {}
    };
    for (const [key, value] of Object.entries(archive.keys)) {
        serializableArchive.keys[key] = Buffer.from(value).toString('base64');
    }
    const principalKey = JSON.stringify(serializableArchive);

    return { client, principalKey };
}

/**
 * Gets a pre-authenticated client for an existing admin using their stored principal.
 * This is the primary function for all subsequent, non-interactive logins.
 *
 * @param {string} email - The admin's email.
 * @param {string} principalKey - The admin's stored private key.
 * @returns {Promise<import('@web-storage/w3up-client').Client>}
 */
export async function getAdminClient(email, principalKey) {
    if (clientCache.has(email)) {
        return clientCache.get(email);
    }

    logger.info('Initializing client from stored principal', { email });
    const client = await getClientForPrincipal(principalKey);
    clientCache.set(email, client);
    return client;
} 