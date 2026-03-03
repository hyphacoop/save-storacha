import { create as createClient } from '@storacha/client';
import { StoreMemory } from '@storacha/client/stores/memory';
import * as Signer from '@ucanto/principal/ed25519';
import { logger } from './logger.js';
import { decryptFromStorage, maybeReencryptAgentData } from './dbEncryption.js';

const clientCache = new Map();

/**
 * Creates a storacha client initialized with a specific private key (principal).
 * This is for non-interactive use by the server on behalf of an admin.
 *
 * @param {string} principalKey - The private key string for the agent.
 * @returns {Promise<import('@web-storage/w3up-client').Client>}
 */
export async function getClientForPrincipal(principalKey) {
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
 * Creates a new agent and client for a device.
 * This function triggers email verification and blocks until completed.
 * Each device gets its own agent for security.
 *
 * @param {string} email - The email of the admin.
 * @param {string} did - The device DID.
 * @returns {Promise<{client: import('@web-storage/w3up-client').Client, principalKey: string, planProduct: string|null}>}
 */
export async function createAndAuthorizeDeviceAgent(email, did) {
    logger.info('Creating new agent for device', { email, did });
    const principal = await Signer.generate();
    const store = new StoreMemory();
    const client = await createClient({ principal, store });

    logger.info('Starting email verification for device', { email, did });
    const account = await client.login(email);
    logger.info('Email sent, awaiting user verification', { email, did });

    // Wait for email verification and claim delegations
    // This blocks until the user clicks the email verification link
    await client.capability.access.claim();
    logger.info('Email verified! Delegations claimed', { email, did });

    // Capture plan information
    let planProduct = null;
    if (account && account.plan && typeof account.plan.get === 'function') {
        try {
            logger.info('PLAN INFO - Getting plan for admin', { email });
            const planInfo = await account.plan.get();
            if (planInfo && planInfo.ok && planInfo.ok.product) {
                planProduct = planInfo.ok.product;
                logger.info('PLAN INFO - Captured plan product', { email, planProduct });
            }
        } catch (planError) {
            logger.warn('PLAN INFO - Failed to retrieve plan', { email, error: planError.message });
        }
    }

    const archive = principal.toArchive();
    const serializableArchive = {
        id: archive.id,
        keys: {}
    };
    for (const [key, value] of Object.entries(archive.keys)) {
        serializableArchive.keys[key] = Buffer.from(value).toString('base64');
    }
    const principalKey = JSON.stringify(serializableArchive);

    return { client, principalKey, planProduct };
}


/**
 * Gets a pre-authenticated client for a specific device (email + DID combination).
 * Fetches the device agent from database and creates a client.
 *
 * @param {string} email - The admin's email.
 * @param {string} did - The device DID.
 * @returns {Promise<import('@web-storage/w3up-client').Client>}
 */
export async function getAdminClient(email, did) {
    const cacheKey = `${email}:${did}`;
    if (clientCache.has(cacheKey)) {
        return clientCache.get(cacheKey);
    }

    logger.info('Fetching device agent from database', { email, did });

    // Import getDatabase here to avoid circular dependency
    const { getDatabase } = await import('../lib/db.js');
    const db = getDatabase();

    const agent = db.prepare('SELECT rowid AS rowId, agentData FROM admin_agents WHERE adminEmail = ? AND did = ? AND status = ?')
        .get(email, did, 'active');

    if (!agent || !agent.agentData) {
        throw new Error(`No active agent found for device ${did} with email ${email}`);
    }

    const principalKey = decryptFromStorage(agent.agentData);
    maybeReencryptAgentData(db, agent.rowId, agent.agentData);

    logger.info('Initializing client from stored device agent', { email, did });
    const client = await getClientForPrincipal(principalKey);
    clientCache.set(cacheKey, client);
    return client;
} 
