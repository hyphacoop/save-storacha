/**
 * Core Data Store Module
 * 
 * This module manages the application's core data storage system, handling:
 * 1. User Principals - Cryptographic identities for users
 * 2. Delegations - Access grants between users and spaces
 * 3. Admin Data - Administrative credentials and session management
 * 
 * The system uses a dual-layer storage approach:
 * - In-memory stores for fast access (Map objects)
 * - SQLite database for persistence
 * 
 * Key Features:
 * - Automatic cleanup of expired delegations
 * - Development mode integration with devAuth
 * - Session management for admin users
 * - Delegation revocation support
 * 
 * Storage Structure:
 * - adminStore: Maps admin emails to their service credentials
 * - sessionStore: Manages admin user sessions
 * - delegationStore: Maps user DIDs to their space delegations
 * - userPrincipalStore: Maps user DIDs to their cryptographic principals
 */

import { logger } from './logger.js';
import { getDatabase } from './db.js';
import { generatePrincipal, exportPrincipal, importPrincipal } from './signer.js';
import { getDevPrincipal, getDevUserDid, isDevAuth } from './devAuth.js';
import { ed25519 } from '@ucanto/principal';
import { sha256 } from '@ucanto/core';

// Stores adminEmail -> { adminServicePrincipal, adminToAdminServiceDidDelegationCarString, adminDid, sessionId (optional), sessionExpiresAt (optional) }
const adminStore = new Map();
const sessionStore = new Map(); // Stores sessionId -> { email, expiresAt }

// Store for delegations: Map<userDid, Array<{spaceDid, delegationCid, delegationCar}>>
const delegationStore = new Map();

// Store for user principals: Map<userDid, { principal, createdAt }>
const userPrincipalStore = new Map();

const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Add cleanup interval constant
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

// Track cleanup intervals so we can clear them
let cleanupDelegationsInterval = null;
let cleanupSessionsInterval = null;

/**
 * Admin Data Management
 * Stores and manages administrative credentials and service principals.
 * This includes the admin's DID, service principal, and delegation chain.
 */

export function storeAdminServiceDidData(email, adminDid, adminServicePrincipal, adminToAdminServiceDidDelegationCarString) {
    const existingAdmin = adminStore.get(email) || {};
    adminStore.set(email, {
        ...existingAdmin,
        adminDid,
        adminServicePrincipal, // Can be null in simplified mode
        adminToAdminServiceDidDelegationCarString, // Can be null in simplified mode
    });
    console.log(`Stored Admin data for ${email}. Admin DID: ${adminDid} (simplified mode: ${adminServicePrincipal ? 'with service DID' : 'no service DID'})`);
}

export function getAdminData(email) {
    return adminStore.get(email);
}

/**
 * Session Management
 * Handles admin user sessions with configurable duration.
 * Sessions are persisted in the database and loaded on startup.
 * Includes automatic expiration and cleanup.
 */

export function createSession(email, adminDid = null, metadata = {}, isVerified = false) {
    const sessionId = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const expiresAt = now + SESSION_DURATION;

    // For verified users, set both email and DID verification flags
    // For new users, leave verification flags as false (they'll be set individually)
    const emailVerified = isVerified ? 1 : 0;
    const didVerified = 0; // DID verification always starts as false, set via signature verification
    const finalIsVerified = isVerified ? 1 : 0;

    // Store in database
    try {
        const db = getDatabase();
        db.prepare(`
            INSERT INTO account_sessions (
                sessionId, email, did, createdAt, lastActiveAt, 
                expiresAt, userAgent, ipAddress, isActive, isVerified, emailVerified, didVerified
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, true, ?, ?, ?)
        `).run(
            sessionId, 
            email, 
            adminDid,
            now,
            now,
            expiresAt,
            metadata.userAgent,
            metadata.ipAddress,
            finalIsVerified,
            emailVerified,
            didVerified
        );
        
        logger.info('Created session', { 
            sessionId, 
            email,
            adminDid,
            emailVerified: !!emailVerified,
            didVerified: !!didVerified,
            isVerified: !!finalIsVerified,
            expiresAt: new Date(expiresAt).toISOString()
        });
    } catch (error) {
        logger.error('Failed to create session in database', { 
            email, 
            error: error.message 
        });
        throw error;
    }

    // Also update memory store for faster access
    sessionStore.set(sessionId, { 
        email, 
        expiresAt, 
        adminDid,
        lastActiveAt: now,
        isActive: true,
        isVerified: !!finalIsVerified,
        emailVerified: !!emailVerified,
        didVerified: !!didVerified
    });
    
    return { sessionId, expiresAt };
}

