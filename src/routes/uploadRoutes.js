import express from 'express';
import multer from 'multer';
import { CarReader } from '@ipld/car/reader';
import { getDelegationsForUser, getUserPrincipal } from '../lib/store.js';
import { importDAG } from '@ucanto/core/delegation';
import { base64 } from "multiformats/bases/base64";
import { StoreMemory } from '@web3-storage/w3up-client/stores/memory';
import { create as createW3upClient } from '@web3-storage/w3up-client';
import { Blob } from 'buffer'; // Node.js Blob implementation
import { filesFromPaths } from 'files-from-path';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse as parseDID } from '@ipld/dag-ucan/did';
import rateLimit from 'express-rate-limit';
import { sha256 } from '@ucanto/core';
import { ed25519 } from '@ucanto/principal';
import { CarWriter } from '@ipld/car/writer';
import { getClient } from '../lib/w3upClient.js';
import { generateAuthHeaders } from '../lib/token-generation.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// General rate limiter for all routes
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Stricter rate limiter specifically for uploads
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Limit each IP to 10 uploads per hour
    message: 'Too many uploads from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply general rate limiter to all routes
router.use(generalLimiter);

// Helper: check if buffer is a CAR file
function isCarFile(buffer, filename = '') {
    // Only treat files as CAR if they have .car extension
    if (!filename.toLowerCase().endsWith('.car')) {
        return false;
    }
    // Then validate the content
    try {
        CarReader.fromBytes(buffer);
        return true;
    } catch {
        return false;
    }
}

// POST /upload - Upload files to a space
router.post('/upload', uploadLimiter, upload.single('file'), async (req, res) => {
    try {
        const userDid = req.headers['x-user-did'];
        const spaceDid = req.body.spaceDid;

        if (!userDid || !spaceDid) {
            return res.status(400).json({ error: 'Missing userDid or spaceDid' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log('Upload request received:', {
            userDid,
            spaceDid,
            filename: req.file.originalname,
            size: req.file.size
        });

        // Get the principal that was created for this user
        const userPrincipal = await getUserPrincipal(userDid);
        if (!userPrincipal) {
            console.log('No principal found for user:', userDid);
            return res.status(403).json({ error: 'No principal found for user', userDid });
        }
        console.log('Found principal for user:', userPrincipal.did());

        // Get delegations for the user
        const delegations = await getDelegationsForUser(userDid);
        console.log('Found delegations:', delegations ? delegations.length : 0);
        if (!delegations || delegations.length === 0) {
            console.log('No valid delegations found for user:', userDid);
            return res.status(403).json({ error: 'No valid delegation found', userDid });
        }

        // Filter delegations for the specific space
        const spaceDelegations = delegations.filter(d => d.spaceDid === spaceDid);
        console.log('Found space delegations:', spaceDelegations.length, 'for space:', spaceDid);
        if (spaceDelegations.length === 0) {
            console.log('No valid delegations found for user and space:', { userDid, spaceDid });
            return res.status(403).json({ 
                error: 'No valid delegation found for this space',
                userDid,
                spaceDid,
                availableSpaces: delegations.map(d => d.spaceDid)
            });
        }

        // Use the first valid delegation
        const delegation = spaceDelegations[0];
        console.log('Delegation object:', delegation);
        console.log('Using delegation:', delegation.delegationCid && delegation.delegationCid.toString());

        // Initialize tempFilePath outside try block
        let tempFilePath = null;
        let importedDelegation = null;

        try {
            // Create a new memory store and upload client with the user's principal
            const memoryStore = new StoreMemory();
            const uploadClient = await createW3upClient({ 
                principal: userPrincipal,
                store: memoryStore 
            });
            console.log('Created upload client with user principal');

            // Import and add the delegation proof
            try {
                console.log('Delegation CAR:', delegation.delegationCar.substring(0, 100) + '...');
                const delegationBytes = base64.decode(delegation.delegationCar);
                console.log('Decoded delegation bytes length:', delegationBytes.length);
                const carReader = await CarReader.fromBytes(delegationBytes);
                console.log('Created CAR reader');

                // Get all blocks from the CAR file
                const blocks = [];
                const iterator = carReader.blocks();
                for await (const block of iterator) {
                    blocks.push(block);
                }
                console.log('Collected blocks from CAR:', blocks.length);

                // Import the delegation using the blocks
                importedDelegation = await importDAG(blocks);
                if (!importedDelegation) {
                    throw new Error('Failed to import delegation: importDAG returned null');
                }
                await uploadClient.addProof(importedDelegation);
                console.log('Added delegation proof to upload client');
            } catch (error) {
                console.error('Failed to import delegation:', error);
                throw new Error('Failed to import delegation: ' + error.message);
            }

            if (!importedDelegation) {
                throw new Error('Delegation import failed - no delegation available');
            }

            // Add and set the space
            const space = await uploadClient.addSpace(importedDelegation);
            await uploadClient.setCurrentSpace(space.did());
            console.log('Set current space:', space.did());

            // Write the file to a temporary location
            tempFilePath = join(tmpdir(), req.file.originalname);
            await writeFile(tempFilePath, req.file.buffer);
            console.log('Wrote file to temp location:', tempFilePath);

            // Create file object from the temp file
            const files = await filesFromPaths([tempFilePath]);
            const file = files[0];
            console.log('Created file object for upload');

            // Upload the file
            const result = await uploadClient.uploadFile(file);
            console.log('Upload result object:', result);
            
            // Extract CID from result - handle both direct CID object and nested CID
            const cid = result.cid || result;
            const cidString = cid.toString();
            console.log('Upload successful, CID:', cidString);

            // Return the upload result with proper CID
            res.json({
                success: true,
                cid: cidString,
                size: result.size || file.size,
                carCid: result.carCid ? result.carCid.toString() : undefined
            });

        } finally {
            // Clean up temp file if it exists
            if (tempFilePath) {
                try {
                    await unlink(tempFilePath);
                    console.log('Cleaned up temp file:', tempFilePath);
                } catch (error) {
                    console.error('Failed to clean up temp file:', error);
                }
            }
        }

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /bridge-tokens - Get authentication tokens for direct uploads to w3up HTTP API bridge
router.get('/bridge-tokens', async (req, res) => {
    try {
        const userDid = req.headers['x-user-did'];
        const spaceDid = req.query.spaceDid;

        if (!userDid || !spaceDid) {
            return res.status(400).json({ error: 'Missing userDid or spaceDid' });
        }

        const { headers, delegationInfo } = await generateAuthHeaders(userDid, spaceDid);
        res.json({ headers, delegationInfo });

    } catch (error) {
        logger.error('Bridge token generation failed:', error);
        res.status(error.message.includes('No principal found') ? 403 : 500)
           .json({ error: error.message });
    }
});

export default router;