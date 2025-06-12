import express from 'express';
import * as AuthService from '../services/authService.js';
import { 
    getSession, 
    clearSession as clearStoreSession,
    getAccountSessions,
    deactivateAccountSessions,
    deactivateSession
} from '../lib/store.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// Middleware to check for an active session
// This will be used by other (non-auth) routes that require an authenticated admin
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

// POST /auth/login/did - Login with DID (first time or subsequent)
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

// POST /auth/login - Unified login endpoint (email + DID required)
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

// POST /auth/login/email - Initiates w3up email validation (deprecated, use /login instead)
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

// GET /auth/session - A simple endpoint to check if a session is valid and get expiry
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
        expiresAt: new Date(session.expiresAt).toISOString(),
        message: 'Session is valid'
    });
});

// POST /auth/logout - Clears the session
router.post('/logout', ensureAuthenticated, (req, res) => {
    const sessionId = req.headers['x-session-id'];
    clearStoreSession(sessionId); // Use the imported clearSession from store.js
    res.json({ message: 'Logout successful' });
});

// POST /auth/w3up/logout - Attempts to logout from w3up service
router.post('/w3up/logout', async (req, res) => {
    logger.info('W3UP logout request received');
    try {
        const result = await AuthService.logoutFromW3Up();
        res.json(result);
    } catch (error) {
        logger.error('W3UP logout failed', { error: error.message });
        res.status(500).json({ message: error.message || 'Logout failed' });
    }
});

// GET /auth/sessions - List all sessions for the authenticated user
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

// POST /auth/sessions/:sessionId/deactivate - Deactivate a specific session
router.post('/sessions/:sessionId/deactivate', ensureAuthenticated, (req, res) => {
    const { sessionId } = req.params;
    const session = getSession(sessionId);
    
    if (!session) {
        return res.status(404).json({ message: 'Session not found' });
    }
    
    if (session.email !== req.userEmail) {
        return res.status(403).json({ message: 'Not authorized to deactivate this session' });
    }
    
    deactivateSession(sessionId);
    res.json({ message: 'Session deactivated successfully' });
});

// POST /auth/sessions/deactivate-all - Deactivate all sessions for the user
router.post('/sessions/deactivate-all', ensureAuthenticated, (req, res) => {
    const count = deactivateAccountSessions(req.userEmail);
    res.json({ 
        message: 'All sessions deactivated successfully',
        deactivatedCount: count
    });
});

// Removed /confirm_login and /delegations routes as they are no longer used in the new flow.

export default router; 