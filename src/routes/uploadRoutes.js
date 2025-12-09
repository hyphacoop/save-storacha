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
import { getDatabase } from '../lib/db.js';
import { getFilenameFromIPFS } from '../lib/ipfs.js';

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
                spaceDid
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
            // Use user-specific client for delegated users
            const userPrincipal = await getUserPrincipal(userDid);
            if (!userPrincipal) {
                throw new Error('User principal not found');
            }

            // Create Storacha client with user principal
            const store = new StoreMemory();
            const uploadClient = await create({ principal: userPrincipal, store });
            console.log('Using user principal client for upload with DID:', uploadClient.did());

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

            // Store filename metadata in database
            try {
                const db = getDatabase();
                db.prepare(`
                    INSERT OR REPLACE INTO uploads_metadata 
                    (cid, filename, uploadedBy, spaceDid, uploadedAt, size, contentType)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(
                    cidString,
                    req.file.originalname,
                    userDid,
                    spaceDid,
                    Date.now(),
                    result.size || file.size,
                    req.file.mimetype || null
                );
                console.log('Stored upload metadata:', {
                    cid: cidString,
                    filename: req.file.originalname
                });
            } catch (metadataError) {
                // Log error but don't fail the upload
                console.error('Failed to store upload metadata:', metadataError);
            }

            // Return the upload result with proper CID
            res.json({
                success: true,
                cid: cidString,
                filename: req.file.originalname,
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
            const sortBy = req.query.sortBy || 'insertedAt'; // Default sort field
            const sortOrder = req.query.sortOrder || 'desc'; // Default newest first
            const searchQuery = req.query.search ? req.query.search.toLowerCase().trim() : null; // Search by filename
            
            try {
                // Use the capability.upload.list method on the client
                console.log('Using client.capability.upload.list method with cursor:', cursor, 'size:', size);
                const result = await listClient.capability.upload.list({ 
                    cursor: cursor || '', 
                    size: size 
                });
                console.log('List result:', result);
                
                let results = result && result.results ? result.results : [];
                
                // Apply client-side sorting if requested
                if (sortBy && results.length > 0) {
                    results = [...results].sort((a, b) => {
                        let aVal, bVal;
                        
                        if (sortBy === 'size') {
                            aVal = a.size || 0;
                            bVal = b.size || 0;
                        } else if (sortBy === 'insertedAt' || sortBy === 'updatedAt') {
                            aVal = new Date(a[sortBy] || a.insertedAt).getTime();
                            bVal = new Date(b[sortBy] || b.insertedAt).getTime();
                        } else {
                            // Default to insertedAt
                            aVal = new Date(a.insertedAt).getTime();
                            bVal = new Date(b.insertedAt).getTime();
                        }
                        
                        return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
                    });
                }
                
                // Build response array and enrich with filename metadata
                const db = getDatabase();
                for (const upload of results) {
                    const cid = upload.root?.toString() || upload.cid?.toString();
                    
                    // Look up filename from local database
                    let metadata = null;
                    try {
                        metadata = db.prepare(`
                            SELECT filename, contentType, uploadedBy
                            FROM uploads_metadata 
                            WHERE cid = ? AND spaceDid = ?
                        `).get(cid, spaceDid);
                    } catch (metadataError) {
                        console.error('Error fetching metadata for CID:', cid, metadataError);
                    }
                    
                    // If no metadata in DB, try fetching from IPFS
                    if (!metadata || !metadata.filename) {
                        console.log(`[Uploads] No filename in DB for ${cid}, fetching from IPFS...`);
                        try {
                            const ipfsData = await getFilenameFromIPFS(cid, { timeout: 5000 });
                            if (ipfsData.filename) {
                                console.log(`[Uploads] ✅ Got filename from IPFS: ${ipfsData.filename}`);
                                
                                // Cache it in the database for next time
                                try {
                                    db.prepare(`
                                        INSERT OR REPLACE INTO uploads_metadata 
                                        (cid, filename, contentType, uploadedBy, spaceDid, uploadedAt, size)
                                        VALUES (?, ?, ?, ?, ?, ?, ?)
                                    `).run(
                                        cid,
                                        ipfsData.filename,
                                        ipfsData.contentType || null,
                                        userDid,
                                        spaceDid,
                                        new Date(upload.insertedAt).getTime(),
                                        upload.size || 0
                                    );
                                    console.log(`[Uploads] Cached IPFS filename in DB: ${ipfsData.filename}`);
                                } catch (cacheError) {
                                    console.error('[Uploads] Failed to cache filename:', cacheError);
                                }
                                
                                // Update metadata for this upload
                                metadata = {
                                    filename: ipfsData.filename,
                                    contentType: ipfsData.contentType,
                                    uploadedBy: userDid
                                };
                            }
                        } catch (ipfsError) {
                            console.error(`[Uploads] Failed to fetch from IPFS for ${cid}:`, ipfsError.message);
                            // Continue without filename - graceful degradation
                        }
                    }
                    
                    const uploadItem = {
                        cid,
                        filename: metadata?.filename || null,
                        contentType: metadata?.contentType || null,
                        size: upload.size,
                        created: upload.insertedAt || upload.updatedAt,
                        insertedAt: upload.insertedAt,
                        updatedAt: upload.updatedAt,
                        gatewayUrl: upload.root
                            ? `https://${upload.root.toString()}.ipfs.w3s.link/`
                            : `https://${cid}.ipfs.w3s.link/`,
                    };
                    
                    // Apply search filter if provided
                    if (searchQuery) {
                        if (uploadItem.filename && uploadItem.filename.toLowerCase().includes(searchQuery)) {
                            uploads.push(uploadItem);
                        }
                        // Skip items without filenames when searching
                    } else {
                        uploads.push(uploadItem);
                    }
                }
                
                // Return pagination info with clearer field names
                res.json({
                    success: true,
                    userDid,
                    spaceDid,
                    uploads,
                    count: uploads.length,
                    cursor: searchQuery ? null : result?.before, // Disable cursor when searching
                    hasMore: searchQuery ? false : !!result?.before,
                    sortBy,
                    sortOrder,
                    ...(searchQuery && { searchQuery })
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
            const sortBy = req.query.sortBy || 'insertedAt'; // Default sort field
            const sortOrder = req.query.sortOrder || 'desc'; // Default newest first
            const searchQuery = req.query.search ? req.query.search.toLowerCase().trim() : null; // Search by filename
            
            try {
                // Use the capability.upload.list method on the w3up client
                console.log('Using client.capability.upload.list method with cursor:', cursor, 'size:', size);
                const result = await listClient.capability.upload.list({ 
                    cursor: cursor || '', 
                    size: size 
                });
                console.log('List result:', result);
                
                let results = result && result.results ? result.results : [];
                
                // Apply client-side sorting if requested
                if (sortBy && results.length > 0) {
                    results = [...results].sort((a, b) => {
                        let aVal, bVal;
                        
                        if (sortBy === 'size') {
                            aVal = a.size || 0;
                            bVal = b.size || 0;
                        } else if (sortBy === 'insertedAt' || sortBy === 'updatedAt') {
                            aVal = new Date(a[sortBy] || a.insertedAt).getTime();
                            bVal = new Date(b[sortBy] || b.insertedAt).getTime();
                        } else {
                            // Default to insertedAt
                            aVal = new Date(a.insertedAt).getTime();
                            bVal = new Date(b.insertedAt).getTime();
                        }
                        
                        return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
                    });
                }
                
                // Build response array and enrich with filename metadata
                const db = getDatabase();
                for (const upload of results) {
                    const cid = upload.root?.toString() || upload.cid?.toString();
                    
                    // Look up filename from local database
                    let metadata = null;
                    try {
                        metadata = db.prepare(`
                            SELECT filename, contentType, uploadedBy
                            FROM uploads_metadata 
                            WHERE cid = ? AND spaceDid = ?
                        `).get(cid, spaceDid);
                    } catch (metadataError) {
                        console.error('Error fetching metadata for CID:', cid, metadataError);
                    }
                    
                    // If no metadata in DB, try fetching from IPFS
                    if (!metadata || !metadata.filename) {
                        console.log(`[Uploads] No filename in DB for ${cid}, fetching from IPFS...`);
                        try {
                            const ipfsData = await getFilenameFromIPFS(cid, { timeout: 5000 });
                            if (ipfsData.filename) {
                                console.log(`[Uploads] ✅ Got filename from IPFS: ${ipfsData.filename}`);
                                
                                // Cache it in the database for next time
                                try {
                                    db.prepare(`
                                        INSERT OR REPLACE INTO uploads_metadata 
                                        (cid, filename, contentType, uploadedBy, spaceDid, uploadedAt, size)
                                        VALUES (?, ?, ?, ?, ?, ?, ?)
                                    `).run(
                                        cid,
                                        ipfsData.filename,
                                        ipfsData.contentType || null,
                                        userDid,
                                        spaceDid,
                                        new Date(upload.insertedAt).getTime(),
                                        upload.size || 0
                                    );
                                    console.log(`[Uploads] Cached IPFS filename in DB: ${ipfsData.filename}`);
                                } catch (cacheError) {
                                    console.error('[Uploads] Failed to cache filename:', cacheError);
                                }
                                
                                // Update metadata for this upload
                                metadata = {
                                    filename: ipfsData.filename,
                                    contentType: ipfsData.contentType,
                                    uploadedBy: userDid
                                };
                            }
                        } catch (ipfsError) {
                            console.error(`[Uploads] Failed to fetch from IPFS for ${cid}:`, ipfsError.message);
                            // Continue without filename - graceful degradation
                        }
                    }
                    
                    const uploadItem = {
                        cid,
                        filename: metadata?.filename || null,
                        contentType: metadata?.contentType || null,
                        size: upload.size,
                        created: upload.insertedAt || upload.updatedAt,
                        insertedAt: upload.insertedAt,
                        updatedAt: upload.updatedAt,
                        gatewayUrl: upload.root
                            ? `https://${upload.root.toString()}.ipfs.w3s.link/`
                            : `https://${cid}.ipfs.w3s.link/`,
                    };
                    
                    // Apply search filter if provided
                    if (searchQuery) {
                        if (uploadItem.filename && uploadItem.filename.toLowerCase().includes(searchQuery)) {
                            uploads.push(uploadItem);
                        }
                        // Skip items without filenames when searching
                    } else {
                        uploads.push(uploadItem);
                    }
                }
                
                // Return pagination info with clearer field names
                res.json({
                    success: true,
                    userDid,
                    spaceDid,
                    uploads,
                    count: uploads.length,
                    cursor: searchQuery ? null : result?.before, // Disable cursor when searching
                    hasMore: searchQuery ? false : !!result?.before,
                    sortBy,
                    sortOrder,
                    ...(searchQuery && { searchQuery })
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
