/**
 * Development Authentication Module
 * 
 * This module provides a simplified authentication system for development environments.
 * Instead of requiring real user authentication during development, it creates and manages
 * a persistent development identity (DID and principal) that can be used for testing.
 * 
 * Key benefits:
 * 1. Eliminates need for real authentication during development
 * 2. Provides consistent test identity across development sessions
 * 3. Persists credentials in a local cache to maintain the same identity
 * 4. Only active when NODE_ENV is 'development'
 */

import fs from 'fs/promises';
import path from 'path';
import { generatePrincipal, exportPrincipal, importPrincipal } from './signer.js';
import { logger } from './logger.js';

// Directory to store development credentials and cache
const DEV_CACHE_DIR = path.join(process.cwd(), '.dev-cache');
// Fixed development email for the test user
const DEV_EMAIL = 'dev@test.com';
// Path to store the development credentials
const DEV_CREDENTIALS_FILE = path.join(DEV_CACHE_DIR, 'dev-credentials.json');

// Ensure dev cache directory exists
async function ensureDevCacheDir() {
    try {
        await fs.access(DEV_CACHE_DIR);
    } catch {
        await fs.mkdir(DEV_CACHE_DIR, { recursive: true });
        logger.info('Created dev cache directory', { path: DEV_CACHE_DIR });
    }
}

/**
 * Initializes or loads development credentials
 * 
 * This function manages the development identity lifecycle:
 * 1. Only works in development environment (NODE_ENV === 'development')
 * 2. Attempts to load existing credentials from cache
 * 3. If no credentials exist, generates new ones and caches them
 * 
 * The credentials include:
 * - A fixed development email
 * - A DID (Decentralized Identifier)
 * - A principal key for authentication
 * - Creation timestamp
 * 
 * @returns {Promise<Object|null>} The development credentials or null if not in dev mode
 */
export async function initDevCredentials() {
    if (process.env.NODE_ENV !== 'development') {
        return null;
    }

    await ensureDevCacheDir();

    try {
        // Try to load existing credentials
        const data = await fs.readFile(DEV_CREDENTIALS_FILE, 'utf-8');
        const credentials = JSON.parse(data);
        logger.info('Loaded dev credentials from cache');
        return credentials;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            logger.error('Error loading dev credentials', { error: error.message });
            return null;
        }

        // Generate new dev credentials
        logger.info('Generating new dev credentials');
        const principal = await generatePrincipal();
        const { did, key } = await exportPrincipal(principal);

        const credentials = {
            email: DEV_EMAIL,
            userDid: did,
            principalKey: key,
            createdAt: Date.now()
        };

        // Save to cache
        await fs.writeFile(DEV_CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
        logger.info('Saved new dev credentials to cache');

        return credentials;
    }
}

/**
 * Retrieves the development principal for authentication
 * 
 * The principal is used to sign requests and authenticate actions
 * in the development environment. It's imported from the cached
 * credentials and used as the development identity.
 * 
 * @returns {Promise<Object|null>} The development principal or null if not available
 */
export async function getDevPrincipal() {
    const credentials = await initDevCredentials();
    if (!credentials) return null;

    try {
        return await importPrincipal(credentials.principalKey);
    } catch (error) {
        logger.error('Failed to import dev principal', { error: error.message });
        return null;
    }
}

/**
 * Retrieves the development user's DID
 * 
 * The DID (Decentralized Identifier) is used to identify the
 * development user across the system. It's consistent across
 * development sessions as long as the credentials aren't cleared.
 * 
 * @returns {Promise<string|null>} The development user's DID or null if not available
 */
export async function getDevUserDid() {
    const credentials = await initDevCredentials();
    return credentials?.userDid || null;
}

/**
 * Checks if the application is running in development mode with dev auth enabled
 * 
 * This is used to determine whether to use development authentication
 * instead of real user authentication. Dev auth is only enabled when
 * NODE_ENV is set to 'development'.
 * 
 * @returns {boolean} True if running in development mode
 */
export function isDevAuth() {
    return process.env.NODE_ENV === 'development';
} 