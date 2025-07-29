/**
 * Authentication Routes Module
 * 
 * This module handles all authentication-related endpoints for the Storacha
 * delegation management system. It provides secure login/logout functionality
 * with session management and DID-based authentication.
 * 
 * Key Features:
 * - DID-based authentication for decentralized identity
 * - Session management with configurable expiration
 * - Unified login handling for both initial and subsequent logins
 * - Multi-session support with individual session control
 * - Comprehensive session listing and management
 * 
 * Security Features:
 * - Session validation middleware
 * - Proper session isolation between users
 * - Secure session deactivation
 * - Email-DID binding validation
 */

import express from 'express';
import * as AuthService from '../services/authService.js';
import * as DidAuthService from '../services/didAuthService.js';
import { 
    getSession, 
    clearSession as clearStoreSession,
    getAccountSessions,
    deactivateAccountSessions,
    deactivateSession,
    updateVerificationStatus
} from '../lib/store.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

/**
 * Authentication middleware for protected routes
 * 
 * This middleware validates that incoming requests have a valid session ID
 * and that the session is still active. It extracts both email and DID
 * from the session and attaches them to the request object for use by
 * subsequent route handlers.
 * 
 * Used by all routes that require an authenticated admin user.
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object  
 * @param {function} next - Express next middleware function
 */
export const ensureAuthenticated = (req, res, next) => {
    const sessionId = req.headers['x-session-id']; 
    if (!sessionId) {
        return res.status(401).json({ message: 'No session ID provided' });
    }
    const session = getSession(sessionId);
    if (!session) {
        return res.status(401).json({ message: 'Invalid or expired session' });
    }
    // Attach both email and DID to request for subsequent use
    req.userEmail = session.email;
    req.userDid = session.adminDid;
    next();
};

/**
 * POST /auth/login/did - Legacy DID-only login endpoint
 * 
 * This endpoint is deprecated and maintained only for backward compatibility.
 * New implementations should use the unified /auth/login endpoint that requires
 * both email and DID for enhanced security.
 */