export function getSession(sessionId) {
    // First try memory store for faster access
    const memorySession = sessionStore.get(sessionId);
    if (memorySession && memorySession.expiresAt > Date.now() && memorySession.isActive) {
        // Update last active timestamp
        updateSessionActivity(sessionId);
        return memorySession;
    }

    // If not in memory or expired, try database
    try {
        const db = getDatabase();
        const session = db.prepare(`
            SELECT email, did as adminDid, expiresAt, isActive, isVerified
            FROM active_account_sessions
            WHERE sessionId = ?
        `).get(sessionId);

        if (session) {
            // Update last active timestamp
            updateSessionActivity(sessionId);
            // Update memory store
            sessionStore.set(sessionId, {
                ...session,
                isVerified: !!session.isVerified, // Ensure boolean
                lastActiveAt: Date.now()
            });
            return {
                ...session,
                isVerified: !!session.isVerified
            };
        }

        // If session exists but is expired or inactive, clean it up
        if (memorySession) {
            deactivateSession(sessionId);
        }
        return null;
    } catch (error) {
        logger.error('Failed to get session from database', { 
            sessionId, 
            error: error.message 
        });
        return null;
    }
}

export function clearSession(sessionId) {
    try {
        const db = getDatabase();
        db.prepare('UPDATE account_sessions SET isActive = false WHERE sessionId = ?').run(sessionId);
        sessionStore.delete(sessionId);
        logger.info('Cleared session', { sessionId });
    } catch (error) {
        logger.error('Failed to clear session from database', { 
            sessionId, 
            error: error.message 
        });
    }
}

// New function to deactivate a session
export function deactivateSession(sessionId) {
    try {
        const db = getDatabase();
        db.prepare('UPDATE account_sessions SET isActive = false WHERE sessionId = ?').run(sessionId);
        sessionStore.delete(sessionId);
        logger.info('Deactivated session', { sessionId });
    } catch (error) {
        logger.error('Failed to deactivate session', { 
            sessionId, 
            error: error.message 
        });
    }
}

// New function to update session activity
function updateSessionActivity(sessionId) {
    const now = Date.now();
    try {
        const db = getDatabase();
        db.prepare('UPDATE account_sessions SET lastActiveAt = ? WHERE sessionId = ?').run(now, sessionId);
        const session = sessionStore.get(sessionId);
        if (session) {
            session.lastActiveAt = now;
            sessionStore.set(sessionId, session);
        }
    } catch (error) {
        logger.error('Failed to update session activity', { 
            sessionId, 
            error: error.message 
        });
    }
}

// New function to get all active sessions for an account
export function getAccountSessions(email, includeInactive = false) {
    try {
        const db = getDatabase();
        const sessions = db.prepare(`
            SELECT sessionId, did as adminDid, createdAt, lastActiveAt, expiresAt, 
                   userAgent, ipAddress, isActive
            FROM account_sessions
            WHERE email = ? ${includeInactive ? '' : 'AND isActive = true'}
            ORDER BY lastActiveAt DESC
        `).all(email);
        
        return sessions;
    } catch (error) {
        logger.error('Failed to get account sessions', { 
            email, 
            error: error.message 
        });
        return [];
    }
}

