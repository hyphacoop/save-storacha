import express from 'express';
import multer from 'multer';
import { CarReader } from '@ipld/car/reader';
import { getDelegationsForUser, getAdminSpaces, getUserPrincipal } from '../lib/store.js';
import { importDAG } from '@ucanto/core/delegation';
import { base64 } from "multiformats/bases/base64";
import { filesFromPaths } from 'files-from-path';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import rateLimit from 'express-rate-limit';
import { getAdminClient } from '../lib/adminClientManager.js';
import { flexibleAuth } from './spaceRoutes.js';
import { StoreMemory } from '@storacha/client/stores/memory';
import { create } from '@storacha/client';
import { logger } from '../lib/logger.js';

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
router.post('/upload', uploadLimiter, upload.single('file'), flexibleAuth, async (req, res) => {
    try {
        const userDid = req.userDid;
        const userType = req.userType;
        const spaceDid = req.body.spaceDid;

        if (!spaceDid) {
            return res.status(400).json({ error: 'Missing spaceDid' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        logger.debug('Upload request received', {
            userType,
            filename: req.file.originalname,
            size: req.file.size
        });

        let uploadClient;
        let tempFilePath = null;

        try {
            if (userType === 'admin') {
                // Admin path: validate space access and get admin client
                const adminEmail = req.userEmail;
                const adminSpaces = getAdminSpaces(adminEmail);
                const hasAdminAccess = adminSpaces.some(space => space.did === spaceDid);

                if (!hasAdminAccess) {
                    logger.warn('Admin does not have access to requested space', { adminEmail, spaceDid });
                    return res.status(403).json({
                        error: 'Admin does not have access to this space',
                        adminEmail,
                        spaceDid
                    });
                }

                uploadClient = await getAdminClient(adminEmail, req.userDid);
                logger.debug('Using admin client for upload');
                await uploadClient.setCurrentSpace(spaceDid);
                logger.debug('Set current space for upload');
            } else {
                // Delegated user path: validate delegation and create user client
                const delegations = await getDelegationsForUser(userDid);
                logger.debug('Resolved user delegations for upload', {
                    delegationCount: delegations ? delegations.length : 0
                });
                if (!delegations || delegations.length === 0) {
                    logger.warn('No valid delegations found for upload request');
                    return res.status(403).json({ error: 'No valid delegation found', userDid });
                }

                const spaceDelegations = delegations.filter(d => d.spaceDid === spaceDid);
                logger.debug('Filtered delegations for upload space', {
                    spaceDelegationCount: spaceDelegations.length
                });
                if (spaceDelegations.length === 0) {
                    logger.warn('No valid delegations found for requested upload space');
                    return res.status(403).json({
                        error: 'No valid delegation found for this space',
                        userDid,
                        spaceDid
                    });
                }

                const delegation = spaceDelegations[0];
                logger.debug('Using first matching delegation for upload');

                const userPrincipal = await getUserPrincipal(userDid);
                if (!userPrincipal) {
                    throw new Error('User principal not found');
                }

                const store = new StoreMemory();
                uploadClient = await create({ principal: userPrincipal, store });
                logger.debug('Initialized delegated upload client');

                // Import and add the delegation proof
                try {
                    const delegationBytes = base64.decode(delegation.delegationCar);
                    const carReader = await CarReader.fromBytes(delegationBytes);

                    const blocks = [];
                    const iterator = carReader.blocks();
                    for await (const block of iterator) {
                        blocks.push(block);
                    }
                    logger.debug('Decoded delegation CAR for upload', { blockCount: blocks.length });

                    const importedDelegation = await importDAG(blocks);
                    if (!importedDelegation) {
                        throw new Error('Failed to import delegation: importDAG returned null');
                    }
                    await uploadClient.addProof(importedDelegation);
                    logger.debug('Added delegation proof to upload client');

                    await uploadClient.addSpace(importedDelegation);
                    await uploadClient.setCurrentSpace(spaceDid);
                    logger.debug('Set current space for delegated upload');
                } catch (error) {
                    logger.error('Failed to import delegation for upload', { error: error.message });
                    throw new Error('Failed to import delegation: ' + error.message);
                }
            }

            // Shared upload logic
            tempFilePath = join(tmpdir(), req.file.originalname);
            await writeFile(tempFilePath, req.file.buffer);
            logger.debug('Wrote upload temp file');

            const files = await filesFromPaths([tempFilePath]);
            logger.debug('Created upload file handles', { fileCount: files.length });

            const result = await uploadClient.uploadDirectory(files);

            const cid = result.cid || result;
            const cidString = cid.toString();
            logger.info('Upload successful', { cid: cidString, size: req.file.size });

            const filename = req.file.originalname;
            res.json({
                success: true,
                cid: cidString,
                filename: filename,
                gatewayUrl: `https://${cidString}.ipfs.w3s.link/${encodeURIComponent(filename)}`,
                size: req.file.size,
                carCid: result.carCid ? result.carCid.toString() : undefined
            });

        } finally {
            if (tempFilePath) {
                try {
                    await unlink(tempFilePath);
                    logger.debug('Cleaned up upload temp file');
                } catch (error) {
                    logger.warn('Failed to clean up upload temp file', { error: error.message });
                }
            }
        }

    } catch (error) {
        logger.error('Upload request failed', { error: error.message });
        if (error.message && error.message.includes('no proofs')) {
            return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
        }
        res.status(500).json({ error: error.message });
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

        logger.debug('Upload listing request received', { userType });

        // For admin users, check if they have access to this space
        if (userType === 'admin') {
            const adminEmail = req.userEmail;
            const adminSpaces = getAdminSpaces(adminEmail);
            const hasAdminAccess = adminSpaces.some(space => space.did === spaceDid);
            
            if (!hasAdminAccess) {
                logger.warn('Admin does not have access to requested upload-list space', { adminEmail, spaceDid });
                return res.status(403).json({ 
                    error: 'Admin does not have access to this space',
                    adminEmail,
                    spaceDid
                });
            }
            
            // Admin has access - use admin client directly
            let listClient;
            try {
                listClient = await getAdminClient(adminEmail, req.userDid);
                logger.debug('Initialized admin client for upload listing');
            } catch (error) {
                logger.error('Failed to initialize admin client for upload listing', { error: error.message });
                throw new Error(`Failed to get admin client for upload listing: ${error.message}`);
            }
            
            // Set the current space for the client
            await listClient.setCurrentSpace(spaceDid);
            logger.debug('Listing uploads for admin');
            
            const uploads = [];
            let cursor = req.query.cursor; // Support pagination
            const size = parseInt(req.query.size) || 25; // Default page size
            
            try {
                // Use the capability.upload.list method on the client
                logger.debug('Calling capability.upload.list for admin uploads', { hasCursor: !!cursor, size });
                const result = await listClient.capability.upload.list({ 
                    cursor: cursor || '', 
                    size: size 
                });
                
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
                logger.error('Failed to list uploads for admin', { error: error.message });
                throw new Error('Failed to list uploads: ' + error.message);
            }
        } else {
            // For delegated users, check delegations to confirm access
            const delegations = await getDelegationsForUser(userDid);
            logger.debug('Resolved user delegations for upload listing', {
                delegationCount: delegations ? delegations.length : 0
            });
            if (!delegations || delegations.length === 0) {
                logger.warn('No valid delegations found for upload listing');
                return res.status(403).json({ error: 'No valid delegation found', userDid });
            }

            // Filter delegations for the specific space
            const spaceDelegations = delegations.filter(d => d.spaceDid === spaceDid);
            logger.debug('Filtered delegations for upload listing space', {
                spaceDelegationCount: spaceDelegations.length
            });
            if (spaceDelegations.length === 0) {
                logger.warn('No valid delegation found for user in requested upload listing space');
                return res.status(403).json({ 
                    error: 'No valid delegation found for this space'
                });
            }

        // Use the first valid delegation
        const delegation = spaceDelegations[0];
        logger.debug('Using first matching delegation for upload listing');

        // Initialize variables
        let importedDelegation = null;

        try {
            // Use user-specific client for delegated users
            const userPrincipal = await getUserPrincipal(userDid);
            if (!userPrincipal) {
                throw new Error('User principal not found');
            }

            // Create Storacha client with user principal
            const store = new StoreMemory();
            const listClient = await create({ principal: userPrincipal, store });
            logger.debug('Initialized delegated client for upload listing');

            // Import and add the delegation proof
            try {
                const delegationBytes = base64.decode(delegation.delegationCar);
                const carReader = await CarReader.fromBytes(delegationBytes);

                // Get all blocks from the CAR file
                const blocks = [];
                const iterator = carReader.blocks();
                for await (const block of iterator) {
                    blocks.push(block);
                }
                logger.debug('Decoded delegation CAR for upload listing', { blockCount: blocks.length });

                // Import the delegation using the blocks
                importedDelegation = await importDAG(blocks);
                if (!importedDelegation) {
                    throw new Error('Failed to import delegation: importDAG returned null');
                }
                await listClient.addProof(importedDelegation);
                logger.debug('Added delegation proof to listing client');
            } catch (error) {
                logger.error('Failed to import delegation for upload listing', { error: error.message });
                throw new Error('Failed to import delegation: ' + error.message);
            }

            if (!importedDelegation) {
                throw new Error('Delegation import failed - no delegation available');
            }

            // Add the delegation proof and explicitly set the requested space
            await listClient.addSpace(importedDelegation);
            await listClient.setCurrentSpace(spaceDid);
            logger.debug('Set current space for delegated upload listing');

            // List uploads using the w3up client
            logger.debug('Listing uploads for delegated user');
            
            const uploads = [];
            let cursor = req.query.cursor; // Support pagination
            const size = parseInt(req.query.size) || 25; // Default page size
            
            try {
                // Use the capability.upload.list method on the w3up client
                logger.debug('Calling capability.upload.list for delegated uploads', { hasCursor: !!cursor, size });
                const result = await listClient.capability.upload.list({ 
                    cursor: cursor || '', 
                    size: size 
                });
                
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
                logger.error('Failed to list uploads for delegated user', { error: error.message });
                throw new Error(`Failed to list uploads: ${error.message}`);
            }
            
        } catch (error) {
            logger.error('Upload listing failed for delegated user', { error: error.message });
            res.status(500).json({ error: error.message });
        }
    }
    } catch (error) {
        logger.error('Upload listing request failed', { error: error.message });
        res.status(500).json({ error: error.message });
    }
        
});

export default router;
