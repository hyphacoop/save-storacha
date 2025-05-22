// Stores adminEmail -> { adminServicePrincipal, adminToAdminServiceDidDelegationCarString, adminDid, sessionId (optional), sessionExpiresAt (optional) }
const adminStore = new Map();
const sessionStore = new Map(); // Stores sessionId -> { email, expiresAt }

const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// --- Admin Data Functions ---
export function storeAdminServiceDidData(email, adminDid, adminServicePrincipal, adminToAdminServiceDidDelegationCarString) {
    const existingAdmin = adminStore.get(email) || {};
    adminStore.set(email, {
        ...existingAdmin,
        adminDid,
        adminServicePrincipal,
        adminToAdminServiceDidDelegationCarString,
    });
    console.log(`Stored Admin Service DID data for ${email}. Admin DID: ${adminDid}`);
}

export function getAdminData(email) {
    return adminStore.get(email);
}

// --- Session Management ---
export function createSession(email) {
    const sessionId = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + SESSION_DURATION;
    sessionStore.set(sessionId, { email, expiresAt });
    // Link session in adminStore for convenience, though sessionStore is the source of truth
    const adminData = adminStore.get(email) || {}; // Ensure adminData exists or initialize
    adminStore.set(email, { ...adminData, sessionId, sessionExpiresAt: expiresAt });
    console.log(`Created session ${sessionId} for ${email}`);
    return { sessionId, expiresAt };
}

export function getSession(sessionId) {
    const session = sessionStore.get(sessionId);
    if (session && session.expiresAt > Date.now()) {
        return session;
    }
    if (session) {
        const adminData = adminStore.get(session.email);
        if (adminData && adminData.sessionId === sessionId) {
            const { sessionId: _s, sessionExpiresAt: _e, ...rest } = adminData;
            adminStore.set(session.email, rest); // Clear session details from adminData
        }
        sessionStore.delete(sessionId); // Clean up expired session
    }
    return null;
}

export function clearSession(sessionId) {
    const session = sessionStore.get(sessionId);
    if (session) {
        const adminData = adminStore.get(session.email);
        if (adminData && adminData.sessionId === sessionId) {
            const { sessionId: _s, sessionExpiresAt: _e, ...rest } = adminData;
            adminStore.set(session.email, rest);
        }
        sessionStore.delete(sessionId);
        console.log(`Cleared session ${sessionId} for ${session.email}`);
    }
}

// Removed email confirmation token functions

// Periodically clean up expired sessions (pendingConfirmations cleanup removed)
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, data] of sessionStore.entries()) {
        if (data.expiresAt <= now) {
            const adminForEmail = adminStore.get(data.email);
            if (adminForEmail && adminForEmail.sessionId === sessionId) {
                 const { sessionId: _s, sessionExpiresAt: _e, ...rest } = adminForEmail;
                 adminStore.set(data.email, rest);
            }
            sessionStore.delete(sessionId);
            console.log(`Cleaned up expired session ${sessionId}`);
        }
    }
}, 60 * 60 * 1000); // Clean up every hour

import crypto from 'crypto';

// Add function to clear all stores
export function clearStores() {
  adminStore.clear();
  sessionStore.clear();
  console.log('Cleared all in-memory stores');
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