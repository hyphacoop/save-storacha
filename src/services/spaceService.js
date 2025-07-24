import { create as createClient } from '@storacha/client'; // Renamed to avoid conflict
import { StoreMemory } from '@storacha/client/stores/memory'; // Import StoreMemory
import { getAdminData, getCachedSpaces, getAdminSpaces, isAdminSpaceOwner, storeCachedSpaces } from '../lib/store.js';
import { getDelegationsForUser } from '../lib/store.js';
import { CarReader } from '@ipld/car/reader';
import { importDAG } from '@ucanto/core/delegation';
import { base64 } from "multiformats/bases/base64";
import * as Signer from '@ucanto/principal/ed25519'; // For parsing the principal string
import { DID } from '@ucanto/validator'; // For parsing the principal string to a Signer
import { getClient, getAdminClient } from '../lib/w3upClient.js';
import { getDatabase } from '../lib/db.js';

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
        console.error(`Error getting admin email for DID ${did}:`, error);
        return null;
    }
}

export async function getSpaces(adminEmail) {
    if (!adminEmail) {
        throw new Error('Admin email is required to fetch spaces.');
    }

    const db = getDatabase();
    const adminAgent = db.prepare('SELECT agentData FROM admin_agents WHERE adminEmail = ?').get(adminEmail);

    if (!adminAgent || !adminAgent.agentData) {
        throw new Error('Cannot fetch spaces: Missing admin data record. Admin needs to complete the login process.');
    }

    try {
        const client = await getAdminClient(adminEmail, adminAgent.agentData);
        const spaces = await client.spaces();
        
        const spacesList = spaces.map(space => ({
            did: space.did(),
            name: space.name || space.did(),
            isAdmin: true 
        }));

        return spacesList;

    } catch (error) {
        console.error(`Error fetching spaces for ${adminEmail}:`, error);
        throw new Error(`Failed to fetch spaces: ${error.message}`);
    }
} 

export async function getSpacesWithSync(adminEmail) {
    if (!adminEmail) {
        throw new Error('Admin email is required to fetch spaces.');
    }

    const db = getDatabase();
    const adminAgent = db.prepare('SELECT agentData FROM admin_agents WHERE adminEmail = ?').get(adminEmail);

    if (!adminAgent || !adminAgent.agentData) {
        throw new Error('Cannot fetch spaces: Missing admin data record. Admin needs to complete the login process.');
    }

    try {
        // Always fetch current spaces from storacha service
        const client = await getAdminClient(adminEmail, adminAgent.agentData);
        const serviceSpaces = await client.spaces();
        
        const serviceSpacesList = serviceSpaces.map(space => ({
            did: space.did(),
            name: space.name || space.did(),
            isAdmin: true 
        }));

        // Sync all spaces to database
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
                console.error(`Failed to sync space ${space.did} to database:`, error);
            }
        }

        // Update in-memory cache with the fresh service data
        storeCachedSpaces(adminEmail, serviceSpacesList);
        console.log(`Updated in-memory cache for ${adminEmail} with ${serviceSpacesList.length} spaces`);

        // Return the fresh service data
        return serviceSpacesList;

    } catch (error) {
        console.error(`Error fetching spaces with sync for ${adminEmail}:`, error);
        throw new Error(`Failed to fetch spaces: ${error.message}`);
    }
} 