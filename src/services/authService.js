import {
    createSession,
    storeAdminSpace,
    updateVerificationStatus
} from '../lib/store.js';
import { logger } from '../lib/logger.js';
import { getDatabase } from '../lib/db.js';
import { getAdminClient, createAndAuthorizeDeviceAgent } from '../lib/adminClientManager.js';
import { encryptForStorage } from '../lib/dbEncryption.js';
import * as DidAuthService from './didAuthService.js';

/**
 * Onboards a new admin with a device agent.
 * Each device gets its own agent that requires email verification.
 * @param {string} email The email of the new admin.
 * @param {string} did The device DID.
 * @param {string} sessionId The session ID to update upon completion.
 */
async function onboardNewAdminInBackground(email, did, sessionId) {
    const db = getDatabase();
    try {
        logger.info('ONBOARD: Starting new admin device onboarding', { email, did });

        // Create device agent with email verification (blocks until verified)
        const { client, principalKey, planProduct } = await createAndAuthorizeDeviceAgent(email, did);

        // Store device agent in database
        const now = Date.now();
        db.prepare(`
            INSERT OR REPLACE INTO admin_agents (adminEmail, did, agentData, status, createdAt, updatedAt, planProduct)
            VALUES (?, ?, ?, 'active', ?, ?, ?)
        `).run(email, did, encryptForStorage(principalKey), now, now, planProduct);
        logger.info('ONBOARD: Stored device agent', { email, did });

        // Store DID mapping after email verification
        db.prepare(`
            INSERT OR IGNORE INTO did_email_mapping (did, email, createdAt)
            VALUES (?, ?, ?)
        `).run(did, email, now);
        logger.info('ONBOARD: Registered verified DID', { did, email });

        // Sync spaces
        const spaces = await client.spaces();
        const spacesList = [];
        for (const space of spaces) {
            const spaceName = space.name || space.did();
            const spaceDid = space.did();
            storeAdminSpace(email, spaceDid, spaceName);
            spacesList.push({ did: spaceDid, name: spaceName });
        }
        logger.info(`ONBOARD: Cached ${spacesList.length} spaces for admin`, { email });

        // Mark email as verified
        updateVerificationStatus(sessionId, 'email', true);
        logger.info('ONBOARD: Device onboarding successful', { email, did, sessionId });

    } catch (error) {
        logger.error('ONBOARD: Device onboarding failed', { email, did, sessionId, error: error.message });
        updateVerificationStatus(sessionId, 'email', false);
    }
}

/**
 * Handles login for an existing admin from a new device (new DID).
 * Creates a NEW agent for this device with email verification.
 */
async function handleNewDeviceLogin(email, did, sessionId) {
    logger.info('NEW DEVICE: Starting new device onboarding', { email, did, sessionId });

    if (!email || !did || !sessionId) {
        throw new Error('Email, DID, and SessionId are required for new device login');
    }

    const db = getDatabase();

    try {
        // Verify admin exists (check for ANY active agent for this email)
        const existingAgent = db.prepare('SELECT adminEmail FROM admin_agents WHERE adminEmail = ? AND status = ? LIMIT 1')
            .get(email, 'active');

        if (!existingAgent) {
            throw new Error('Admin not found. Please complete onboarding first.');
        }

        logger.info('NEW DEVICE: Admin verified, creating device agent', { email, did });

        // Create NEW agent for this device with email verification (blocks until verified)
        const { client, principalKey, planProduct } = await createAndAuthorizeDeviceAgent(email, did);

        // Store device agent in database
        const now = Date.now();
        db.prepare(`
            INSERT OR REPLACE INTO admin_agents (adminEmail, did, agentData, status, createdAt, updatedAt, planProduct)
            VALUES (?, ?, ?, 'active', ?, ?, ?)
        `).run(email, did, encryptForStorage(principalKey), now, now, planProduct);
        logger.info('NEW DEVICE: Stored device agent', { email, did });

        // Store DID mapping after email verification
        db.prepare(`
            INSERT OR IGNORE INTO did_email_mapping (did, email, createdAt)
            VALUES (?, ?, ?)
        `).run(did, email, now);
        logger.info('NEW DEVICE: Registered verified DID', { did, email });

        // Sync spaces
        const spaces = await client.spaces();
        const spacesList = [];
        for (const space of spaces) {
            const spaceName = space.name || space.did();
            const spaceDid = space.did();
            storeAdminSpace(email, spaceDid, spaceName);
            spacesList.push({ did: spaceDid, name: spaceName });
        }
        logger.info(`NEW DEVICE: Cached ${spacesList.length} spaces`, { email });

        // Mark email as verified
        updateVerificationStatus(sessionId, 'email', true);
        logger.info('✅ NEW DEVICE: Device onboarding successful', { email, did, sessionId });

    } catch (error) {
        logger.error('NEW DEVICE: Verification failed', {
            email,
            did,
            sessionId,
            error: error.message,
            stack: error.stack
        });

        updateVerificationStatus(sessionId, 'email', false);
    }
}

