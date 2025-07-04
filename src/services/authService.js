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
import { getAdminClient, createAndAuthorizeNewClient } from '../lib/adminClientManager.js';

/**
 * Check if a w3up account is verified and has a valid payment plan
 * For new accounts, this will trigger email verification
 */
async function checkAccountVerification(client, email) {
    try {
        logger.info('VERIFICATION - Checking account verification status', { email });
        
        // Method 1: Try to access account information
        // A verified account should be able to access basic account info
        try {
            const accounts = client.accounts();
            if (accounts && accounts.length > 0) {
                logger.info('VERIFICATION - Account found via accounts()', { 
                    email, 
                    accountCount: accounts.length 
                });
                return true;
            }
        } catch (accountError) {
            logger.debug('VERIFICATION - accounts() method not available or failed', { 
                email, 
                error: accountError.message 
            });
        }

        // Method 2: Try to list spaces - if this works, the account is verified
        // Even if they have no spaces, a verified account can call this method
        try {
            const spaces = client.spaces();
            logger.info('VERIFICATION - Successfully called spaces(), account is verified', { 
                email, 
                spaceCount: spaces.length 
            });
            return true;
        } catch (spacesError) {
            logger.info('VERIFICATION - spaces() call failed, attempting email verification', { 
                email, 
                error: spacesError.message 
            });
            
            // Method 3: If spaces() fails, try to trigger email verification
            try {
                logger.info('VERIFICATION - Triggering email verification', { email });
                await client.login(email);
                logger.info('VERIFICATION - Email verification initiated, user needs to check email', { email });
                return false; // Return false until user verifies email
            } catch (loginError) {
                logger.error('VERIFICATION - Email verification failed', { 
                    email, 
                    error: loginError.message 
                });
                return false;
            }
        }

    } catch (error) {
        logger.error('VERIFICATION - Account verification check failed', { 
            email, 
            error: error.message 
        });
        return false;
    }
}

/**
 * Background space sync for subsequent logins - refresh cache only
 * This preserves existing verification status and only updates space cache
 */
async function syncSpacesInBackgroundOnly(email, sessionId) {
    try {
        logger.info('SPACE REFRESH - Starting space cache refresh for verified account', { email, sessionId });

        const adminClient = await getAdminClient(email);
        const client = adminClient.getClient();

        // For subsequent logins, we need to ensure the client is authorized with w3up
        // This won't trigger a new email loop but authorizes the agent for this session
        try {
            await client.login(email);
            logger.info('SPACE REFRESH - Client authorized with w3up for subsequent login', { email });
            // After login, we must explicitly claim the delegations to populate the agent's store
            await client.capability.access.claim();
            logger.info('SPACE REFRESH - Claimed delegations from w3up', { email });
        } catch (error) {
            logger.warn('SPACE REFRESH - Client login or claim call failed. Continuing.', {
                email,
                error: error.message
            });
        }

        // Just sync spaces, don't touch verification status
        await syncSpacesInBackground(client, email, sessionId);
        
        logger.info('✅ SPACE REFRESH - Cache refresh completed for verified account', {
            email,
            sessionId
        });

    } catch (error) {
        logger.error('SPACE REFRESH - Cache refresh failed', { 
            email, 
            sessionId, 
            error: error.message 
        });
        // Don't throw - cache refresh failure shouldn't affect anything
    }
}

/**
 * Background space sync function - purely for caching
 * This runs independently of verification status
 */
async function syncSpacesInBackground(client, email, sessionId) {
    try {
        logger.info('SPACES SYNC - Starting background space synchronization', { email, sessionId });

        const accountSpaces = await client.spaces();
        logger.info('SPACES SYNC - Retrieved spaces from w3up client', { 
            email,
            spaceCount: accountSpaces.length
        });

        const db = getDatabase();
        const spacesList = [];
        
        for (const space of accountSpaces) {
            const spaceName = space.name || space.did();
            const spaceDid = space.did();
            
            storeAdminSpace(email, spaceDid, spaceName);
            
            spacesList.push({
                did: spaceDid,
                name: spaceName
            });
            
            logger.info('SPACES SYNC - Cached space for admin', { email, spaceDid, spaceName });
        }

        if (accountSpaces.length > 0) {
            await client.setCurrentSpace(accountSpaces[0].did());
        }

        storeCachedSpaces(email, spacesList);
        
        logger.info('✅ SPACES SYNC - Background space sync completed', {
            email,
            sessionId,
            spacesCached: spacesList.length
        });

        return spacesList;

    } catch (error) {
        logger.error('SPACES SYNC - Background space sync failed', { 
            email, 
            sessionId, 
            error: error.message 
        });
        // Don't throw - space sync failure shouldn't affect verification status
        return [];
    }
}

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
 * Background verification and space sync function
 * This separates email/account verification from space fetching
 * Verification is based on w3up account status, not space availability
 */
