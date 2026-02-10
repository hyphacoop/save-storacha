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

        console.log('Upload request received:', {
            userDid,
            userType,
            spaceDid,
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
                    console.log('Admin does not have access to space:', { adminEmail, spaceDid });
                    return res.status(403).json({
                        error: 'Admin does not have access to this space',
                        adminEmail,
                        spaceDid
                    });
                }

                uploadClient = await getAdminClient(adminEmail, req.userDid);
                console.log('Using admin client for upload with DID:', uploadClient.did());
                await uploadClient.setCurrentSpace(spaceDid);
                console.log('Set current space to requested space:', spaceDid);
            } else {
                // Delegated user path: validate delegation and create user client
                const delegations = await getDelegationsForUser(userDid);
                console.log('Found delegations:', delegations ? delegations.length : 0);
                if (!delegations || delegations.length === 0) {
                    console.log('No valid delegations found for user:', userDid);
                    return res.status(403).json({ error: 'No valid delegation found', userDid });
                }

                const spaceDelegations = delegations.filter(d => d.spaceDid === spaceDid);
                console.log('Found space delegations:', spaceDelegations.length, 'for space:', spaceDid);
                if (spaceDelegations.length === 0) {
                    console.log('No valid delegations found for user and space:', { userDid, spaceDid });
                    return res.status(403).json({
                        error: 'No valid delegation found for this space',
                        userDid,
                        spaceDid
                    });
                }

                const delegation = spaceDelegations[0];
                console.log('Delegation object:', delegation);
                console.log('Using delegation:', delegation.delegationCid && delegation.delegationCid.toString());

                const userPrincipal = await getUserPrincipal(userDid);
                if (!userPrincipal) {
                    throw new Error('User principal not found');
                }

                const store = new StoreMemory();
                uploadClient = await create({ principal: userPrincipal, store });
                console.log('Using user principal client for upload with DID:', uploadClient.did());

                // Import and add the delegation proof
                try {
                    console.log('Delegation CAR:', delegation.delegationCar.substring(0, 100) + '...');
                    const delegationBytes = base64.decode(delegation.delegationCar);
                    console.log('Decoded delegation bytes length:', delegationBytes.length);
                    const carReader = await CarReader.fromBytes(delegationBytes);
                    console.log('Created CAR reader');

                    const blocks = [];
                    const iterator = carReader.blocks();
                    for await (const block of iterator) {
                        blocks.push(block);
                    }
                    console.log('Collected blocks from CAR:', blocks.length);

                    const importedDelegation = await importDAG(blocks);
                    if (!importedDelegation) {
                        throw new Error('Failed to import delegation: importDAG returned null');
                    }
                    await uploadClient.addProof(importedDelegation);
                    console.log('Added delegation proof to upload client');

                    await uploadClient.addSpace(importedDelegation);
                    await uploadClient.setCurrentSpace(spaceDid);
                    console.log('Set current space to requested space:', spaceDid);
                } catch (error) {
                    console.error('Failed to import delegation:', error);
                    throw new Error('Failed to import delegation: ' + error.message);
                }
            }

            // Shared upload logic
            tempFilePath = join(tmpdir(), req.file.originalname);
            await writeFile(tempFilePath, req.file.buffer);
            console.log('Wrote file to temp location:', tempFilePath);

            const files = await filesFromPaths([tempFilePath]);
            const file = files[0];
            console.log('Created file object for upload');

            const result = await uploadClient.uploadDirectory(files);
            console.log('Upload result object:', result);

            const cid = result.cid || result;
            const cidString = cid.toString();
            console.log('Upload successful, CID:', cidString);

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
                    console.log('Cleaned up temp file:', tempFilePath);
                } catch (error) {
                    console.error('Failed to clean up temp file:', error);
                }
            }
        }

    } catch (error) {
        console.error('Upload error:', error);
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
                listClient = await getAdminClient(adminEmail, req.userDid);
                console.log('Using admin client for upload listing with DID:', listClient.did());
            } catch (error) {
                console.log('Failed to get admin client:', error.message);
                throw new Error(`Failed to get admin client for upload listing: ${error.message}`);
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
                    error: 'No valid delegation found for this space'
                });
            }

        // Use the first valid delegation
        const delegation = spaceDelegations[0];
        console.log('Delegation object:', delegation);

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
            console.log('Using user principal client for upload listing with DID:', listClient.did());

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
