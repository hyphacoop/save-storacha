import { getClient } from '../lib/w3upClient.js';
import {
    createSession,
    storeAdminServiceDidData,
    storeCachedSpaces
} from '../lib/store.js';
import * as Signer from '@ucanto/principal/ed25519';
import { CarWriter } from '@ipld/car';
import { base64 } from "multiformats/bases/base64";
import { logger } from '../lib/logger.js';
import { getDatabase } from '../lib/db.js';

// This function will be called after successful w3up email confirmation
export async function handleAdminW3UpAuthorization(adminEmail, adminDid, client, providedDid = null) {
    logger.info('Setting up authorization', { adminEmail });
    if (!client) {
        throw new Error('Client must be provided to handleAdminW3UpAuthorization');
    }

    try {
        // Skip Admin Service DID generation - use admin account directly
        // Since we're working with DIDs for identification only, not principals
        const adminAccount = client.agent;
        logger.debug('Using admin account directly (no service DID)');

        // Extract and log spaces directly from admin account
        const spaces = [];
        for (const space of client.spaces()) {
            spaces.push({
                name: space.name || space.did(),
                did: space.did()
            });
        }
        
        // Cache the spaces
        if (spaces.length > 0) {
            storeCachedSpaces(adminEmail, spaces);
            logger.info('Found spaces', { 
                count: spaces.length,
                spaceNames: spaces.slice(0, 3).map(s => s.name)
            });
        }

        // Store admin data without service DID (simplified)
        storeAdminServiceDidData(adminEmail, adminDid, null, null);
        
        // Create session with the provided DID if available, otherwise use adminDid
        const { sessionId } = createSession(adminEmail, providedDid || adminDid);
        logger.info('Authorization complete (simplified)', { sessionId });

        return { sessionId };

    } catch (error) {
        logger.error('Authorization failed', { error: error.message });
        return { error: error.message };
    }
}

/**
 * Initial login with email + DID
 * This establishes the w3up account and creates a long-term session
 */
export async function requestAdminLoginViaW3Up(email, did) {
    logger.info('Requesting initial login', { email, did });
    
    if (!email || !did) {
        throw new Error('Both email and DID are required for initial login');
    }

    const client = getClient();
    
    try {
        // Step 1: Login with email (this creates the temporary access request)
        const account = await client.login(email);
        logger.info('Email login successful', { accountDid: account.did() });
        
        // Step 2: Wait for payment plan if needed
        try {
            await account.plan.wait();
            logger.info('Payment plan confirmed');
        } catch (e) {
            logger.debug('No payment plan required or already set');
        }

        // Step 3: Store the DID-email mapping immediately
        const db = getDatabase();
        db.prepare(`
            INSERT OR REPLACE INTO did_email_mapping (did, email, createdAt)
            VALUES (?, ?, ?)
        `).run(did, email, Date.now());
        logger.info('Created DID-email mapping', { did, email });

        // Step 4: Check if we have spaces
        const spaces = client.spaces();
        let space;
        let spacesList = [];
        
        if (spaces.length === 0) {
            // Create a new space if none exist
            logger.info('No spaces found, creating new space');
            const spaceName = 'admin-space';
            space = await client.createSpace(spaceName, { account });
            logger.info('Created new space', { spaceName });
            spacesList.push({
                did: space.did(),
                name: spaceName
            });
        } else {
            // Use existing spaces and try to get their names
            logger.info('Found existing spaces', { count: spaces.length });
            spacesList = spaces.map(s => ({
                did: s.did(),
                name: s.name || s.did()
            }));
            space = spaces[0];
            logger.debug('Using existing space', { spaceDid: space.did() });
        }

        // Step 5: Cache the spaces immediately
        storeCachedSpaces(email, spacesList);
        logger.info('Cached spaces', { 
            count: spacesList.length,
            spaceNames: spacesList.map(s => s.name)
        });

        // Step 6: Set current space
        await client.setCurrentSpace(space.did());
        logger.debug('Set current space', { spaceDid: space.did() });
        
        // Step 7: Store admin data and create session using the provided DID
        const adminDid = client.agent.did();
        const authResult = await handleAdminW3UpAuthorization(email, adminDid, client, did);
        
        if (authResult.error) {
            throw new Error(authResult.error);
        }
        
        return { 
            message: 'Initial login successful',
            sessionId: authResult.sessionId,
            did: did,
            spaces: spacesList
        };
    } catch (error) {
        logger.error('Initial login failed', { error: error.message });
        throw error;
    }
}

