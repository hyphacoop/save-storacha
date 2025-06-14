import { create as createClient } from '@web3-storage/w3up-client'; // Renamed to avoid conflict
import { StoreMemory } from '@web3-storage/w3up-client/stores/memory'; // Import StoreMemory
import { getAdminData, getCachedSpaces, getAdminSpaces } from '../lib/store.js';
import { CarReader } from '@ipld/car/reader';
import { importDAG } from '@ucanto/core/delegation';
import { base64 } from "multiformats/bases/base64";
import * as Signer from '@ucanto/principal/ed25519'; // For parsing the principal string
import { DID } from '@ucanto/validator'; // For parsing the principal string to a Signer
import { getClient, getAdminClient } from '../lib/w3upClient.js';
import { getDatabase } from '../lib/db.js';

export async function getSpaces(adminEmail) {
    if (!adminEmail) {
        throw new Error('Admin email is required to fetch spaces.');
    }

    const adminData = getAdminData(adminEmail);
    if (!adminData) {
        throw new Error('Cannot fetch spaces: Missing admin data record. Admin needs to complete the login process.');
    }

    try {
        // Get spaces from database that are owned by this admin
        // This ensures proper isolation between admins
        const adminSpaces = getAdminSpaces(adminEmail);
        
        if (adminSpaces.length > 0) {
            console.log(`Found ${adminSpaces.length} spaces owned by ${adminEmail} in database`);
            return adminSpaces;
        }

        // If no spaces in database, check if we have cached spaces for this admin
        // This is a fallback for backward compatibility
        const cachedSpaces = getCachedSpaces(adminEmail);
        if (cachedSpaces && cachedSpaces.length > 0) {
            console.log(`Using cached spaces data for ${adminEmail} (${cachedSpaces.length} spaces) - FALLBACK`);
            return cachedSpaces;
        }

        // If no spaces found, return empty array
        console.log(`No spaces found for ${adminEmail}`);
        return [];

    } catch (error) {
        console.error(`Error fetching spaces for ${adminEmail}:`, error);
        throw new Error(`Failed to fetch spaces: ${error.message}`);
    }
} 