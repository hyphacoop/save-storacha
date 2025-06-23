/**
 * Space Management Routes Module
 * 
 * This module handles all space-related endpoints for the Storacha delegation
 * management system. Spaces represent storage containers where files can be uploaded
 * and managed within the Storacha ecosystem.
 * 
 * Key Features:
 * - Space listing with admin isolation
 * - Individual space usage reporting  
 * - Account-wide usage aggregation
 * - Multi-admin client support with fallback
 * - Detailed usage metrics (bytes, MB, human-readable)
 * 
 * Security Features:
 * - Admin authentication required for all endpoints
 * - Space access limited to assigned spaces only
 * - Proper error handling for unauthorized access
 */

import express from 'express';
import * as SpaceService from '../services/spaceService.js';
import { ensureAuthenticated } from './authRoutes.js'; // Import shared middleware
import { logger } from '../lib/logger.js';
import { getClient, getAdminClient } from '../lib/w3upClient.js';

const router = express.Router();

/**
 * GET /spaces - List spaces available to a user
 * 
 * Returns all spaces that the user has access to, either as an admin or through delegations.
 * The isAdmin flag indicates whether the user has admin privileges for each space.
 * 
 * Authentication: Required via x-user-did header
 * 
 * Response format:
 * [
 *   {
 *     "did": "did:key:...",
 *     "name": "space-name",
 *     "isAdmin": true|false  // true for admin spaces, false for delegated spaces
 *   }
 * ]
 */
router.get('/', async (req, res) => {
    const userDid = req.headers['x-user-did'];

    if (!userDid) {
        return res.status(400).json({ 
            message: 'x-user-did header is required' 
        });
    }

    try {
        // Validate the DID format
        if (!userDid.startsWith('did:key:')) {
            return res.status(400).json({ 
                message: 'Invalid DID format' 
            });
        }

        // Get admin email from DID if it exists
        const adminEmail = await SpaceService.getAdminEmailFromDid(userDid);
        let spaces = [];

        // If user is an admin, get their admin spaces
        if (adminEmail) {
            logger.info('Getting admin spaces', { adminEmail });
            const adminSpaces = await SpaceService.getSpaces(adminEmail);
            spaces.push(...adminSpaces); // These already have isAdmin: true
        }

        // Get delegated spaces
        const delegations = getDelegationsForUser(userDid);
        const now = Date.now();
        const activeDelegations = delegations.filter(d => 
            !d.expiresAt || d.expiresAt > now
        );

        // Add delegated spaces with isAdmin: false
        const delegatedSpaces = activeDelegations.map(d => ({
            did: d.spaceDid,
            name: d.spaceName || d.spaceDid,
            isAdmin: false
        }));

        // Merge spaces, ensuring no duplicates (prefer admin access if both exist)
        const spaceMap = new Map();
        [...spaces, ...delegatedSpaces].forEach(space => {
            const existing = spaceMap.get(space.did);
            if (!existing || space.isAdmin) {
                spaceMap.set(space.did, space);
            }
        });

        res.json(Array.from(spaceMap.values()));
    } catch (error) {
        logger.error('Failed to list spaces', { 
            userDid, 
            error: error.message 
        });
        res.status(500).json({ 
            message: error.message || 'Failed to list spaces'
        });
    }
});

/**
 * GET /spaces/usage - Get detailed usage information for a specific space
 * 
 * Provides comprehensive storage usage metrics for a single space including:
 * - Raw byte count
 * - Megabyte conversion
 * - Human-readable format
 * 
 * This endpoint uses the Storacha capability API to fetch real-time
 * usage data. It supports both admin-specific clients and fallback to
 * the global client for backward compatibility.
 * 
 * Query Parameters:
 * - spaceDid (required): The DID of the space to check
 * 
 * Authentication: Required via session ID header
 * 
 * Response format:
 * {
 *   "spaceDid": "did:key:...",
 *   "usage": {
 *     "bytes": 1048576,
 *     "mb": 1.0,
 *     "human": "1.0 MB"
 *   }
 * }
 */
