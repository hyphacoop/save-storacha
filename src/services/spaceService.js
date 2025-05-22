import { create as createClient } from '@web3-storage/w3up-client'; // Renamed to avoid conflict
import { StoreMemory } from '@web3-storage/w3up-client/stores/memory'; // Import StoreMemory
import { getAdminData, getCachedSpaces } from '../lib/store.js';
import { CarReader } from '@ipld/car/reader';
import { importDAG } from '@ucanto/core/delegation';
import { base64 } from "multiformats/bases/base64";
import * as Signer from '@ucanto/principal/ed25519'; // For parsing the principal string
import { DID } from '@ucanto/validator'; // For parsing the principal string to a Signer
import { getClient } from '../lib/w3upClient.js';

export async function getSpaces(adminEmail) {
    if (!adminEmail) {
        throw new Error('Admin email is required to fetch spaces.');
    }

    const adminData = getAdminData(adminEmail);
    if (!adminData) {
        throw new Error('Cannot fetch spaces: Missing admin data record. Admin needs to complete the login process.');
    }

    try {
        // First try to get spaces from cache
        const cachedSpaces = getCachedSpaces(adminEmail);
        if (cachedSpaces) {
            console.log(`Using cached spaces data for ${adminEmail}`);
            return cachedSpaces;
        }

        // If no cache, get spaces from client
        const client = getClient();
        const spaces = client.spaces();
        console.log(`Found ${spaces.length} spaces for ${adminEmail}`);
        
        // Map spaces to include both DID and name
        // Note: We can't get names directly from the client, so we'll use the DID as a fallback
        const spacesList = spaces.map(space => ({
            did: space.did(),
            name: space.did() // Using DID as name until we can get the actual name
        }));

        return spacesList;
    } catch (error) {
        console.error(`Error fetching spaces for ${adminEmail}:`, error);
        throw new Error(`Failed to fetch spaces: ${error.message}`);
    }
} 