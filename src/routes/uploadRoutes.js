import express from 'express';
import multer from 'multer';
import { CarReader } from '@ipld/car/reader';
import { getDelegationsForUser, getAdminSpaces } from '../lib/store.js';
import { importDAG } from '@ucanto/core/delegation';
import { base64 } from "multiformats/bases/base64";
import { StoreMemory } from '@storacha/client/stores/memory';
import { create as createW3upClient } from '@storacha/client';
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
import { getClient, getAdminClient } from '../lib/w3upClient.js';
import { generateAuthHeaders } from '../lib/token-generation.js';
import { logger } from '../lib/logger.js';
import { flexibleAuth } from './spaceRoutes.js';

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

        // Check if delegation has admin information for multi-admin support
        if (!delegation.createdBy) {
            console.log('Warning: Delegation missing admin information, using global client');
        }

        // Initialize tempFilePath outside try block
        let tempFilePath = null;
        let importedDelegation = null;

        try {
            // Use admin-specific client if available, otherwise fall back to global client
            let uploadClient;
            if (delegation.createdBy) {
                try {
                    // Use the admin who created the delegation
                    uploadClient = await getAdminClient(delegation.createdBy);
                    console.log('Using admin-specific client for upload');
                    console.log('Delegation created by admin:', delegation.createdBy);
                } catch (error) {
                    console.log('Failed to get admin client, falling back to global client:', error.message);
                    uploadClient = getClient();
                }
            } else {
                uploadClient = getClient();
                console.log('Using global client for upload (no admin tracking)');
            }
            
            if (!uploadClient) {
                throw new Error('w3up client not initialized');
            }
            console.log('Using admin client for upload with DID:', uploadClient.did());

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

            // Add the delegation proof and explicitly set the requested space
            await uploadClient.addSpace(importedDelegation);
            await uploadClient.setCurrentSpace(spaceDid);
            console.log('Set current space to requested space:', spaceDid);

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

        logger.info('[bridge-tokens] Generating tokens for user', { userDid, spaceDid });

        try {
            const { headers } = await generateAuthHeaders(userDid, spaceDid)
            
            // Log the complete information for testing
            logger.info('[bridge-tokens] ✅ Tokens generated successfully');
            logger.info('[bridge-tokens] Headers:', {
                'X-Auth-Secret': headers['X-Auth-Secret'],
                'Authorization': headers['Authorization'].substring(0, 100) + '...'
            });
            
            // Client is responsible for constructing the upload request (e.g., via curl) using these headers.
            res.json({ 
                headers
            });
            
        } catch (err) {
            logger.error('[bridge-tokens] Token generation failed:', err);
            res.status(500).json({ error: err.message });
        }

    } catch (error) {
        logger.error('[bridge-tokens] Bridge token generation failed:', error);
        res.status(error.message.includes('No principal found') ? 403 : 500)
           .json({ error: error.message });
    }
});