router.post('/login/did', async (req, res) => {
    try {
        const { did } = req.body;
        if (!did) {
            return res.status(400).json({ error: 'DID is required' });
        }

        const result = await AuthService.handleDidLogin(did);
        res.json(result);
    } catch (error) {
        logger.error('DID login failed', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /auth/login - Unified login endpoint (requires email + DID)
 * 
 * This is the primary authentication endpoint that handles both initial and
 * subsequent logins. It requires both email and DID parameters for enhanced
 * security and proper user identification.
 * 
 * The endpoint automatically determines whether this is an initial login
 * (requiring Storacha authentication) or a subsequent login (using
 * cached credentials).
 * 
 * Request body:
 * - email: User's email address
 * - did: User's decentralized identifier
 * 
 * Response:
 * - sessionId: Session identifier for subsequent requests
 * - did: Confirmed DID
 * - spaces: Available spaces for the user
 */
router.post('/login', async (req, res) => {
    try {
        const { email, did } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        if (!did) {
            return res.status(400).json({ error: 'DID is required' });
        }

        const result = await AuthService.handleAdminLogin(email, did);
        res.json(result);
    } catch (error) {
        logger.error('Admin login failed', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /auth/login/email - Email-based login initialization (deprecated)
 * 
 * This endpoint initiates the Storacha email validation process.
 * It's deprecated in favor of the unified /auth/login endpoint but
 * maintained for backward compatibility.
 * 
 * New integrations should use /auth/login instead.
 */
router.post('/login/email', async (req, res) => {
    try {
        const { email, did } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        if (!did) {
            return res.status(400).json({ error: 'DID is required for security' });
        }

        const result = await AuthService.requestAdminLoginViaW3Up(email, did);
        res.json(result);
    } catch (error) {
        logger.error('Email login failed', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /auth/verify - DID signature verification endpoint
 * 
 * Verifies a signed challenge and updates the existing session as authenticated.
 * This completes the DID-based authentication flow.
 * 
 * Request body:
 * - did: The client's decentralized identifier
 * - challengeId: The challenge identifier from /auth/login
 * - signature: Base64-encoded signature of the challenge
 * - sessionId: The session ID from the login call to update
 * - email: (optional) Email address for enhanced user identification
 * 
 * Response:
 * - sessionId: Session identifier for subsequent authenticated requests
 * - did: Confirmed DID
 * - message: Success message
 */
router.post('/verify', async (req, res) => {
    try {
        const { did, challengeId, signature, sessionId, email } = req.body;
        
        if (!did) {
            return res.status(400).json({ error: 'DID is required' });
        }
        
        if (!challengeId) {
            return res.status(400).json({ error: 'Challenge ID is required' });
        }
        
        if (!signature) {
            return res.status(400).json({ error: 'Signature is required' });
        }
        
        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }
        
        // Verify the signed challenge
        const isValid = await DidAuthService.verifySignedChallenge(did, challengeId, signature);
        
        if (!isValid) {
            logger.warn('DID signature verification failed', { did, challengeId });
            return res.status(401).json({ error: 'Invalid signature or expired challenge' });
        }
        
        // Update DID verification status (this will check if both email and DID are verified)
        updateVerificationStatus(sessionId, 'did', true);
        
        logger.info('DID authentication successful', { did, email, sessionId });
        
        res.json({
            sessionId,
            did,
            message: 'Authentication successful'
        });
        
    } catch (error) {
        logger.error('DID verification failed', { 
            did: req.body?.did, 
            challengeId: req.body?.challengeId,
            error: error.message 
        });
        res.status(500).json({ error: error.message || 'Verification failed' });
    }
});

/**
 * GET /auth/session - Session validation endpoint
 * 
 * Provides a simple way for clients to check if their session is still valid
 * and get information about session expiration. This is useful for:
 * - Client-side session management
 * - Proactive session renewal
 * - UI state management
 * 
 * Returns session validity status and expiration time if valid.
 */
router.get('/session', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) {
        return res.status(401).json({ valid: false, message: 'No session ID provided' });
    }
    
    const session = getSession(sessionId);
    if (!session) {
        return res.status(401).json({ valid: false, message: 'Invalid or expired session' });
    }

    res.json({ 
        valid: true,
        verified: session.isVerified,
        expiresAt: new Date(session.expiresAt).toISOString(),
        message: 'Session is valid'
    });
});

/**
 * POST /auth/logout - Session termination endpoint
 * 
 * Securely terminates the current session, removing it from both memory
 * and persistent storage. This should be called when users explicitly
 * log out or when implementing session cleanup.
 * 
 * Requires authentication via session ID header.
 */
router.post('/logout', ensureAuthenticated, (req, res) => {
    const sessionId = req.headers['x-session-id'];
    clearStoreSession(sessionId);
    res.json({ message: 'Logout successful' });
});

/**
 * POST /auth/w3up/logout - Storacha service logout
 * 
 * Attempts to logout from the Storacha service directly, removing
 * any cached account information. This is separate from local session
 * management and affects the underlying Storacha client state.
 * 
 * Use this for complete cleanup of Storacha authentication state.
 */
router.post('/w3up/logout', async (req, res) => {
    logger.info('Storacha logout request received');
    try {
        const result = await AuthService.logoutFromW3Up();
        res.json(result);
    } catch (error) {
        logger.error('Storacha logout failed', { error: error.message });
        res.status(500).json({ message: error.message || 'Logout failed' });
    }
});

/**
 * GET /auth/sessions - List all sessions for authenticated user
 * 
 * Provides comprehensive session management by listing all active and
 * inactive sessions for the authenticated user. This enables:
 * - Security auditing (see where you're logged in)
 * - Multi-device session management
 * - Suspicious activity detection
 * 
 * Returns detailed session information including creation time, last activity,
 * expiration, and browser/device information.
 */
router.get('/sessions', ensureAuthenticated, (req, res) => {
    try {
        const sessions = getAccountSessions(req.userEmail);
        res.json({
            email: req.userEmail,
            did: req.userDid,
            sessions: sessions.map(s => ({
                sessionId: s.sessionId,
                did: s.adminDid,
                createdAt: new Date(s.createdAt).toISOString(),
                lastActiveAt: new Date(s.lastActiveAt).toISOString(),
                expiresAt: new Date(s.expiresAt).toISOString(),
                userAgent: s.userAgent,
                ipAddress: s.ipAddress,
                isActive: s.isActive
            }))
        });
    } catch (error) {
        logger.error('Failed to list sessions', { 
            email: req.userEmail, 
            error: error.message 
        });
        res.status(500).json({ message: 'Failed to list sessions' });
    }
});

/**
 * POST /auth/sessions/:sessionId/deactivate - Deactivate specific session
 * 
 * Allows users to deactivate a specific session, useful for:
 * - Logging out from a specific device
 * - Revoking access from a lost/stolen device  
 * - Managing session security
 * 
 * Includes authorization check to ensure users can only deactivate
 * their own sessions.
 */
router.post('/sessions/:sessionId/deactivate', ensureAuthenticated, (req, res) => {
    const { sessionId } = req.params;
    const session = getSession(sessionId);
    
    // Return same error for both non-existent sessions and unauthorized access
    // to prevent session ID enumeration
    if (!session || session.email !== req.userEmail) {
        return res.status(404).json({ message: 'Session not found' });
    }
    
    deactivateSession(sessionId);
    res.json({ message: 'Session deactivated successfully' });
});

/**
 * POST /auth/sessions/deactivate-all - Deactivate all user sessions
 * 
 * Provides a "logout everywhere" functionality that deactivates all
 * sessions for the authenticated user. This is useful for:
 * - Security incidents (compromise suspected)
 * - Password changes
 * - Complete session reset
 * 
 * Returns the count of deactivated sessions for confirmation.
 */
router.post('/sessions/deactivate-all', ensureAuthenticated, (req, res) => {
    const count = deactivateAccountSessions(req.userEmail);
    res.json({ 
        message: 'All sessions deactivated successfully',
        deactivatedCount: count
    });
});

export default router; 