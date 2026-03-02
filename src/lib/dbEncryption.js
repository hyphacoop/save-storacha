import crypto from 'crypto';
import { logger } from './logger.js';

const ENCRYPTED_PREFIX = 'enc:v1:';
const KEY_BYTES = 32;
const IV_BYTES = 12;

function parseKey(rawKey) {
    if (!rawKey || typeof rawKey !== 'string') {
        return null;
    }

    const trimmed = rawKey.trim();
    if (!trimmed) {
        return null;
    }

    // Support either base64 or hex encoded keys.
    let decoded;
    try {
        decoded = Buffer.from(trimmed, 'base64');
        if (decoded.length === KEY_BYTES) {
            return decoded;
        }
    } catch {
        // Fall through and try hex.
    }

    if (/^[0-9a-fA-F]+$/.test(trimmed)) {
        decoded = Buffer.from(trimmed, 'hex');
        if (decoded.length === KEY_BYTES) {
            return decoded;
        }
    }

    return null;
}

function getEncryptionKey() {
    return parseKey(process.env.DB_ENCRYPTION_KEY);
}

export function isAtRestEncryptionEnabled() {
    return !!getEncryptionKey();
}

export function assertDbEncryptionConfig() {
    const encryptionRequired = process.env.REQUIRE_DB_ENCRYPTION === 'true' || process.env.NODE_ENV === 'production';
    if (!encryptionRequired) {
        return;
    }

    if (!getEncryptionKey()) {
        throw new Error(
            'DB encryption key is required in this environment. Set DB_ENCRYPTION_KEY (base64 or hex, 32 bytes).'
        );
    }
}

export function isEncryptedValue(value) {
    return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptForStorage(plaintext) {
    if (plaintext == null) {
        return plaintext;
    }

    const value = String(plaintext);
    if (isEncryptedValue(value)) {
        return value;
    }

    const key = getEncryptionKey();
    if (!key) {
        return value;
    }

    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, tag, ciphertext]).toString('base64');
    return `${ENCRYPTED_PREFIX}${packed}`;
}

export function decryptFromStorage(value) {
    if (value == null || typeof value !== 'string' || !isEncryptedValue(value)) {
        return value;
    }

    const key = getEncryptionKey();
    if (!key) {
        throw new Error('Encrypted database payload found but DB_ENCRYPTION_KEY is not configured.');
    }

    const encoded = value.slice(ENCRYPTED_PREFIX.length);
    const packed = Buffer.from(encoded, 'base64');
    if (packed.length <= IV_BYTES + 16) {
        throw new Error('Encrypted database payload is malformed.');
    }

    const iv = packed.subarray(0, IV_BYTES);
    const tag = packed.subarray(IV_BYTES, IV_BYTES + 16);
    const ciphertext = packed.subarray(IV_BYTES + 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return plaintext;
}

export function maybeReencryptAgentData(db, rowId, storedValue) {
    if (!db || !rowId || !isAtRestEncryptionEnabled() || isEncryptedValue(storedValue)) {
        return;
    }

    try {
        const encrypted = encryptForStorage(storedValue);
        db.prepare('UPDATE admin_agents SET agentData = ?, updatedAt = ? WHERE id = ?')
            .run(encrypted, Date.now(), rowId);
        logger.info('Migrated legacy plaintext agent data to encrypted format', { rowId });
    } catch (error) {
        logger.warn('Failed to migrate plaintext agent data to encrypted format', {
            rowId,
            error: error.message
        });
    }
}