/**
 * Handles an admin login, dispatching to the correct flow based on agent status.
 * Includes DID challenge generation for cryptographic verification.
 * Supports multiple devices (DIDs) per admin.
 */
export async function handleAdminLogin(email, did) {
    logger.info('Handling admin login request', { email, did });
    const db = getDatabase();

    // Generate DID challenge for cryptographic verification
    const { challenge, challengeId } = await DidAuthService.generateChallenge(did);
    logger.info('Generated DID challenge for login', { email, did, challengeId });

    // Check if this specific device (email + did) has an active agent
    const deviceAgent = db.prepare('SELECT adminEmail, did FROM admin_agents WHERE adminEmail = ? AND did = ? AND status = ?')
        .get(email, did, 'active');

    if (deviceAgent) {
        // Known device - Subsequent login
        logger.info('Known device login', { email, did });
        const loginResult = await handleSubsequentLogin(email, did);
        return {
            ...loginResult,
            challenge,
            challengeId,
            requiresSignature: true
        };
    }

    // Check if admin exists (any device)
    const adminExists = db.prepare('SELECT adminEmail FROM admin_agents WHERE adminEmail = ? AND status = ? LIMIT 1')
        .get(email, 'active');

    if (adminExists) {
        // Admin exists, but new device
        logger.info('New device login for existing admin', { email, did });

        // Create unverified session for this new device
        const { sessionId } = createSession(email, did, {}, false);

        // Start background verification process for new device
        handleNewDeviceLogin(email, did, sessionId);

        return {
            message: 'New device detected. Please verify your email and sign the challenge to complete authentication.',
            sessionId,
            did,
            verified: false,
            challenge,
            challengeId,
            requiresSignature: true
        };
    }

    // New admin - first device
    logger.info('New admin first device onboarding', { email, did });

    const { sessionId } = createSession(email, did, {}, false);

    // Start the background process without waiting for it to complete
    onboardNewAdminInBackground(email, did, sessionId);

    return {
        message: 'Login initiated. Please check your email to verify your account.',
        sessionId,
        did,
        verified: false,
        challenge,
        challengeId,
        requiresSignature: true
    };
}

/**
 * Handles a subsequent login for an existing device.
 */
async function handleSubsequentLogin(email, did) {
    logger.info('Performing subsequent login for known device', { email, did });
    const db = getDatabase();

    // Security Check: Verify this DID is registered for this email
    const mapping = db.prepare('SELECT did FROM did_email_mapping WHERE email = ? AND did = ?').get(email, did);
    if (!mapping) {
        logger.warn('DID not registered for this email', { email, did });
        throw new Error('This device/DID is not registered for this email.');
    }

    // Get spaces for this device
    const spacesList = await getSpacesForExistingDevice(email, did);

    const { sessionId } = createSession(email, did, {}, true);
    const loginResponse = {
        message: 'Login successful',
        sessionId,
        did,
        spaces: spacesList,
        verified: true,
    };
    logger.info('Login response for subsequent login', { email, did, sessionId });
    return loginResponse;
}


// Keep the old function for backward compatibility, but mark as deprecated
export async function handleDidLogin(did) {
    logger.warn('handleDidLogin is deprecated. Use handleAdminLogin with email + DID instead.');
    throw new Error('Please use handleAdminLogin with both email and DID for security');
}

async function getSpacesForExistingDevice(email, did) {
    const client = await getAdminClient(email, did);

    // For existing devices, refresh delegations
    try {
        await client.capability.access.claim();
        logger.info('Refreshed delegations for device', { email, did });
    } catch (error) {
        logger.warn('Could not refresh delegations for device, using cached info.', { email, did, error: error.message });
    }

    const spaces = await client.spaces();
    logger.info(`Found ${spaces.length} spaces for device`, { email, did });

    // Cache spaces for faster subsequent requests
    const spacesList = [];
    for (const space of spaces) {
        const spaceName = space.name || space.did();
        const spaceDid = space.did();
        storeAdminSpace(email, spaceDid, spaceName);
        spacesList.push({ did: spaceDid, name: spaceName });
    }
    logger.info(`Refreshed ${spacesList.length} spaces for device`, { email, did, spacesList });

    return spacesList;
} 
