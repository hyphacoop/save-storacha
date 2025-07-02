import { getClient } from '../lib/w3upClient.js';
import {
    createSession,
    storeAdminServiceDidData,
    storeCachedSpaces,
    storeAdminSpace,
    getAdminSpaces,
    updateSessionVerification
} from '../lib/store.js';
import * as Signer from '@ucanto/principal/ed25519';
import { CarWriter } from '@ipld/car';
import { base64 } from "multiformats/bases/base64";
import { logger } from '../lib/logger.js';
import { getDatabase } from '../lib/db.js';

/**
 * Handles the authorization setup after successful Storacha email confirmation
 * This function configures the admin's access to their assigned spaces and creates a session.
 * It ensures that each admin only has access to spaces that have been explicitly associated with their account.
 */
export async function handleAdminW3UpAuthorization(adminEmail, adminDid, client, providedDid = null) {
    logger.info('Setting up authorization', { adminEmail });
    if (!client) {
        throw new Error('Client must be provided to handleAdminW3UpAuthorization');
    }

    try {
        // Only return spaces that have been explicitly mapped to this admin's email
        // This maintains proper space isolation between different admin accounts
        const explicitlyMappedSpaces = getAdminSpaces(adminEmail);
        let spaces = [];
        
        if (explicitlyMappedSpaces.length > 0) {
            // Admin has explicitly mapped spaces - use those
            spaces = explicitlyMappedSpaces.map(space => ({
                name: space.spaceName || space.name,
                did: space.spaceDid || space.did
            }));
            logger.info('Using explicitly mapped spaces for admin', { 
                adminEmail, 
                spaceCount: spaces.length 
            });
        } else {
            // No spaces mapped to this admin yet - this is expected for new admins
            logger.info('No spaces mapped to admin yet', { adminEmail });
            spaces = [];
        }
        
        // Cache the mapped spaces
        if (spaces.length > 0) {
            storeCachedSpaces(adminEmail, spaces);
            logger.info('Cached mapped spaces for admin', { 
                count: spaces.length,
                spaceNames: spaces.map(s => s.name)
            });
        }

        // Store admin data without service DID (simplified)
        storeAdminServiceDidData(adminEmail, adminDid, null, null);
        
        // Create session with the provided DID if available, otherwise use adminDid
        const { sessionId } = createSession(adminEmail, providedDid || adminDid);
        logger.info('Authorization complete with explicit mapping', { sessionId });

        return { sessionId };

    } catch (error) {
        logger.error('Authorization failed', { adminEmail, error: error.message });
        throw error;
    }
}

/**
 * Initial login with email + DID
 * This establishes the Storacha account and automatically gets only the spaces that belong to that account
 * Uses fresh w3up client to ensure admin isolation
 * This function is now designed to be called in the background.
 */
