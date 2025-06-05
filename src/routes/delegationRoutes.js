import express from 'express';
import { ensureAuthenticated } from './authRoutes.js';
import { logger } from '../lib/logger.js';
import { getClient } from '../lib/w3upClient.js';
import { CarWriter } from '@ipld/car';
import { base64 } from "multiformats/bases/base64";
import { parse as parseDID } from '@ipld/dag-ucan/did';
import { Signer } from '@ucanto/principal/ed25519';
import { storeDelegation, getDelegationsForUser, getDelegationsForSpace, storeUserPrincipal } from '../lib/store.js';

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

        // Get the w3up client
        const client = getClient();
        if (!client) {
            throw new Error('w3up client not initialized');
        }

        // Generate (or retrieve) a principal for the user (using Signer.generate) and store it.
        const userPrincipal = await Signer.generate();
        await storeUserPrincipal(userDid, userPrincipal);
        console.log('Delegation creation: userPrincipal DID:', userPrincipal.did());

        // Calculate expiration time
        const expirationHours = expiresIn || 24;
        const expirationTime = Date.now() + (expirationHours * 60 * 60 * 1000);

        // Create delegation with necessary capabilities
        const abilities = [
            'space/*',    // High-level space operations
            'store/*',    // Storage operations
            'upload/*'    // Upload operations
        ];
        const delegation = await client.createDelegation(
            userPrincipal,
            abilities,
            {
                expiration: expirationTime,
                resource: spaceDid,
                // Add a note to indicate this is a direct delegation with full capabilities
                note: 'Direct delegation with space, store, and upload capabilities'
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

        // Store the delegation information with expiry
        storeDelegation(userDid, spaceDid, delegation.cid.toString(), delegationCarString, expirationTime);

        logger.info('Delegation created and stored successfully', { 
            userDid,
            spaceDid,
            principalDid: userPrincipal.did(),
            delegationCid: delegation.cid.toString(),
            expiresAt: new Date(expirationTime).toISOString()
        });

        res.json({
            message: 'Delegation created successfully',
            principalDid: userPrincipal.did(),
            delegationCid: delegation.cid.toString(),
            expiresAt: new Date(expirationTime).toISOString()
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

// POST /delegations/create-simple - Create a simplified delegation for testing
router.post('/create-simple', ensureAuthenticated, async (req, res) => {
    const { userDid, spaceDid } = req.body;
    const adminEmail = req.userEmail;

    if (!userDid || !spaceDid) {
        return res.status(400).json({ 
            message: 'userDid and spaceDid are required' 
        });
    }

    try {
        logger.info('Simple delegation request received', { 
            adminEmail, 
            userDid, 
            spaceDid
        });

        // Get the w3up client
        const client = getClient();
        if (!client) {
            throw new Error('w3up client not initialized');
        }

        // Generate a principal for the user
        const userPrincipal = await Signer.generate();
        await storeUserPrincipal(userDid, userPrincipal);
        logger.info('Simple delegation: userPrincipal DID:', userPrincipal.did());

        // Create a simplified delegation with just upload capability
        // Using a shorter expiration time (1 hour) for testing
        const expirationTime = Date.now() + (60 * 60 * 1000); // 1 hour

        const delegation = await client.createDelegation(
            userPrincipal,
            ['upload/*'], // Only upload capability
            {
                expiration: expirationTime,
                resource: spaceDid,
                note: 'Simplified delegation for testing - upload only'
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

        // Export and write the delegation block
        for await (const block of delegation.export()) {
            await writer.put(block);
            logger.info('Simple delegation block', { 
                cid: block.cid.toString(),
                size: block.bytes.length
            });
        }
        await writer.close();
        await carPromise;
        
        const delegationCar = Buffer.concat(carChunks);
        const delegationCarString = base64.encode(delegationCar);

        // Store the delegation information
        storeDelegation(userDid, spaceDid, delegation.cid.toString(), delegationCarString, expirationTime);

        logger.info('Simple delegation created successfully', { 
            userDid,
            spaceDid,
            principalDid: userPrincipal.did(),
            delegationCid: delegation.cid.toString(),
            expiresAt: new Date(expirationTime).toISOString()
        });

        res.json({
            message: 'Simple delegation created successfully',
            principalDid: userPrincipal.did(),
            delegationCid: delegation.cid.toString(),
            expiresAt: new Date(expirationTime).toISOString()
        });

    } catch (error) {
        logger.error('Simple delegation failed', { 
            adminEmail, 
            userDid, 
            spaceDid, 
            error: error.message 
        });
        res.status(500).json({ 
            message: error.message || 'Failed to create simple delegation'
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

// GET /delegations/user/spaces - List spaces for the authenticated user (public endpoint)
router.get('/user/spaces', async (req, res) => {
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

        // Get active delegations for the user
        const delegations = getDelegationsForUser(userDid);
        
        // Filter out expired delegations and map to space DIDs
        const now = Date.now();
        const activeDelegations = delegations.filter(d => 
            !d.expiresAt || d.expiresAt > now
        );
        
        const spaceDids = activeDelegations.map(d => d.spaceDid);
        
        res.json({
            userDid,
            spaces: Array.from(new Set(spaceDids)),
            expiresAt: activeDelegations.length > 0 ? 
                new Date(Math.min(...activeDelegations.map(d => d.expiresAt || Infinity))).toISOString() 
                : null
        });
    } catch (error) {
        logger.error('Failed to list user spaces', { 
            userDid, 
            error: error.message 
        });
        res.status(500).json({ 
            message: error.message || 'Failed to list user spaces'
        });
    }
});

// DELETE /delegations/revoke - Revoke a delegation (future implementation)
router.delete('/revoke', ensureAuthenticated, async (req, res) => {
    const { delegationCid } = req.body;
    const adminEmail = req.userEmail;

    if (!delegationCid) {
        return res.status(400).json({ 
            message: 'delegationCid is required' 
        });
    }

    // TODO: Implement delegation revocation
    res.status(501).json({ 
        message: 'Delegation revocation not yet implemented' 
    });
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