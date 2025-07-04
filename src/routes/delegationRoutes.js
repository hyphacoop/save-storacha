import express from 'express';
import { ensureAuthenticated } from './authRoutes.js';
import { logger } from '../lib/logger.js';
import { getClient, getAdminClient } from '../lib/w3upClient.js';
import { CarWriter } from '@ipld/car';
import { base64 } from "multiformats/bases/base64";
import { parse as parseDID } from '@ipld/dag-ucan/did';
import { Signer } from '@ucanto/principal/ed25519';
import { ed25519 } from '@ucanto/principal';
import { sha256 } from '@ucanto/core';
import { storeDelegation, getDelegationsForUser, getDelegationsForSpace, storeUserPrincipal, revokeDelegation } from '../lib/store.js';
import { getDatabase } from '../lib/db.js';

const router = express.Router();

// POST /delegations/create - Create a delegation from admin to a new principal for a user
router.post('/create', ensureAuthenticated, async (req, res) => {
    const { userDid, spaceDid, expiresIn } = req.body;
    const adminEmail = req.userEmail;

    if (!userDid || !spaceDid) {
        return res.status(400).json({ 
            message: 'userDid and spaceDid are required' 
        });
    }

    try {
        logger.info('Delegation request received', { 
            adminEmail, 
            userDid, 
            spaceDid,
            expiresIn
        });

        // Get the w3up client for the currently authenticated admin
        const db = getDatabase();
        const adminAgent = db.prepare('SELECT agentData FROM admin_agents WHERE adminEmail = ?').get(adminEmail);
        if (!adminAgent || !adminAgent.agentData) {
            throw new Error('Admin agent not found or not properly configured.');
        }
        const client = await getAdminClient(adminEmail, adminAgent.agentData);

        // Set the current space for the client
        await client.setCurrentSpace(spaceDid);

        // Generate (or retrieve) a principal for the user using the same method as token generation
        const secretBytes = new TextEncoder().encode(userDid);
        const { digest } = await sha256.digest(secretBytes);
        const userPrincipal = await ed25519.Signer.derive(digest);
        await storeUserPrincipal(userDid, userPrincipal);
        console.log('Delegation creation: userPrincipal DID:', userPrincipal.did());
        console.log('Delegation creation: userDid from request:', userDid);
        console.log('Delegation creation: admin client DID:', client.did());
        console.log('Delegation creation: DID match:', userDid === userPrincipal.did());

        // Calculate expiration time
        const expirationHours = expiresIn || 24;
        const expirationTime = Date.now() + (expirationHours * 60 * 60 * 1000);

        // Create delegation with minimal capabilities for file uploads
        const abilities = [
            'upload/add',           // Upload capability
            'upload/list',          // List uploads capability
            'store/*',              // Storage operations
            'space/blob/add',       // Add blobs to space (required for uploads)
            'space/index/add'       // Add to space index (required for uploads)
        ];
        const delegation = await client.createDelegation(
            userPrincipal,
            abilities,
            {
                expiration: expirationTime,
                resource: spaceDid,
                // Add a note to indicate this is a minimal delegation
                note: 'Minimal delegation with upload/add and store capabilities'
            }
        );

        // Encode delegation to CAR format
        const { writer, out } = await CarWriter.create([delegation.cid]);
        const carChunks = [];
        const carPromise = (async () => {
            for await (const chunk of out) {
                carChunks.push(chunk);
            }
        })();

        // Debug: count blocks and log CIDs
        let blockCount = 0;
        for await (const block of delegation.export()) {
            await writer.put(block);
            blockCount++;
            logger.info('Delegation export block', { cid: block.cid.toString() });
        }
        logger.info('Total blocks exported for delegation', { blockCount });
        await writer.close();
        await carPromise;
        
        const delegationCar = Buffer.concat(carChunks);
        const delegationCarString = base64.encode(delegationCar);

        // Store delegation with admin tracking for multi-admin support
        await storeDelegation(userDid, spaceDid, delegation.cid.toString(), delegationCarString, expirationTime, adminEmail);

        logger.info('Delegation created successfully', {
            userDid,
            spaceDid,
            principalDid: userPrincipal.did(),
            delegationCid: delegation.cid.toString(),
            expiresAt: new Date(expirationTime).toISOString(),
            createdBy: adminEmail // Track which admin created this delegation
        });

        res.json({
            message: 'Delegation created successfully',
            principalDid: userPrincipal.did(),
            delegationCid: delegation.cid.toString(),
            expiresAt: new Date(expirationTime).toISOString(),
            createdBy: adminEmail
        });

    } catch (error) {
        logger.error('Delegation failed', { 
            adminEmail, 
            userDid, 
            spaceDid, 
            error: error.message 
        });
        res.status(500).json({ 
            message: error.message || 'Failed to create delegation'
        });
    }
});