export async function requestAdminLoginViaW3Up(email, did, sessionId) {
    logger.info('🔍 BACKGROUND LOGIN - Starting admin login with automatic space isolation', { email, did, sessionId });
    
    if (!email || !did || !sessionId) {
        throw new Error('Email, DID, and SessionId are required for background login processing');
    }

    // Create a fresh w3up client for this admin login
    // This ensures the client only has access to spaces for this specific account
    logger.info('🔍 FRESH CLIENT - Creating clean w3up client for admin', { email });
    
    let freshClient;
    try {
        const { create } = await import('@web3-storage/w3up-client');
        const { StoreMemory } = await import('@web3-storage/w3up-client/stores/memory');
        
        freshClient = await create({ 
            store: new StoreMemory() 
        });
        
        logger.info('🔍 FRESH CLIENT - Clean client created', { 
            email,
            clientDid: freshClient.did(),
            initialSpaces: freshClient.spaces().length,
            expectedSpaces: 0
        });
    } catch (error) {
        logger.error('Failed to create fresh w3up client', { error: error.message });
        throw new Error('Failed to create w3up client for admin login');
    }
    
    try {
        // Step 1: Login with email using the fresh client
        logger.info('🔍 W3UP LOGIN - Attempting login with fresh client', { email });
        const account = await freshClient.login(email);
        logger.info('🔍 W3UP LOGIN - Email login successful', { 
            email,
            accountDid: account.did(),
            accountEmail: account.email || 'unknown'
        });
        
        // Step 2: Wait for payment plan if needed
        try {
            logger.info('🔍 W3UP PLAN - Checking payment plan');
            await account.plan.wait();
            logger.info('🔍 W3UP PLAN - Payment plan confirmed');
        } catch (e) {
            logger.info('🔍 W3UP PLAN - No payment plan required or already set', { error: e.message });
        }

        // Step 3: Get spaces that belong to this specific account
        const accountSpaces = freshClient.spaces();
        logger.info('🔍 SPACES - Account-specific spaces retrieved', { 
            email,
            accountDid: account.did(),
            spacesFromAccount: accountSpaces.length,
            spacesDetails: accountSpaces.map((space, index) => ({
                index: index + 1,
                did: space.did(),
                name: space.name || 'Unnamed'
            }))
        });

        // Step 4: Store the DID-email mapping
        const db = getDatabase();
        db.prepare(`
            INSERT OR REPLACE INTO did_email_mapping (did, email, createdAt)
            VALUES (?, ?, ?)
        `).run(did, email, Date.now());
        logger.info('🔍 MAPPING - Created DID-email mapping', { did, email });

        // Step 5: Automatically store the account's spaces
        const spacesList = [];
        for (const space of accountSpaces) {
            const spaceName = space.name || space.did();
            const spaceDid = space.did();
            
            // Store this space as belonging to this admin
            storeAdminSpace(email, spaceDid, spaceName);
            
            spacesList.push({
                did: spaceDid,
                name: spaceName
            });
            
            logger.info('🔍 AUTO-ASSIGNED - Space automatically assigned to admin', { 
                email, 
                spaceDid, 
                spaceName 
            });
        }

        // Step 6: Set current space to the first available space (if any)
        if (accountSpaces.length > 0) {
            await freshClient.setCurrentSpace(accountSpaces[0].did());
            logger.info('🔍 CURRENT SPACE - Set current space', { 
                spaceDid: accountSpaces[0].did() 
            });
        } else {
            logger.info('🔍 NO SPACES - No spaces available for admin', { email });
        }
        
        // Step 7: Cache the account's spaces
        storeCachedSpaces(email, spacesList);
        logger.info('🔍 CACHED - Cached account spaces', { 
            count: spacesList.length,
            spaceNames: spacesList.map(s => s.name)
        });
        
        // Step 8: Update session to mark as verified
        updateSessionVerification(sessionId, true);
        
        logger.info('✅ BACKGROUND SUCCESS - Admin login completed and session verified', {
            email,
            sessionId,
            spacesAssigned: spacesList.length
        });
        
        return { 
            message: 'Login successful - spaces automatically assigned from account',
            sessionId: sessionId,
            did: did,
            spaces: spacesList,
            spacesAssigned: spacesList.length
        };
    } catch (error) {
        logger.error('Background admin login failed', { email, sessionId, error: error.message });
        // Optionally, you could update the session to mark it as failed
        updateSessionVerification(sessionId, false);
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

    // Verify the DID exists in our system
    const db = getDatabase();
    const mapping = db.prepare(`
        SELECT email FROM did_email_mapping 
        WHERE did = ? AND email = ?
    `).get(did, email);

    if (!mapping) {
        throw new Error('No account found for this DID and email combination. Please complete initial login first.');
    }

    // Load only explicitly mapped spaces for this admin
    const mappedSpaces = getAdminSpaces(email);
    logger.info('Loaded explicitly mapped spaces for subsequent login', { 
        email, 
        spaceCount: mappedSpaces.length 
    });

    // Store admin data for subsequent login (simplified - no w3up re-auth needed)
    storeAdminServiceDidData(email, did, null, null);
    
    // Create a new session for this DID - it's a subsequent login, so it's already verified
    const { sessionId } = createSession(email, did, {}, true);
    logger.info('Created new verified session for subsequent login', { did, email });
    
    return {
        message: 'Subsequent login successful',
        sessionId,
        did: did,
        spaces: mappedSpaces,
        verified: true
    };
}

/**
 * Unified login function that handles both initial and subsequent logins
 */
export async function handleAdminLogin(email, did) {
    logger.info('Handling admin login with secure mapping', { email, did });
    
    if (!email || !did) {
        throw new Error('Both email and DID are required for login');
    }

    const db = getDatabase();
    const existingMapping = db.prepare(`
        SELECT email FROM did_email_mapping 
        WHERE did = ? AND email = ?
    `).get(did, email);

    if (!existingMapping) {
        // This is an initial login.
        logger.info('Performing initial login. Creating unverified session and starting background verification.', { email, did });
        
        // 1. Create a session immediately, marked as not verified.
        const { sessionId } = createSession(email, did, {}, false);

        // 2. Trigger the long-running verification process in the background.
        requestAdminLoginViaW3Up(email, did, sessionId).catch(error => {
            logger.error('Unhandled error in background login process', {
                email,
                sessionId,
                error: error.message
            });
            updateSessionVerification(sessionId, false);
        });

        // 3. Return the session ID to the client.
        return {
            message: 'Login initiated. Please verify your email. Poll the session endpoint for completion.',
            sessionId: sessionId,
            did: did,
            verified: false // Explicitly tell the client the session is not yet verified
        };

    } else {
        // This is a subsequent login - just validate and create a (verified) session
        logger.info('Performing subsequent login with secure mapping', { email, did });
        return handleSubsequentLogin(email, did);
    }
}

/**
 * POST /auth/w3up/logout - Storacha service logout
 * 
 * Attempts to logout from the Storacha service directly, removing
 * any cached account information. This is separate from local session
 * management and affects the underlying Storacha client state.
 * 
 * Use this for complete cleanup of Storacha authentication state.
 */
export async function logoutFromW3Up() {
    logger.info('Attempting to logout from Storacha service');
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
        logger.error('Error during Storacha logout', { error: error.message });
        throw error;
    }
}

// Keep the old function for backward compatibility, but mark as deprecated
export async function handleDidLogin(did) {
    logger.warn('handleDidLogin is deprecated. Use handleAdminLogin with email + DID instead.');
    throw new Error('Please use handleAdminLogin with both email and DID for security');
} 