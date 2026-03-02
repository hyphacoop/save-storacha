import { storeCachedSpaces } from '../lib/store.js';
import { getAdminClient } from '../lib/adminClientManager.js';
import { getDatabase } from '../lib/db.js';
import { logger } from '../lib/logger.js';

/**
 * Get the admin email associated with a DID if it exists
 * @param {string} did - The DID to look up
 * @returns {Promise<string|null>} The admin email if found, null otherwise
 */
export async function getAdminEmailFromDid(did) {
    try {
        const db = getDatabase();
        const result = db.prepare(`
            SELECT email 
            FROM did_email_mapping 
            WHERE did = ?
        `).get(did);

        return result ? result.email : null;
    } catch (error) {
        logger.error('Failed to get admin email for DID', { did, error: error.message });
        return null;
    }
}

export async function getSpaces(adminEmail, did) {
    if (!adminEmail) {
        throw new Error('Admin email is required to fetch spaces.');
    }
    if (!did) {
        throw new Error('Device DID is required to fetch spaces.');
    }

    try {
        const client = await getAdminClient(adminEmail, did);
        const spaces = await client.spaces();
        
        const spacesList = spaces.map(space => ({
            did: space.did(),
            name: space.name || space.did(),
            isAdmin: true 
        }));

        return spacesList;

    } catch (error) {
        logger.error('Failed to fetch spaces', { adminEmail, did, error: error.message });
        throw new Error(`Failed to fetch spaces: ${error.message}`);
    }
} 

export async function getSpacesWithSync(adminEmail, did) {
    if (!adminEmail) {
        throw new Error('Admin email is required to fetch spaces.');
    }
    if (!did) {
        throw new Error('Device DID is required to fetch spaces.');
    }

    try {
        // Always fetch current spaces from storacha service
        const client = await getAdminClient(adminEmail, did);
        
        // Ensure we have the latest delegations before fetching spaces
        try {
            await client.capability.access.claim();
            logger.info('Refreshed delegations for admin');
        } catch (error) {
            logger.warn('Could not refresh delegations for admin, using cached info', {
                adminEmail,
                error: error.message
            });
        }
        
        const serviceSpaces = await client.spaces();
        
        const serviceSpacesList = serviceSpaces.map(space => ({
            did: space.did(),
            name: space.name || space.did(),
            isAdmin: true 
        }));

        // Sync all spaces to database
        const db = getDatabase();
        for (const space of serviceSpacesList) {
            try {
                db.prepare(`
                    INSERT OR REPLACE INTO admin_spaces 
                    (adminEmail, spaceDid, spaceName, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    adminEmail,
                    space.did,
                    space.name,
                    Date.now(),
                    Date.now()
                );
            } catch (error) {
                logger.error('Failed to sync space to database', { spaceDid: space.did, error: error.message });
            }
        }

        // Update in-memory cache with the fresh service data
        storeCachedSpaces(adminEmail, serviceSpacesList);
        logger.info('Updated in-memory cache with admin spaces', { count: serviceSpacesList.length });

        // Return the fresh service data
        return serviceSpacesList;

    } catch (error) {
        logger.error('Failed to fetch spaces with sync', { adminEmail, did, error: error.message });
        throw new Error(`Failed to fetch spaces: ${error.message}`);
    }
} 
