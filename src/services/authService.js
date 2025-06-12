import { getClient } from '../lib/w3upClient.js';
import {
    createSession,
    storeAdminServiceDidData,
    storeCachedSpaces,
    storeAdminSpace,
    getAdminSpaces
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
        // Skip Admin Service DID generation - use admin account directly
        // Since we're working with DIDs for identification only, not principals
        const adminAccount = client.agent;
        logger.debug('Using admin account directly (no service DID)');

        // Only return spaces that have been explicitly associated with this admin's email
        // This maintains proper space isolation between different admin accounts
        const existingSpaces = getAdminSpaces(adminEmail);
        let spaces = [];
        
        if (existingSpaces.length > 0) {
            // Admin already has spaces associated - use those
            spaces = existingSpaces.map(space => ({
                name: space.spaceName,
                did: space.spaceDid
            }));
            logger.info('Using existing spaces for admin', { 
                adminEmail, 
                spaceCount: spaces.length 
            });
        } else {
            // No spaces associated with this admin yet
            // This should not happen in normal flow, but handle gracefully
            logger.warn('No spaces found for admin in database', { adminEmail });
            spaces = [];
        }
        
        // Cache the spaces
        if (spaces.length > 0) {
            storeCachedSpaces(adminEmail, spaces);
            logger.info('Found and stored spaces for admin', { 
                count: spaces.length,
                spaceNames: spaces.map(s => s.name)
            });
        }

        // Store admin data without service DID (simplified)
        storeAdminServiceDidData(adminEmail, adminDid, null, null);
        
        // Create session with the provided DID if available, otherwise use adminDid
        const { sessionId } = createSession(adminEmail, providedDid || adminDid);
        logger.info('Authorization complete (simplified)', { sessionId });

        return { sessionId };

    } catch (error) {
        logger.error('Authorization failed', { adminEmail, error: error.message });
        throw error;
    }
}

/**
 * Initial login with email + DID
 * This establishes the Storacha account and creates a long-term session
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
            
            // Store the newly created space as belonging to this admin
            // This ensures proper ownership tracking for the new space
            storeAdminSpace(email, space.did(), spaceName);
        } else {
            // Handle existing spaces by checking admin association
            // For initial login, we need to determine which space belongs to this admin
            const existingAdminSpaces = getAdminSpaces(email);
            
            if (existingAdminSpaces.length > 0) {
                // Admin already has spaces associated (shouldn't happen in initial login, but handle it)
                logger.info('Admin already has spaces in database during initial login', { 
                    email, 
                    spaceCount: existingAdminSpaces.length 
                });
                spacesList = existingAdminSpaces.map(adminSpace => ({
                    did: adminSpace.spaceDid,
                    name: adminSpace.spaceName
                }));
                space = spaces.find(s => s.did() === existingAdminSpaces[0].spaceDid);
            } else {
                // This is truly an initial login - we need to associate a space with this admin
                // For proper isolation, we should not automatically assign any space
                // Instead, the admin should explicitly choose which space to use
                logger.warn('Initial login with existing spaces but no admin association', { 
                    email, 
                    availableSpaces: spaces.length 
                });
                
                // For now, don't automatically assign any space - require explicit association
                // This prevents accidentally giving access to wrong spaces
                throw new Error('Account has existing spaces but no space is associated with this admin. Please contact support to associate a space with your account.');
            }
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

        // Load spaces that have been assigned to this admin from the database
        // This ensures that admins only see spaces they have explicit access to
        const adminSpaces = getAdminSpaces(email);
        logger.info('Loaded admin spaces for subsequent login', { 
            email, 
            spaceCount: adminSpaces.length 
        });

        // Store admin data for subsequent login (simplified - no w3up re-auth needed)
        storeAdminServiceDidData(email, did, null, null);
        
        // Create a new session for this DID
        const { sessionId } = createSession(email, did);
        logger.info('Created new session for subsequent login', { did, email });
        
        return {
            message: 'Subsequent login successful',
            sessionId,
            did: did,
            spaces: adminSpaces
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
            // This is an initial login - need to authenticate with Storacha
            logger.info('Performing initial login with Storacha', { email, did });
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