// New function to deactivate all sessions for an account
export function deactivateAccountSessions(email) {
    try {
        const db = getDatabase();
        const result = db.prepare(`
            UPDATE account_sessions 
            SET isActive = false 
            WHERE email = ? AND isActive = true
        `).run(email);

        // Clear from memory store
        for (const [sessionId, session] of sessionStore.entries()) {
            if (session.email === email) {
                sessionStore.delete(sessionId);
            }
        }

        logger.info('Deactivated all sessions for account', { 
            email, 
            count: result.changes 
        });
        return result.changes;
    } catch (error) {
        logger.error('Failed to deactivate account sessions', { 
            email, 
            error: error.message 
        });
        return 0;
    }
}

// Load sessions from database into memory on startup
export async function loadSessionsFromDatabase() {
    try {
        const db = getDatabase();
        const sessions = db.prepare(`
            SELECT sessionId, email, did as adminDid, expiresAt, isActive, lastActiveAt
            FROM active_account_sessions
        `).all();

        // Update memory store
        for (const session of sessions) {
            sessionStore.set(session.sessionId, session);
        }

        logger.info('Loaded sessions from database', { 
            count: sessions.length 
        });

        // Run initial cleanup
        await cleanupExpiredSessions();
    } catch (error) {
        logger.error('Failed to load sessions from database', { 
            error: error.message 
        });
    }
}

// Cleanup expired sessions
async function cleanupExpiredSessions() {
    try {
        const db = getDatabase();
        const now = Date.now();
        
        // Deactivate expired sessions
        const result = db.prepare(`
            UPDATE account_sessions 
            SET isActive = false 
            WHERE expiresAt <= ? AND isActive = true
        `).run(now);

        if (result.changes > 0) {
            logger.info('Cleaned up expired sessions', { 
                count: result.changes 
            });

            // Also clean up memory store
            for (const [sessionId, session] of sessionStore.entries()) {
                if (session.expiresAt <= now) {
                    sessionStore.delete(sessionId);
                }
            }
        }
    } catch (error) {
        logger.error('Failed to cleanup expired sessions', { 
            error: error.message 
        });
    }
}

import crypto from 'crypto';

/**
 * User Principal Management
 * Handles the lifecycle of user cryptographic identities (principals).
 * Principals are used for signing and authentication operations.
 * In development mode, principals are managed by devAuth instead.
 */

