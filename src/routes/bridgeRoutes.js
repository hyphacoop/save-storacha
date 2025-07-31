/**
 * Bridge Token Routes
 * 
 * Handles bridge token generation for Storacha bridge access.
 * These tokens can be used directly with the Storacha bridge API.
 */

import express from 'express';
import { generateTokens } from '../lib/token-generation.js';
import { logger } from '../lib/logger.js';
import { getDatabase } from '../lib/db.js';

const router = express.Router();

/**
 * POST /bridge-tokens - Generate bridge tokens
 * 
 * Generates bridge tokens using the admin's space owner proof agent.
 * These tokens can be used with the Storacha bridge API.
 * 
 * Request body:
 * - resource: The space DID to generate tokens for
 * - can: Array of capabilities (default: ['store/add', 'upload/add'])
 * - expiration: Token expiration time (0 for no expiration)
 * - json: Whether to return JSON format (default: false)
 */
router.post('/bridge-tokens', async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'];
        if (!sessionId) {
            return res.status(401).json({ error: 'Session ID required' });
        }

        // Get the admin email from the session
        const db = getDatabase();
        const session = db.prepare(`
            SELECT email, did, isActive, expiresAt, isVerified 
            FROM account_sessions 
            WHERE sessionId = ? AND isActive = 1
        `).get(sessionId);
        
        if (!session) {
            return res.status(401).json({ error: 'Invalid or expired session' });
        }
        
        if (Date.now() > session.expiresAt) {
            return res.status(401).json({ error: 'Session expired' });
        }
        
        if (!session.isVerified) {
            return res.status(403).json({ error: 'Session not verified' });
        }

        const { resource, can, expiration, json } = req.body;
        
        if (!resource) {
            return res.status(400).json({ error: 'Resource (space DID) is required' });
        }

        logger.info('[bridge] Generating bridge tokens via API', {
            adminEmail: session.email,
            resource,
            capabilities: can || ['store/add', 'upload/add'],
            sessionId: sessionId.substring(0, 8) + '...'
        });

        // Generate the bridge tokens
        const tokens = await generateTokens(session.email, resource, {
            can: can || ['store/add', 'upload/add'],
            expiration: expiration || undefined,
            json: json || false
        });

        logger.info('[bridge] Bridge tokens generated successfully via API', {
            adminEmail: session.email,
            resource,
            tokenSizes: {
                xAuthSecret: tokens.xAuthSecret?.length || 0,
                authorization: tokens.authorization?.length || 0
            }
        });

        res.json({
            success: true,
            tokens
        });

    } catch (error) {
        logger.error('[bridge] Bridge token generation failed via API', {
            error: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            error: 'Bridge token generation failed',
            message: error.message
        });
    }
});

export default router;