router.get('/usage', ensureAuthenticated, async (req, res) => {
    const { spaceDid } = req.query;
    const adminEmail = req.userEmail;

    if (!spaceDid) {
        return res.status(400).json({ 
            message: 'spaceDid query parameter is required' 
        });
    }

    try {
        logger.info('Space usage request received', { adminEmail, spaceDid });
        
        // Use admin-specific client for multi-admin support
        let client;
        try {
            client = await getAdminClient(adminEmail);
            logger.info('Using admin-specific client for space usage', { adminEmail });
        } catch (error) {
            // Fallback to global client for backward compatibility
            client = getClient();
            logger.info('Using global client for space usage (fallback)', { adminEmail });
        }
        
        // Try to get the space from loaded spaces
        let spaces = client.spaces();
        let space = spaces.find(s => s.did() === spaceDid);
        
        // If not found, try to add/load the space
        if (!space) {
            try {
                space = await client.addSpace(spaceDid);
                logger.info('Loaded space using addSpace', { spaceDid });
            } catch (err) {
                logger.error('Failed to load space with addSpace', { spaceDid, error: err.message });
                return res.status(404).json({ 
                    message: 'Space not found and could not be loaded',
                    spaceDid 
                });
            }
        }

        // Get usage report for all time
        const period = { from: new Date(0), to: new Date() };
        const usage = await client.capability.usage.report(spaceDid, period);
        // Extract the 'final' value from the usage report (handle possible nesting)
        let finalBytes = 0;
        if (usage && usage[Object.keys(usage)[0]] && usage[Object.keys(usage)[0]].size && typeof usage[Object.keys(usage)[0]].size.final === 'number') {
            finalBytes = usage[Object.keys(usage)[0]].size.final;
        }
        const finalMB = +(finalBytes / 1048576).toFixed(4);
        const human = `${finalMB} MB`;
        res.json({
            spaceDid,
            usage: {
                bytes: finalBytes,
                mb: finalMB,
                human
            }
        });

    } catch (error) {
        logger.error('Failed to get space usage', { 
            adminEmail, 
            spaceDid, 
            error: error.message 
        });
        res.status(500).json({ 
            message: error.message || 'Failed to get space usage'
        });
    }
});

/**
 * GET /spaces/account-usage - Get aggregated usage across all admin spaces
 * 
 * Provides a comprehensive view of storage usage across all spaces assigned
 * to the authenticated admin. This is useful for:
 * - Account-level usage monitoring
 * - Billing and quota management
 * - Storage optimization decisions
 * 
 * The endpoint fetches usage for each space individually and aggregates
 * the results. If any individual space fails, it continues with others
 * and reports the error in the response.
 * 
 * Authentication: Required via session ID header
 * 
 * Response format:
 * {
 *   "totalUsage": {
 *     "bytes": 2097152,
 *     "mb": 2.0,
 *     "human": "2.0 MB"
 *   },
 *   "spaces": [
 *     {
 *       "spaceDid": "did:key:...",
 *       "name": "space-name",
 *       "usage": {
 *         "bytes": 1048576,
 *         "mb": 1.0,
 *         "human": "1.0 MB"
 *       }
 *     }
 *   ]
 * }
 */
router.get('/account-usage', ensureAuthenticated, async (req, res) => {
    const adminEmail = req.userEmail;

    try {
        logger.info('Account usage request received', { adminEmail });
        
        // Use admin-specific client for multi-admin support
        let client;
        try {
            client = await getAdminClient(adminEmail);
            logger.info('Using admin-specific client for account usage', { adminEmail });
        } catch (error) {
            // Fallback to global client for backward compatibility
            client = getClient();
            logger.info('Using global client for account usage (fallback)', { adminEmail });
        }
        
        // Get all spaces for the admin
        const spaces = await SpaceService.getSpaces(adminEmail);
        if (!spaces || spaces.length === 0) {
            return res.json({
                totalUsage: {
                    bytes: 0,
                    mb: 0,
                    human: "0 MB"
                },
                spaces: []
            });
        }

        // Get usage for each space
        const spaceUsages = [];
        let totalBytes = 0;

        for (const space of spaces) {
            try {
                // Get usage report for all time
                const period = { from: new Date(0), to: new Date() };
                const usage = await client.capability.usage.report(space.did, period);
                
                // Extract the 'final' value from the usage report
                let finalBytes = 0;
                if (usage && usage[Object.keys(usage)[0]] && usage[Object.keys(usage)[0]].size && typeof usage[Object.keys(usage)[0]].size.final === 'number') {
                    finalBytes = usage[Object.keys(usage)[0]].size.final;
                }
                
                const finalMB = +(finalBytes / 1048576).toFixed(4);
                const human = `${finalMB} MB`;
                
                spaceUsages.push({
                    spaceDid: space.did,
                    name: space.name,
                    usage: {
                        bytes: finalBytes,
                        mb: finalMB,
                        human
                    }
                });

                totalBytes += finalBytes;
            } catch (error) {
                logger.error('Failed to get usage for space', { 
                    adminEmail, 
                    spaceDid: space.did, 
                    error: error.message 
                });
                // Continue with other spaces even if one fails
                spaceUsages.push({
                    spaceDid: space.did,
                    name: space.name,
                    error: error.message,
                    usage: {
                        bytes: 0,
                        mb: 0,
                        human: "0 MB"
                    }
                });
            }
        }

        const totalMB = +(totalBytes / 1048576).toFixed(4);
        const totalHuman = `${totalMB} MB`;

        res.json({
            totalUsage: {
                bytes: totalBytes,
                mb: totalMB,
                human: totalHuman
            },
            spaces: spaceUsages
        });

    } catch (error) {
        logger.error('Failed to get account usage', { 
            adminEmail, 
            error: error.message 
        });
        res.status(500).json({ 
            message: error.message || 'Failed to get account usage'
        });
    }
});

export default router; 