// GET /delegations/list - List delegations for a user or space (admin only)
router.get('/list', ensureAuthenticated, async (req, res) => {
    const { userDid, spaceDid } = req.query;
    const adminEmail = req.userEmail;

    if (!userDid && !spaceDid) {
        return res.status(400).json({ 
            message: 'Either userDid or spaceDid query parameter is required' 
        });
    }

    try {
        if (userDid) {
            // Return only the list of space DIDs for this user
            const delegations = getDelegationsForUser(userDid);
            const spaceDids = delegations.map(d => d.spaceDid);
            res.json({
                userDid,
                spaces: Array.from(new Set(spaceDids))
            });
        } else {
            // Return only the list of user DIDs for this space
            const delegations = getDelegationsForSpace(spaceDid);
            const userDids = delegations.map(d => d.userDid);
            res.json({
                spaceDid,
                users: Array.from(new Set(userDids))
            });
        }
    } catch (error) {
        logger.error('Failed to list delegations', { 
            adminEmail, 
            userDid, 
            spaceDid, 
            error: error.message 
        });
        res.status(500).json({ 
            message: error.message || 'Failed to list delegations'
        });
    }
});

// DELETE /delegations/revoke - Revoke a delegation
router.delete('/revoke', ensureAuthenticated, async (req, res) => {
    const { userDid, spaceDid } = req.body;
    const adminEmail = req.userEmail;

    if (!userDid || !spaceDid) {
        return res.status(400).json({ 
            message: 'userDid and spaceDid are required' 
        });
    }

    try {
        logger.info('Delegation revocation request received', { 
            adminEmail, 
            userDid, 
            spaceDid
        });

        // Get active delegations for the user and space
        const delegations = getDelegationsForUser(userDid);
        const activeDelegations = delegations.filter(d => 
            d.spaceDid === spaceDid && 
            (!d.expiresAt || d.expiresAt > Date.now())
        );

        if (activeDelegations.length === 0) {
            return res.status(404).json({ 
                message: 'No active delegation found for this user and space' 
            });
        }

        // Revoke all active delegations for this user-space pair
        let revokedCount = 0;
        for (const delegation of activeDelegations) {
            const wasRevoked = revokeDelegation(userDid, spaceDid, delegation.delegationCid);
            if (wasRevoked) {
                revokedCount++;
            }
        }

        if (revokedCount === 0) {
            return res.status(500).json({ 
                message: 'Failed to revoke delegations' 
            });
        }

        logger.info('Delegations revoked successfully', { 
            userDid,
            spaceDid,
            revokedCount
        });

        res.json({
            message: 'Delegations revoked successfully',
            userDid,
            spaceDid,
            revokedCount
        });

    } catch (error) {
        logger.error('Delegation revocation failed', { 
            adminEmail, 
            userDid, 
            spaceDid,
            error: error.message 
        });
        res.status(500).json({ 
            message: error.message || 'Failed to revoke delegations'
        });
    }
});

// GET /delegations/get - Get delegation CAR for a user and space
router.get('/get', async (req, res) => {
    const { userDid, spaceDid } = req.query;

    if (!userDid || !spaceDid) {
        return res.status(400).json({ 
            message: 'userDid and spaceDid query parameters are required' 
        });
    }

    try {
        const delegations = getDelegationsForUser(userDid);
        const delegation = delegations.find(d => d.spaceDid === spaceDid);

        if (!delegation) {
            return res.status(404).json({ 
                message: 'No active delegation found for this user and space' 
            });
        }

        res.json({
            userDid,
            spaceDid,
            delegationCar: delegation.delegationCar,
            expiresAt: delegation.expiresAt ? new Date(delegation.expiresAt).toISOString() : null
        });

    } catch (error) {
        logger.error('Failed to get delegation', { 
            userDid, 
            spaceDid, 
            error: error.message 
        });
        res.status(500).json({ 
            message: error.message || 'Failed to get delegation'
        });
    }
});

export default router; 