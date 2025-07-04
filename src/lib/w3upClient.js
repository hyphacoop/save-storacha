/**
 * @deprecated This module is deprecated in favor of adminClientManager.js.
 * This file is kept for backward compatibility and to avoid breaking imports.
 * All new code should use getAdminClient from adminClientManager.
 */
import { getAdminClient } from './adminClientManager.js';
import { logger } from './logger.js';

logger.warn('w3upClient.js is deprecated and will be removed in a future version. Use adminClientManager.js instead.');

// Re-export the new factory function for any existing imports.
export { getAdminClient };

// Deprecate the old getClient function to guide developers to the new pattern.
export function getClient() {
    throw new Error('getClient() is deprecated. Use getAdminClient(email) instead to get a user-specific client.');
}

// Add other deprecated functions here if necessary, e.g., to guide away from global client patterns.
export function initializeW3UpClient() {
    logger.warn('initializeW3UpClient() is deprecated and should not be used. Clients are now managed per-user.');
    return Promise.resolve();
}

export function getServerDid() {
    throw new Error('getServerDid() is deprecated as there is no longer a single global client.');
}

export function clearClientState() {
    logger.warn('clearClientState() is deprecated. Client state is now managed per-user and cleared automatically.');
    // No-op since we don't have global state anymore
} 