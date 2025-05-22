import express from 'express';
import * as AuthService from '../services/authService.js';
import { getSession, clearSession as clearStoreSession } from '../lib/store.js'; // Import getSession and clearSession
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
    req.userEmail = session.email; // Attach user email to request for subsequent use
    next();
};


// POST /auth/login/:email - Initiates w3up email validation
router.post('/login/:email', async (req, res) => {
    const { email } = req.params;
    if (!email) {
        return res.status(400).json({ message: 'Email parameter is required' });
    }
    logger.info('Login request received', { email });
    try {
        const result = await AuthService.requestAdminLoginViaW3Up(email);
        // This response indicates the process started. Actual session creation happens after w3up email confirmation.
        res.status(202).json(result); // 202 Accepted: request accepted, processing will continue
    } catch (error) {
        logger.error('Login request failed', { email, error: error.message });
        res.status(500).json({ message: error.message || 'Login initiation failed' });
    }
});

// GET /auth/session - A simple endpoint to check if a session is valid and get user email
// Useful for client-side to verify authentication status
router.get('/session', ensureAuthenticated, (req, res) => {
    res.json({ email: req.userEmail, message: 'Session is valid' });
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

// Removed /confirm_login and /delegations routes as they are no longer used in the new flow.

export default router; 