export async function requestAdminLoginViaW3Up(email, did, sessionId) {
    logger.info('BACKGROUND PROCESS - Starting background verification and space sync', { email, did, sessionId });

    if (!email || !did || !sessionId) {
        throw new Error('Email, DID, and SessionId are required for background processing');
    }

    let isVerified = false;
    
    try {
        const adminClient = await getAdminClient(email);
        const client = adminClient.getClient();

        logger.info('W3UP CLIENT - Using hydrated client for verification and sync', { 
            email, 
            agentDid: client.agent.did() 
        });

        // STEP 1: Check account verification status (email + payment plan)
        // This is independent of whether they have spaces or not
        isVerified = await checkAccountVerification(client, email);
        
        logger.info('VERIFICATION RESULT', { 
            email, 
            sessionId, 
            isVerified,
            reason: isVerified ? 'Account verified with w3up' : 'Account not verified or no payment plan'
        });

        // Update session verification status immediately based on account verification
        updateSessionVerification(sessionId, isVerified);

        // STEP 2: Store DID-email mapping (regardless of verification status)
        const db = getDatabase();
        db.prepare(`
            INSERT OR REPLACE INTO did_email_mapping (did, email, createdAt)
            VALUES (?, ?, ?)
        `).run(did, email, Date.now());
        logger.info('MAPPING - Ensured DID-email mapping exists', { did, email });

        // STEP 3: Background space sync (only if account is verified)
        // This is pure caching and doesn't affect verification status
        if (isVerified) {
            await syncSpacesInBackground(client, email, sessionId);
        } else {
            logger.info('SPACES SYNC - Skipping space sync for unverified account', { email, sessionId });
        }
        
        logger.info('✅ BACKGROUND COMPLETE - Process completed', {
            email,
            sessionId,
            verified: isVerified,
            spaceSyncAttempted: isVerified
        });

    } catch (error) {
        logger.error('Background process failed', { 
            email, 
            sessionId, 
            error: error.message, 
            stack: error.stack 
        });
        
        // Always update verification status based on what we determined
        // Don't let space sync errors affect verification
        updateSessionVerification(sessionId, isVerified);
    }
}

/**
 * Asynchronously onboards a new admin in the background. It now manages the agent's status.
 * @param {string} email The email of the new admin.
 * @param {string} did The admin's client-side DID.
 * @param {string} sessionId The session ID to update upon completion.
 */
async function onboardNewAdminInBackground(email, did, sessionId) {
    const db = getDatabase();
    try {
        logger.info('BACKGROUND: Starting new admin onboarding', { email });
        const { client, principalKey } = await createAndAuthorizeNewClient(email);

        // After authorizing, we must claim delegations to get access to spaces
        await client.capability.access.claim();
        logger.info('BACKGROUND: Successfully claimed delegations for new admin', { email });

        // Onboarding was successful, update the agent to active and store the key
        const now = Date.now();
        db.prepare(`
            UPDATE admin_agents 
            SET agentData = ?, status = 'active', updatedAt = ? 
            WHERE adminEmail = ? AND status = 'pending'
        `).run(principalKey, now, email);
        logger.info('BACKGROUND: Stored new server-side agent key and marked as active', { email });

        // Ensure the did_email_mapping is created or updated
        db.prepare('INSERT OR REPLACE INTO did_email_mapping (email, did, createdAt) VALUES (?, ?, ?)').run(email, did, now);

        // Now that delegations are claimed, fetch and cache the spaces
        const spaces = await client.spaces();
        const spacesList = [];
        for (const space of spaces) {
            const spaceName = space.name || space.did();
            const spaceDid = space.did();
            storeAdminSpace(email, spaceDid, spaceName);
            spacesList.push({ did: spaceDid, name: spaceName });
        }
        logger.info(`BACKGROUND: Cached ${spacesList.length} initial spaces for new admin`, { email });

        // Finally, verify the session
        updateSessionVerification(sessionId, true);
        logger.info('BACKGROUND: Admin onboarding successful, session verified', { email, sessionId });

    } catch (error) {
        logger.error('BACKGROUND: Admin onboarding failed', { email, sessionId, error: error.message });
        // Mark the agent as 'failed' so the user can retry on next login
        db.prepare("UPDATE admin_agents SET status = 'failed' WHERE adminEmail = ?").run(email);
        updateSessionVerification(sessionId, false);
    }
}

