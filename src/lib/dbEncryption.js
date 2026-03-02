import crypto from 'crypto';
import { logger } from './logger.js';

const ENCRYPTED_PREFIX = 'enc:';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DEFAULT_KEY_ID = 'v1';

function parseKey(rawKey) {
    if (!rawKey || typeof rawKey !== 'string') {
        return null;
    }

    const trimmed = rawKey.trim();
    if (!trimmed) {
        return null;
    }

    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return Buffer.from(trimmed, 'hex');
    }

    if (trimmed.length % 4 === 0 && BASE64_REGEX.test(trimmed)) {
        const decoded = Buffer.from(trimmed, 'base64');
        // Enforce canonical base64 form to avoid accepting malformed variants.
        if (decoded.length === KEY_BYTES && decoded.toString('base64') === trimmed) {
            return decoded;
        }
    }

    return null;
}

function parseKeyring(rawKeyring) {
    if (!rawKeyring) {
        return null;
    }

    let parsed;
    try {
        parsed = JSON.parse(rawKeyring);
    } catch {
        throw new Error('DB_ENCRYPTION_KEYS_JSON is not valid JSON.');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('DB_ENCRYPTION_KEYS_JSON must be an object of keyId -> key.');
    }

    const keys = new Map();
    for (const [keyId, keyValue] of Object.entries(parsed)) {
        if (!keyId || keyId.includes(':')) {
            throw new Error(`Invalid DB encryption key id "${keyId}".`);
        }
        const decoded = parseKey(String(keyValue));
        if (!decoded) {
            throw new Error(`Invalid DB encryption key material for key id "${keyId}".`);
        }
        keys.set(keyId, decoded);
    }

    if (keys.size === 0) {
        throw new Error('DB_ENCRYPTION_KEYS_JSON has no keys.');
    }

    const activeKeyId = process.env.DB_ENCRYPTION_ACTIVE_KEY_ID || (keys.size === 1 ? [...keys.keys()][0] : null);
    if (!activeKeyId || !keys.has(activeKeyId)) {
        throw new Error('DB_ENCRYPTION_ACTIVE_KEY_ID must reference one configured key id.');
    }

    return { keys, activeKeyId };
}

function loadEncryptionConfig() {
    if (process.env.DB_ENCRYPTION_KEYS_JSON) {
        return parseKeyring(process.env.DB_ENCRYPTION_KEYS_JSON);
    }

    const singleKey = parseKey(process.env.DB_ENCRYPTION_KEY);
    if (!singleKey) {
        return null;
    }

    const activeKeyId = process.env.DB_ENCRYPTION_KEY_ID || DEFAULT_KEY_ID;
    return {
        keys: new Map([[activeKeyId, singleKey]]),
        activeKeyId
    };
}

function getEncryptionConfig() {
    const config = loadEncryptionConfig();
    if (!config || !config.keys.has(config.activeKeyId)) {
        return null;
    }
    return config;
}

function getActiveKey(config = getEncryptionConfig()) {
    if (!config) {
        return null;
    }
    return config.keys.get(config.activeKeyId) || null;
}

function parseEncryptedValue(value) {
    if (typeof value !== 'string' || !value.startsWith(ENCRYPTED_PREFIX)) {
        return null;
    }

    const parts = value.split(':');
    // Format: enc:<keyId>:<base64 payload>
    if (parts.length < 3 || parts[0] !== 'enc') {
        return null;
    }

    const keyId = parts[1];
    const encoded = parts.slice(2).join(':');
    if (!keyId || !encoded) {
        return null;
    }

    return { keyId, encoded };
}

export function getActiveKeyId() {
    return getEncryptionConfig()?.activeKeyId ?? null;
}

export function getCipherKeyId(value) {
    const parsed = parseEncryptedValue(value);
    return parsed?.keyId ?? null;
}

export function isAtRestEncryptionEnabled() {
    return !!getActiveKey();
}

export function assertDbEncryptionConfig() {
    const encryptionRequired = process.env.REQUIRE_DB_ENCRYPTION === 'true' || process.env.NODE_ENV === 'production';
    let configError = null;
    try {
        // Validate config shape/material even when not required.
        loadEncryptionConfig();
    } catch (error) {
        configError = error;
    }

    if (configError) {
        if (!encryptionRequired) {
            throw configError;
        }
        throw new Error(`DB encryption key is required in this environment. ${configError.message}`);
    }

    if (!encryptionRequired) {
        return;
    }

    if (!getActiveKey()) {
        throw new Error(
            'DB encryption key is required in this environment. Set DB_ENCRYPTION_KEY (base64 or hex, 32 bytes).'
        );
    }
}

export function isEncryptedValue(value) {
    return !!parseEncryptedValue(value);
}

export function encryptForStorage(plaintext) {
    if (plaintext == null) {
        return plaintext;
    }

    const value = String(plaintext);
    if (isEncryptedValue(value)) {
        return value;
    }

    const config = getEncryptionConfig();
    const key = getActiveKey(config);
    if (!key || !config) {
        return value;
    }

    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, tag, ciphertext]).toString('base64');
    return `${ENCRYPTED_PREFIX}${config.activeKeyId}:${packed}`;
}

export function decryptFromStorage(value) {
    const parsed = parseEncryptedValue(value);
    if (!parsed) {
        return value;
    }

    const config = getEncryptionConfig();
    if (!config) {
        throw new Error('Encrypted database payload found but DB_ENCRYPTION_KEY is not configured.');
    }

    const key = config.keys.get(parsed.keyId);
    if (!key) {
        throw new Error(`Encrypted database payload key "${parsed.keyId}" is not available in configuration.`);
    }

    const packed = Buffer.from(parsed.encoded, 'base64');
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
    const config = getEncryptionConfig();
    if (!db || !rowId || !config) {
        return;
    }

    const encrypted = isEncryptedValue(storedValue);
    const storedKeyId = getCipherKeyId(storedValue);
    const needsReencrypt = !encrypted || storedKeyId !== config.activeKeyId;
    if (!needsReencrypt) {
        return;
    }

    try {
        const plaintext = encrypted ? decryptFromStorage(storedValue) : storedValue;
        const rotated = encryptForStorage(plaintext);
        db.prepare('UPDATE admin_agents SET agentData = ?, updatedAt = ? WHERE id = ?')
            .run(rotated, Date.now(), rowId);
        logger.info('Migrated agent data to active encryption key', {
            rowId,
            fromKeyId: storedKeyId || 'plaintext',
            toKeyId: config.activeKeyId
        });
    } catch (error) {
        logger.warn('Failed to migrate agent data to active encryption key', {
            rowId,
            error: error.message
        });
    }
}
