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
import { getAdminClient } from '../lib/adminClientManager.js';
import { getDelegationsForUser, getSession, getAdminSpaces, getUserPrincipal } from '../lib/store.js';
import { getDatabase } from '../lib/db.js';
import { StoreMemory } from '@storacha/client/stores/memory';
import { create } from '@storacha/client';
import { CarReader } from '@ipld/car/reader';
import { importDAG } from '@ucanto/core/delegation';
import { base64 } from "multiformats/bases/base64";

const router = express.Router();

/**
 * Helper function to resolve space name from various sources
 * @param {string} spaceDid - The space DID
 * @param {string|null} spaceName - The space name from delegation (might be null)
 * @returns {string} Resolved space name or spaceDid as fallback
 */
function resolveSpaceName(spaceDid, spaceName) {
    // If spaceName is already available, use it
    if (spaceName) {
        return spaceName;
    }

    // Try to look up from admin_spaces table
    try {
        const db = getDatabase();
        const adminSpace = db.prepare(`
            SELECT spaceName FROM admin_spaces
            WHERE spaceDid = ? AND spaceName IS NOT NULL
            LIMIT 1
        `).get(spaceDid);

        if (adminSpace && adminSpace.spaceName) {
            return adminSpace.spaceName;
        }
    } catch (error) {
        logger.warn('Could not lookup space name from admin_spaces', {
            spaceDid,
            error: error.message
        });
    }

    // Final fallback to DID
    return spaceDid;
}

/**
 * Flexible authentication middleware for space routes
 * 
 * This middleware supports two authentication methods:
 * 1. Admin authentication via x-session-id header (traditional admin users)
 * 2. DID-based access via x-user-did header (delegated users)
 * 
 * For admin users: Validates session and extracts email/DID from session
 * For delegated users: Validates DID format and sets userDid for delegation lookup
 * 
 * Sets req.userType to either 'admin' or 'delegated' to indicate auth method used
 */
export const flexibleAuth = (req, res, next) => {
    const sessionId = req.headers['x-session-id'];
    const userDid = req.headers['x-user-did'];

    // If session ID is provided, authenticate as admin
    if (sessionId) {
        const session = getSession(sessionId);
        
        // Return same error for both invalid sessions and unverified sessions
        // to prevent disclosure of session validity
        if (!session || !session.isVerified) {
            return res.status(401).json({ message: 'Invalid or expired session' });
        }
        
        // Admin user authenticated via session
        req.userEmail = session.email;
        req.userDid = session.adminDid;
        req.userType = 'admin';
        return next();
    }

    // If user DID is provided, authenticate as delegated user
    if (userDid) {
        // Validate DID format
        if (!userDid.startsWith('did:key:')) {
            return res.status(400).json({ 
                message: 'Invalid DID format' 
            });
        }
        // Delegated user authenticated via DID
        req.userDid = userDid;
        req.userType = 'delegated';
        return next();
    }

    // No valid authentication method provided
    return res.status(401).json({ 
        message: 'Authentication required: provide either x-session-id (admin) or x-user-did (delegated user)' 
    });
};