/**
 * Handles an admin login, dispatching to the correct flow based on agent status.
 */
export async function handleAdminLogin(email, did) {
    logger.info('Handling admin login request', { email });
    const db = getDatabase();
    
    // Check for an existing agent and its status
    const adminAgent = db.prepare('SELECT agentData, status FROM admin_agents WHERE adminEmail = ?').get(email);

    if (adminAgent && adminAgent.status === 'active') {
        // --- Subsequent Login Flow ---
        return handleSubsequentLogin(email, did, adminAgent.agentData);

    } else {
        // --- First-Time or Failed Onboarding Flow ---
        if (adminAgent) {
            logger.info('Previous admin onboarding was incomplete or failed. Retrying.', { email, status: adminAgent.status });
            // Clean up the old failed/pending entry to allow a fresh start
            db.prepare('DELETE FROM admin_agents WHERE adminEmail = ?').run(email);
        }
        
        logger.info('New admin or retrying onboarding. Returning unverified session.', { email });
        
        // Create a 'pending' record to lock this user's onboarding process
        const now = Date.now();
        db.prepare("INSERT INTO admin_agents (adminEmail, status, agentData, createdAt, updatedAt) VALUES (?, 'pending', '', ?, ?)")
            .run(email, now, now);
        
        const { sessionId } = createSession(email, did, {}, false);

        // Start the background process without waiting for it to complete
        onboardNewAdminInBackground(email, did, sessionId);

        return {
            message: 'Login initiated. Please check your email to verify your account.',
            sessionId,
            did,
            verified: false,
        };
    }
}

/**
 * Handles a subsequent login for an existing, active admin.
 */
async function handleSubsequentLogin(email, did, principalKey) {
    logger.info('Performing subsequent login for active admin', { email });
    const db = getDatabase();

    // Security Check: Verify the provided DID matches the one on record
    const mapping = db.prepare('SELECT did FROM did_email_mapping WHERE email = ?').get(email);
    if (!mapping || mapping.did !== did) {
        throw new Error('DID does not match the registered DID for this email.');
    }

    // The getSpacesForExistingAdmin function will now handle the client creation and space fetching
    const spacesList = await getSpacesForExistingAdmin(email, principalKey);

    const { sessionId } = createSession(email, did, {}, true);
    const loginResponse = {
        message: 'Login successful',
        sessionId,
        did,
        spaces: spacesList,
        verified: true,
    };
    logger.info('Login response for subsequent login', { email, response: loginResponse });
    return loginResponse;
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

async function getSpacesForExistingAdmin(email, principalKey) {
    const client = await getAdminClient(email, principalKey);

    // For existing admins, we also need to ensure we have the latest delegations
    try {
        await client.capability.access.claim();
        logger.info('Refreshed delegations for existing admin', { email });
    } catch (error) {
        logger.warn('Could not refresh delegations for existing admin, using cached info.', { email, error: error.message });
    }

    const spaces = await client.spaces();
    logger.info(`Found ${spaces.length} spaces for existing admin`, { email });

    // Cache spaces for faster subsequent requests
    const spacesList = [];
    for (const space of spaces) {
        const spaceName = space.name || space.did();
        const spaceDid = space.did();
        storeAdminSpace(email, spaceDid, spaceName);
        spacesList.push({ did: spaceDid, name: spaceName });
    }
    logger.info(`Refreshed ${spacesList.length} spaces for existing admin`, { email, spacesList });

    return spacesList;
} 