/**
 * Subsequent login with email + DID
 * This validates the DID and creates a new session without re-authenticating with w3up
 */
export async function handleSubsequentLogin(email, did) {
    logger.info('Handling subsequent login', { email, did });
    
    if (!email || !did) {
        throw new Error('Both email and DID are required for login');
    }

    try {
        // Verify the DID exists in our system
        const db = getDatabase();
        const mapping = db.prepare(`
            SELECT email FROM did_email_mapping 
            WHERE did = ? AND email = ?
        `).get(did, email);

        if (!mapping) {
            throw new Error('No account found for this DID and email combination. Please complete initial login first.');
        }

        // Check if there's an active session for this email
        const activeSession = db.prepare(`
            SELECT sessionId FROM active_account_sessions 
            WHERE email = ? 
            ORDER BY createdAt DESC LIMIT 1
        `).get(email);

        if (activeSession) {
            // Reuse existing session
            logger.info('Reusing existing session for subsequent login', { did, email });
            return {
                message: 'Subsequent login successful',
                sessionId: activeSession.sessionId,
                did: did
            };
        }

        // Create a new session for this DID
        const { sessionId } = createSession(email, did);
        logger.info('Created new session for subsequent login', { did, email });
        
        return {
            message: 'Subsequent login successful',
            sessionId,
            did: did
        };

    } catch (error) {
        logger.error('Subsequent login failed', { did, email, error: error.message });
        throw error;
    }
}

/**
 * Unified login function that handles both initial and subsequent logins
 */
export async function handleAdminLogin(email, did) {
    logger.info('Handling admin login', { email, did });
    
    if (!email || !did) {
        throw new Error('Both email and DID are required for login');
    }

    try {
        // Check if this is an initial login (no DID-email mapping exists)
        const db = getDatabase();
        const existingMapping = db.prepare(`
            SELECT email FROM did_email_mapping 
            WHERE did = ? AND email = ?
        `).get(did, email);

        if (!existingMapping) {
            // This is an initial login - need to authenticate with w3up
            logger.info('Performing initial login with w3up', { email, did });
            return await requestAdminLoginViaW3Up(email, did);
        } else {
            // This is a subsequent login - just validate and create session
            logger.info('Performing subsequent login', { email, did });
            return await handleSubsequentLogin(email, did);
        }
    } catch (error) {
        logger.error('Admin login failed', { email, did, error: error.message });
        throw error;
    }
}

export async function logoutFromW3Up() {
    logger.info('Attempting to logout from w3up service');
    try {
        const client = getClient();
        const accounts = client.accounts();
        
        for (const account of accounts) {
            const email = account.email;
            logger.debug('Attempting to remove account', { email });
            
            if (typeof account.remove === 'function') {
                await account.remove();
                logger.info('Successfully removed account', { email });
            } else {
                logger.warn('Account has no remove method', { email });
            }
        }
        
        return { message: 'Logout successful' };
    } catch (error) {
        logger.error('Error during w3up logout', { error: error.message });
        throw error;
    }
}

// Keep the old function for backward compatibility, but mark as deprecated
export async function handleDidLogin(did) {
    logger.warn('handleDidLogin is deprecated. Use handleAdminLogin with email + DID instead.');
    throw new Error('Please use handleAdminLogin with both email and DID for security');
} 