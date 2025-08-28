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
 * Generates bridge tokens using either:
 * - Admin mode: admin's space owner proof agent (requires x-session-id)
 * - Delegated mode: delegated user with their delegation (requires x-user-did)
 * 
 * Authentication:
 * - Admin: x-session-id header required
 * - Delegated user: x-user-did header required
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
        const userDid = req.headers['x-user-did'];
        const { resource, can, expiration, json } = req.body;

        if (!resource) {
            return res.status(400).json({ error: 'Resource (space DID) is required' });
        }

        let adminEmail;
        let isDelegated = false;

        // Determine authentication method
        if (sessionId) {
            // Admin authentication via session
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

            adminEmail = session.email;
            isDelegated = false;

        } else if (userDid) {
            // Delegated user authentication via DID
            if (!userDid.startsWith('did:key:')) {
                return res.status(400).json({ 
                    error: 'Invalid DID format' 
                });
            }

            // For delegated users, we need to find which admin created their delegation
            const { getDelegationsForUser } = await import('../lib/store.js');
            const delegations = await getDelegationsForUser(userDid);
            
            if (!delegations || delegations.length === 0) {
                return res.status(403).json({ 
                    error: 'No valid delegations found for this user' 
                });
            }

            // Filter delegations for the specific space
            const spaceDelegations = delegations.filter(d => d.spaceDid === resource);
            if (spaceDelegations.length === 0) {
                return res.status(403).json({ 
                    error: 'No valid delegation found for this user and space' 
                });
            }

            // Use the first valid delegation to get the admin email
            const delegation = spaceDelegations[0];
            adminEmail = delegation.createdBy;
            
            if (!adminEmail) {
                return res.status(500).json({ 
                    error: 'Delegation missing admin information' 
                });
            }

            isDelegated = true;

        } else {
            return res.status(401).json({ 
                error: 'Authentication required: provide either x-session-id (admin) or x-user-did (delegated user)' 
            });
        }
        
        if (isDelegated) {
            // Delegated user mode - generate tokens for a specific user
            logger.info('[bridge] Generating bridge tokens via API (Delegated user mode)', {
                adminEmail,
                userDid,
                resource,
                capabilities: can || ['store/add', 'upload/add']
            });

            const tokens = await generateTokens(userDid, resource, {
                can: can || ['store/add', 'upload/add'],
                expiration: expiration || undefined,
                json: json || false,
                isDelegated: true
            });
            
            logger.info('[bridge] Bridge tokens generated successfully via API (Delegated user mode)', {
                adminEmail,
                userDid,
                resource,
                tokenSizes: {
                    xAuthSecret: tokens.xAuthSecret?.length || 0,
                    authorization: tokens.authorization?.length || 0
                }
            });

            res.json({
                success: true,
                tokens,
                mode: 'delegated',
                userDid,
                resource
            });
        } else {
            // Admin mode - generate tokens using admin's own credentials
            logger.info('[bridge] Generating bridge tokens via API (Admin mode)', {
                adminEmail,
                resource,
                capabilities: can || ['store/add', 'upload/add']
            });

            const tokens = await generateTokens(adminEmail, resource, {
                can: can || ['store/add', 'upload/add'],
                expiration: expiration || undefined,
                json: json || false,
                isDelegated: false
            });
            
            logger.info('[bridge] Bridge tokens generated successfully via API (Admin mode)', {
                adminEmail,
                resource,
                tokenSizes: {
                    xAuthSecret: tokens.xAuthSecret?.length || 0,
                    authorization: tokens.authorization?.length || 0
                }
            });

            res.json({
                success: true,
                tokens,
                mode: 'admin',
                adminEmail,
                resource
            });
        }

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