/**
 * GET /spaces - List spaces available to a user
 * 
 * Returns all spaces that the user has access to, either as an admin or through delegations.
 * The isAdmin flag indicates whether the user has admin privileges for each space.
 * 
 * Authentication: Flexible - supports both admin (x-session-id) and delegated user (x-user-did) access
 * 
 * For admin users: Lists both admin spaces and any delegated spaces
 * For delegated users: Lists only spaces they have delegations for
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
router.get('/', flexibleAuth, async (req, res) => {
    const userDid = req.userDid;
    const userType = req.userType;

    try {
        let spaces = [];

        // Handle admin users (authenticated via session)
        if (userType === 'admin') {
            const adminEmail = req.userEmail;
            
            // Get admin spaces using dual technique (cache + service sync)
            logger.info('Getting admin spaces for authenticated admin', { adminEmail, userDid });
            const adminSpaces = await SpaceService.getSpacesWithSync(adminEmail);
            spaces.push(...adminSpaces); // These already have isAdmin: true

            // Also get any delegated spaces for this admin's DID
            const delegations = getDelegationsForUser(userDid);
            const now = Date.now();
            const activeDelegations = delegations.filter(d => 
                !d.expiresAt || d.expiresAt > now
            );

            // Create delegated spaces list with proper name resolution
            const delegatedSpaces = activeDelegations.map(d => ({
                did: d.spaceDid,
                name: resolveSpaceName(d.spaceDid, d.spaceName),
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

            spaces = Array.from(spaceMap.values());
        }
        // Handle delegated users (authenticated via DID)
        else if (userType === 'delegated') {
            logger.info('Getting delegated spaces for user DID', { userDid });
            
            // Get only delegated spaces for this user
            const delegations = getDelegationsForUser(userDid);
            const now = Date.now();
            const activeDelegations = delegations.filter(d => 
                !d.expiresAt || d.expiresAt > now
            );

            // Create spaces list with proper name resolution
            spaces = activeDelegations.map(d => ({
                did: d.spaceDid,
                name: resolveSpaceName(d.spaceDid, d.spaceName),
                isAdmin: false
            }));
        }

        res.json(spaces);
    } catch (error) {
        logger.error('Failed to list spaces', { 
            userDid,
            userType,
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
 * Authentication: Flexible - supports both admin (x-session-id) and delegated user (x-user-did) access
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
router.get('/usage', flexibleAuth, async (req, res) => {
    const { spaceDid } = req.query;
    const userType = req.userType;
    const userDid = req.userDid;

    if (!spaceDid) {
        return res.status(400).json({ 
            message: 'spaceDid query parameter is required' 
        });
    }

    try {
        // Verify user has access to this space
        if (userType === 'admin') {
            const adminEmail = req.userEmail;
            logger.info('Space usage request received from admin', { adminEmail, userDid, spaceDid });
            
            // Check if admin has access to this space
            const adminSpaces = getAdminSpaces(adminEmail);
            const hasAdminAccess = adminSpaces.some(space => space.did === spaceDid);
            
            // Also check delegated access
            const delegations = getDelegationsForUser(userDid);
            const now = Date.now();
            const hasDelegatedAccess = delegations.some(d => 
                d.spaceDid === spaceDid && (!d.expiresAt || d.expiresAt > now)
            );

            if (!hasAdminAccess && !hasDelegatedAccess) {
                return res.status(403).json({ 
                    message: 'Access denied: You do not have access to this space'
                });
            }
        } else if (userType === 'delegated') {
            logger.info('Space usage request received from delegated user', { userDid, spaceDid });
            
            // Check if user has delegated access to this space
            const delegations = getDelegationsForUser(userDid);
            const now = Date.now();
            const hasDelegatedAccess = delegations.some(d => 
                d.spaceDid === spaceDid && (!d.expiresAt || d.expiresAt > now)
            );

            if (!hasDelegatedAccess) {
                return res.status(403).json({ 
                    message: 'Access denied: You do not have access to this space'
                });
            }
        }

        // Use appropriate client based on user type
        let client;
        if (userType === 'admin') {
            const adminEmail = req.userEmail;
            try {
                client = await getAdminClient(adminEmail);
                logger.info('Using admin-specific client for space usage', { adminEmail });
            } catch (error) {
                // Fallback to global client for backward compatibility
                client = getClient();
                logger.info('Using global client for space usage (fallback)', { adminEmail });
            }
        } else {
            // For delegated users, create user-specific client with principal and delegation
            try {
                // Get user principal
                const userPrincipal = await getUserPrincipal(userDid);
                if (!userPrincipal) {
                    throw new Error('User principal not found');
                }

                // Create Storacha client with user principal
                const store = new StoreMemory();
                client = await create({ principal: userPrincipal, store });
                logger.info('Using user-specific client for delegated user space usage', { userDid, clientDid: client.did() });

                // Get delegation for this user and space
                const delegations = getDelegationsForUser(userDid);
                const spaceDelegations = delegations.filter(d => d.spaceDid === spaceDid);
                if (spaceDelegations.length === 0) {
                    throw new Error('No delegation found for this user and space');
                }

                const delegation = spaceDelegations[0];
                
                // Import and add the delegation proof
                const delegationBytes = base64.decode(delegation.delegationCar);
                const carReader = await CarReader.fromBytes(delegationBytes);
                
                // Get all blocks from the CAR file
                const blocks = [];
                const iterator = carReader.blocks();
                for await (const block of iterator) {
                    blocks.push(block);
                }

                // Import the delegation using the blocks
                const importedDelegation = await importDAG(blocks);
                if (!importedDelegation) {
                    throw new Error('Failed to import delegation: importDAG returned null');
                }
                await client.addProof(importedDelegation);
                logger.info('Added delegation proof to user client for space usage', { userDid, spaceDid });

                // Add the delegation proof and explicitly set the requested space
                await client.addSpace(importedDelegation);
                await client.setCurrentSpace(spaceDid);
                logger.info('Set current space for delegated user space usage', { userDid, spaceDid });

            } catch (error) {
                logger.error('Failed to create user-specific client for delegated user', { userDid, spaceDid, error: error.message });
                throw new Error(`Failed to create user client: ${error.message}`);
            }
        }
        
        // For admin users, try to get the space from loaded spaces
        if (userType === 'admin') {
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
            userDid,
            userType,
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
 * Authentication: Admin only (x-session-id header required)
 * Note: This endpoint is not available to delegated users as they don't have "accounts"
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
 *   ],
 *   "planProduct": "did:web:starter.web3.storage"
 * }
 */
router.get('/account-usage', ensureAuthenticated, async (req, res) => {
    const adminEmail = req.userEmail;

    try {
        logger.info('Account usage request received', { adminEmail });

        // Get plan product for the admin
        let planProduct = null;
        try {
            const db = getDatabase();
            const result = db.prepare('SELECT planProduct FROM admin_agents WHERE adminEmail = ?').get(adminEmail);
            planProduct = result?.planProduct || null;
            if (planProduct) {
                logger.info('Retrieved plan product for admin', { adminEmail, planProduct });
            } else {
                logger.info('No plan product found for admin', { adminEmail });
            }
        } catch (error) {
            logger.warn('Failed to retrieve plan product for admin', {
                adminEmail,
                error: error.message
            });
        }

        const client = await getAdminClient(adminEmail);
        logger.info('Using admin-specific client for account usage', { adminEmail });
        // Get all spaces for the admin
        const spaces = getAdminSpaces(adminEmail);
        
        let totalBytes = 0;
        let spaceUsages = [];

        if (spaces && spaces.length > 0) {
            // Get usage for each space
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
        }

        const totalMB = +(totalBytes / 1048576).toFixed(4);
        const totalHuman = `${totalMB} MB`;

        // Build response object
        const response = {
            totalUsage: {
                bytes: totalBytes,
                mb: totalMB,
                human: totalHuman
            },
            spaces: spaceUsages
        };

        // Add plan product if available
        if (planProduct) {
            response.planProduct = planProduct;
        }

        res.json(response);

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