// GET /uploads - List uploads for a user in a specific space
router.get('/uploads', flexibleAuth, async (req, res) => {
    try {
        const userDid = req.userDid;
        const userType = req.userType;
        const spaceDid = req.query.spaceDid;

        if (!spaceDid) {
            return res.status(400).json({ error: 'Missing spaceDid' });
        }

        console.log('Upload list request received:', {
            userDid,
            userType,
            spaceDid
        });

        // For admin users, check if they have access to this space
        if (userType === 'admin') {
            const adminEmail = req.userEmail;
            const adminSpaces = getAdminSpaces(adminEmail);
            const hasAdminAccess = adminSpaces.some(space => space.did === spaceDid);
            
            if (!hasAdminAccess) {
                console.log('Admin does not have access to space:', { adminEmail, spaceDid });
                return res.status(403).json({ 
                    error: 'Admin does not have access to this space',
                    adminEmail,
                    spaceDid
                });
            }
            
            // Admin has access - use admin client directly
            let listClient;
            try {
                listClient = await getAdminClient(adminEmail);
                console.log('Using admin client for upload listing with DID:', listClient.did());
            } catch (error) {
                console.log('Failed to get admin client, falling back to global client:', error.message);
                listClient = getClient();
            }
            
            // Set the current space for the client
            await listClient.setCurrentSpace(spaceDid);
            
            // List uploads using the w3up client
            console.log('Listing uploads for admin...');
            
            const uploads = [];
            let cursor = req.query.cursor; // Support pagination
            const size = parseInt(req.query.size) || 25; // Default page size
            
            try {
                // Use the capability.upload.list method on the client
                console.log('Using client.capability.upload.list method with cursor:', cursor, 'size:', size);
                const result = await listClient.capability.upload.list({ 
                    cursor: cursor || '', 
                    size: size 
                });
                console.log('List result:', result);
                
                if (result && result.results) {
                    for (const upload of result.results) {
                        uploads.push({
                            cid: upload.root?.toString() || upload.cid?.toString(),
                            size: upload.size,
                            created: upload.insertedAt || upload.updatedAt,
                            insertedAt: upload.insertedAt,
                            updatedAt: upload.updatedAt,
                            gatewayUrl: upload.root
                                ? `https://${upload.root.toString()}.ipfs.w3s.link/`
                                : `https://${upload.cid?.toString()}.ipfs.w3s.link/`,
                        });
                    }
                }
                
                // Return pagination info
                res.json({
                    success: true,
                    userDid,
                    spaceDid,
                    uploads,
                    count: uploads.length,
                    cursor: result?.before, // For next page
                    hasMore: !!result?.before
                });
                
            } catch (error) {
                console.error('Failed to list uploads:', error);
                throw new Error('Failed to list uploads: ' + error.message);
            }
        } else {
            // For delegated users, check delegations to confirm access
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

        // Initialize variables
        let importedDelegation = null;

        try {
            // Use admin-specific client if available, otherwise fall back to global client
            let listClient;
            if (delegation.createdBy) {
                try {
                    // Use the admin who created the delegation
                    listClient = await getAdminClient(delegation.createdBy);
                    console.log('Using admin-specific client for upload listing');
                    console.log('Delegation created by admin:', delegation.createdBy);
                } catch (error) {
                    console.log('Failed to get admin client, falling back to global client:', error.message);
                    listClient = getClient();
                }
            } else {
                listClient = getClient();
                console.log('Using global client for upload listing (no admin tracking)');
            }
            
            if (!listClient) {
                throw new Error('w3up client not initialized');
            }
            console.log('Using client for upload listing with DID:', listClient.did());

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
                await listClient.addProof(importedDelegation);
                console.log('Added delegation proof to list client');
            } catch (error) {
                console.error('Failed to import delegation:', error);
                throw new Error('Failed to import delegation: ' + error.message);
            }

            if (!importedDelegation) {
                throw new Error('Delegation import failed - no delegation available');
            }

            // Add the delegation proof and explicitly set the requested space
            await listClient.addSpace(importedDelegation);
            await listClient.setCurrentSpace(spaceDid);
            console.log('Set current space for listing to requested space:', spaceDid);

            // List uploads using the w3up client
            console.log('Listing uploads...');
            
            const uploads = [];
            let cursor = req.query.cursor; // Support pagination
            const size = parseInt(req.query.size) || 25; // Default page size
            
            try {
                // Use the capability.upload.list method on the w3up client
                console.log('Using client.capability.upload.list method with cursor:', cursor, 'size:', size);
                const result = await listClient.capability.upload.list({ 
                    cursor: cursor || '', 
                    size: size 
                });
                console.log('List result:', result);
                
                if (result && result.results) {
                    for (const upload of result.results) {
                        uploads.push({
                            cid: upload.root?.toString() || upload.cid?.toString(),
                            size: upload.size,
                            created: upload.insertedAt || upload.updatedAt,
                            insertedAt: upload.insertedAt,
                            updatedAt: upload.updatedAt,
                            gatewayUrl: upload.root
                                ? `https://${upload.root.toString()}.ipfs.w3s.link/`
                                : `https://${upload.cid?.toString()}.ipfs.w3s.link/`,
                        });
                    }
                }
                
                // Return pagination info
                res.json({
                    success: true,
                    userDid,
                    spaceDid,
                    uploads,
                    count: uploads.length,
                    cursor: result?.before, // For next page
                    hasMore: !!result?.before
                });
                
            } catch (error) {
                console.error('Error listing uploads:', error);
                throw new Error(`Failed to list uploads: ${error.message}`);
            }
            
        } catch (error) {
            console.error('Upload listing error:', error);
            res.status(500).json({ error: error.message });
        }
    }
    } catch (error) {
        console.error('Upload listing error:', error);
        res.status(500).json({ error: error.message });
    }
        
});

export default router;