export async function storeUserPrincipal(userDid, principal) {
    // In dev mode, don't store principals - they come from dev cache
    if (isDevAuth()) {
        logger.debug('Dev mode: Skipping principal storage', { userDid });
        return;
    }

    const now = Date.now();
    
    // Update memory store
    userPrincipalStore.set(userDid, {
        principal,
        createdAt: now
    });

    // Update database
    try {
        const db = getDatabase();
        const exportedPrincipal = await exportPrincipal(principal);
        db.prepare(`
            INSERT OR REPLACE INTO user_principals 
            (userDid, principalDid, principalKey, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            userDid, 
            principal.did(),
            exportedPrincipal, // Use the JSON string directly
            now,
            now
        );
        
        logger.info('Stored user principal', { 
            userDid,
            principalDid: principal.did()
        });
    } catch (error) {
        logger.error('Failed to store user principal in database', { 
            userDid, 
            error: error.message 
        });
        // Don't throw - we still have the in-memory store
    }
}

export async function getUserPrincipal(userDid) {
    // In dev mode, use dev principal
    if (isDevAuth()) {
        const devPrincipal = await getDevPrincipal();
        if (devPrincipal) {
            logger.debug('Dev mode: Using dev principal', { userDid });
            return devPrincipal;
        }
    }

    // First try memory store
    const memoryPrincipal = userPrincipalStore.get(userDid);
    if (memoryPrincipal) {
        return memoryPrincipal.principal;
    }

    // If not in memory, try database
    try {
        const db = getDatabase();
        const row = db.prepare(`
            SELECT principalDid, principalKey
            FROM user_principals
            WHERE userDid = ?
        `).get(userDid);

        if (row) {
            // Reconstruct the principal from stored key material
            const principal = importPrincipal(row.principalKey);
            
            // Update memory store
            userPrincipalStore.set(userDid, {
                principal,
                createdAt: row.createdAt
            });

            return principal;
        }
    } catch (error) {
        logger.error('Failed to get user principal from database', { 
            userDid, 
            error: error.message 
        });
    }

    // If no stored principal found, derive one from the user DID (same as token generation)
    try {
        logger.info('No stored principal found, deriving from user DID', { userDid });
        const secretBytes = new TextEncoder().encode(userDid);
        const { digest } = await sha256.digest(secretBytes);
        const principal = await ed25519.Signer.derive(digest);
        
        // Store the derived principal for future use
        await storeUserPrincipal(userDid, principal);
        
        logger.info('Derived and stored principal from user DID', { 
            userDid, 
            principalDid: principal.did() 
        });
        
        return principal;
    } catch (error) {
        logger.error('Failed to derive principal from user DID', { 
            userDid, 
            error: error.message 
        });
        return null;
    }
}

/**
 * Delegation Management
 * Manages access grants between users and spaces.
 * Delegations are stored both in memory and database for:
 * - Fast access to active delegations
 * - Persistence across server restarts
 * - Automatic expiration handling
 * - Multi-admin support with admin tracking
 */

export function storeDelegation(userDid, spaceDid, delegationCid, delegationCar, expiresAt = null, createdBy = null, spaceName = null) {
    // In dev mode, don't store delegations - they come from dev cache
    if (isDevAuth()) {
        return;
    }

    const delegation = {
        userDid,
        spaceDid,
        spaceName,
        delegationCid,
        delegationCar,
        expiresAt,
        createdBy, // Track which admin created this delegation
        createdAt: Date.now()
    };

    // Store in memory
    if (!delegationStore.has(userDid)) {
        delegationStore.set(userDid, []);
    }
    delegationStore.get(userDid).push(delegation);

    // Store in database
    try {
        const db = getDatabase();
        const now = Date.now();
        db.prepare(`
            INSERT OR REPLACE INTO delegations
            (userDid, spaceDid, spaceName, delegationCid, delegationCar, expiresAt, createdBy, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userDid, spaceDid, spaceName, delegationCid, delegationCar, expiresAt, createdBy, now, now);
        
        logger.debug('Delegation stored in database', { 
            userDid, 
            spaceDid, 
            delegationCid,
            createdBy 
        });
    } catch (error) {
        logger.error('Failed to store delegation in database', { 
            userDid, 
            spaceDid, 
            error: error.message 
        });
    }
}

export function getDelegationsForUser(userDid) {
    // In dev mode, return empty array - delegations come from dev cache
    if (isDevAuth()) {
        logger.debug('Dev mode: Using empty delegations', { userDid });
        return [];
    }

    // First try memory store
    const memoryDelegations = delegationStore.get(userDid);
    if (memoryDelegations) {
        // Filter out expired delegations from memory
        const now = Date.now();
        const activeDelegations = memoryDelegations.filter(d => 
            !d.expiresAt || d.expiresAt > now
        );
        if (activeDelegations.length !== memoryDelegations.length) {
            // Update memory store with only active delegations
            delegationStore.set(userDid, activeDelegations);
        }
        return activeDelegations;
    }

    // If not in memory, try database
    try {
        const db = getDatabase();
        const delegations = db.prepare(`
            SELECT spaceDid, spaceName, delegationCid, delegationCar, createdAt, expiresAt, createdBy
            FROM active_delegations
            WHERE userDid = ?
            ORDER BY createdAt DESC
        `).all(userDid);

        // Update memory store
        if (delegations.length > 0) {
            delegationStore.set(userDid, delegations);
        }

        return delegations;
    } catch (error) {
        logger.error('Failed to get delegations from database', { 
            userDid, 
            error: error.message 
        });
        return [];
    }
}

export function getDelegationsForSpace(spaceDid) {
    try {
        const db = getDatabase();
        const delegations = db.prepare(`
            SELECT userDid, spaceName, delegationCid, delegationCar, createdAt, expiresAt, createdBy
            FROM active_delegations
            WHERE spaceDid = ?
            ORDER BY createdAt DESC
        `).all(spaceDid);

        // Group by userDid
        const userDelegations = new Map();
        for (const d of delegations) {
            const existing = userDelegations.get(d.userDid) || [];
            userDelegations.set(d.userDid, [...existing, d]);
        }

        // Convert to array format
        return Array.from(userDelegations.entries()).map(([userDid, delegations]) => ({
            userDid,
            delegations
        }));
    } catch (error) {
        logger.error('Failed to get delegations for space from database', { 
            spaceDid, 
            error: error.message 
        });
        return [];
    }
}

// Cleanup expired delegations
async function cleanupExpiredDelegations() {
    try {
        const db = getDatabase();
        const now = Date.now();
        
        // Delete expired delegations from database
        const result = db.prepare(`
            DELETE FROM delegations 
            WHERE expiresAt IS NOT NULL AND expiresAt <= ?
        `).run(now);

        if (result.changes > 0) {
            logger.info('Cleaned up expired delegations', { 
                count: result.changes 
            });

            // Also clean up memory store
            for (const [userDid, delegations] of delegationStore.entries()) {
                const activeDelegations = delegations.filter(d => 
                    !d.expiresAt || d.expiresAt > now
                );
                if (activeDelegations.length !== delegations.length) {
                    delegationStore.set(userDid, activeDelegations);
                }
            }
        }
    } catch (error) {
        logger.error('Failed to cleanup expired delegations', { 
            error: error.message 
        });
    }
}

// Start cleanup intervals only in non-test environments
if (process.env.NODE_ENV !== 'test') {
    cleanupDelegationsInterval = setInterval(cleanupExpiredDelegations, CLEANUP_INTERVAL);
    // Note: cleanupSessionsInterval would be set elsewhere if needed
}

// Function to clear all intervals for clean shutdown
export function clearCleanupIntervals() {
    if (cleanupDelegationsInterval) {
        clearInterval(cleanupDelegationsInterval);
        cleanupDelegationsInterval = null;
    }
    if (cleanupSessionsInterval) {
        clearInterval(cleanupSessionsInterval);
        cleanupSessionsInterval = null;
    }
}

// Load delegations from database into memory on startup
export async function loadDelegationsFromDatabase() {
    try {
        const db = getDatabase();
        const delegations = db.prepare(`
            SELECT userDid, spaceDid, spaceName, delegationCid, delegationCar, createdAt, expiresAt, createdBy
            FROM active_delegations
            ORDER BY createdAt DESC
        `).all();

        // Group by userDid
        const userDelegations = new Map();
        for (const d of delegations) {
            const existing = userDelegations.get(d.userDid) || [];
            userDelegations.set(d.userDid, [...existing, d]);
        }

        // Update memory store
        for (const [userDid, delegations] of userDelegations.entries()) {
            delegationStore.set(userDid, delegations);
        }

        logger.info('Loaded delegations from database', { 
            userCount: userDelegations.size,
            totalDelegations: delegations.length
        });

        // Run initial cleanup
        await cleanupExpiredDelegations();
    } catch (error) {
        logger.error('Failed to load delegations from database', { 
            error: error.message 
        });
    }
}

// Load principals from database into memory on startup
export async function loadPrincipalsFromDatabase() {
    try {
        const db = getDatabase();
        const principals = db.prepare(`
            SELECT userDid, principalDid, principalKey, createdAt
            FROM user_principals
        `).all();

        // Update memory store
        for (const row of principals) {
            const principal = await importPrincipal(row.principalKey);
            userPrincipalStore.set(row.userDid, {
                principal,
                createdAt: row.createdAt
            });
        }
        
        logger.info('Loaded principals from database', { 
            count: principals.length 
        });
    } catch (error) {
        logger.error('Failed to load principals from database', { 
            error: error.message 
        });
    }
}

// Modify clearStores to not clear sessions on startup
export function clearStores() {
    adminStore.clear();
    delegationStore.clear();
    userPrincipalStore.clear();
    // Don't clear sessionStore as it will be populated from database
    console.log('Stores cleared (except sessions)');
}

// Add function to clear admin data for a specific email
export function clearAdminData(email) {
  if (email) {
    adminStore.delete(email);
    console.log(`Cleared admin data for ${email}`);
  }
}

// Add function to store cached spaces data
export function storeCachedSpaces(email, spaces) {
    const adminData = adminStore.get(email) || {};
    adminStore.set(email, {
        ...adminData,
        cachedSpaces: spaces,
        spacesLastUpdated: Date.now()
    });
    console.log(`Cached spaces data for ${email}`);
}

export function getCachedSpaces(email) {
    const adminData = adminStore.get(email);
    if (!adminData?.cachedSpaces) return null;
    
    // Consider spaces cache valid for 1 hour
    const CACHE_DURATION = 60 * 60 * 1000; // 1 hour
    if (Date.now() - adminData.spacesLastUpdated > CACHE_DURATION) {
        // Cache expired, remove it
        const { cachedSpaces, spacesLastUpdated, ...rest } = adminData;
        adminStore.set(email, rest);
        return null;
    }
    
    return adminData.cachedSpaces;
}

/**
 * Revokes a delegation by removing it from both memory and database stores
 * @param {string} userDid - The user's DID
 * @param {string} spaceDid - The space DID
 * @param {string} delegationCid - The delegation CID to revoke
 * @returns {boolean} - True if delegation was found and revoked, false otherwise
 */
export function revokeDelegation(userDid, spaceDid, delegationCid) {
    // In dev mode, don't modify delegations
    if (isDevAuth()) {
        logger.debug('Dev mode: Skipping delegation revocation', { userDid, spaceDid, delegationCid });
        return false;
    }

    try {
        // Update memory store
        const existingDelegations = delegationStore.get(userDid) || [];
        const delegationIndex = existingDelegations.findIndex(d => 
            d.spaceDid === spaceDid && d.delegationCid === delegationCid
        );

        if (delegationIndex === -1) {
            logger.info('Delegation not found in memory store', { userDid, spaceDid, delegationCid });
            return false;
        }

        // Remove the delegation from memory
        existingDelegations.splice(delegationIndex, 1);
        if (existingDelegations.length === 0) {
            delegationStore.delete(userDid);
        } else {
            delegationStore.set(userDid, existingDelegations);
        }

        // Update database
        const db = getDatabase();
        const result = db.prepare(`
            DELETE FROM delegations 
            WHERE userDid = ? AND spaceDid = ? AND delegationCid = ?
        `).run(userDid, spaceDid, delegationCid);

        const wasDeleted = result.changes > 0;
        if (wasDeleted) {
            logger.info('Revoked delegation', { 
                userDid, 
                spaceDid, 
                delegationCid 
            });
        } else {
            logger.info('Delegation not found in database', { 
                userDid, 
                spaceDid, 
                delegationCid 
            });
        }

        return wasDeleted;
    } catch (error) {
        logger.error('Failed to revoke delegation', { 
            userDid, 
            spaceDid, 
            delegationCid, 
            error: error.message 
        });
        return false;
    }
}

/**
 * Admin Space Management
 * Tracks which spaces belong to which admins for proper isolation
 */

export function storeAdminSpace(adminEmail, spaceDid, spaceName = null) {
    try {
        const db = getDatabase();
        const now = Date.now();
        
        db.prepare(`
            INSERT OR REPLACE INTO admin_spaces 
            (adminEmail, spaceDid, spaceName, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?)
        `).run(adminEmail, spaceDid, spaceName, now, now);
        
        logger.info('Stored admin space', { 
            adminEmail, 
            spaceDid, 
            spaceName 
        });
    } catch (error) {
        logger.error('Failed to store admin space', { 
            adminEmail, 
            spaceDid, 
            error: error.message 
        });
    }
}

export function getAdminSpaces(adminEmail) {
    try {
        const db = getDatabase();
        const spaces = db.prepare(`
            SELECT spaceDid, spaceName, createdAt 
            FROM admin_spaces 
            WHERE adminEmail = ? 
            ORDER BY createdAt DESC
        `).all(adminEmail);
        
        return spaces.map(space => ({
            did: space.spaceDid,
            name: space.spaceName || space.spaceDid
        }));
    } catch (error) {
        logger.error('Failed to get admin spaces', { 
            adminEmail, 
            error: error.message 
        });
        return [];
    }
}

export function isAdminSpaceOwner(adminEmail, spaceDid) {
    try {
        const db = getDatabase();
        const space = db.prepare(`
            SELECT id FROM admin_spaces 
            WHERE adminEmail = ? AND spaceDid = ?
        `).get(adminEmail, spaceDid);
        
        return !!space;
    } catch (error) {
        logger.error('Failed to check admin space ownership', { 
            adminEmail, 
            spaceDid, 
            error: error.message 
        });
        return false;
    }
}

// Note: Session verification is computed based on both email and DID verification

/**
 * Updates verification status for a session
 * @param {string} sessionId - The session ID
 * @param {string} verificationType - Either 'email' or 'did' 
 * @param {boolean} isVerified - Whether this verification type is now verified
 */
export function updateVerificationStatus(sessionId, verificationType, isVerified) {
    if (!['email', 'did'].includes(verificationType)) {
        throw new Error(`Invalid verification type: ${verificationType}. Must be 'email' or 'did'.`);
    }

    try {
        const db = getDatabase();
        
        // Update the specific verification column
        const column = verificationType === 'email' ? 'emailVerified' : 'didVerified';
        db.prepare(`
            UPDATE account_sessions 
            SET ${column} = ? 
            WHERE sessionId = ?
        `).run(isVerified ? 1 : 0, sessionId);

        // Get current verification status to compute full verification
        const session = db.prepare(`
            SELECT emailVerified, didVerified 
            FROM account_sessions 
            WHERE sessionId = ?
        `).get(sessionId);

        if (!session) {
            logger.warn('Session not found when updating verification', { sessionId });
            return;
        }

        // Both must be verified for full verification
        const isFullyVerified = session.emailVerified && session.didVerified;
        
        // Update isVerified based on both verifications
        db.prepare(`
            UPDATE account_sessions 
            SET isVerified = ? 
            WHERE sessionId = ?
        `).run(isFullyVerified ? 1 : 0, sessionId);

        // Update in-memory session store
        const memorySession = sessionStore.get(sessionId);
        if (memorySession) {
            memorySession.isVerified = isFullyVerified;
            memorySession.emailVerified = !!session.emailVerified;
            memorySession.didVerified = !!session.didVerified;
            sessionStore.set(sessionId, memorySession);
        }

        logger.info('Updated verification status', { 
            sessionId,
            verificationType,
            isVerified,
            emailVerified: !!session.emailVerified,
            didVerified: !!session.didVerified,
            isFullyVerified
        });

    } catch (error) {
        logger.error('Failed to update verification status', { 
            sessionId, 
            verificationType,
            error: error.message 
        });
        throw error;
    }
} 