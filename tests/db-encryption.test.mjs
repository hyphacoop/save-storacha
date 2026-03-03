import { describe, test, expect, afterEach } from '@jest/globals';
import {
    assertDbEncryptionConfig,
    encryptForStorage,
    decryptFromStorage,
    isEncryptedValue,
    getActiveKeyId,
    getCipherKeyId
} from '../src/lib/dbEncryption.js';

const ORIGINAL_ENV = {
    DB_ENCRYPTION_KEY: process.env.DB_ENCRYPTION_KEY,
    DB_ENCRYPTION_KEY_ID: process.env.DB_ENCRYPTION_KEY_ID,
    DB_ENCRYPTION_KEYS_JSON: process.env.DB_ENCRYPTION_KEYS_JSON,
    DB_ENCRYPTION_ACTIVE_KEY_ID: process.env.DB_ENCRYPTION_ACTIVE_KEY_ID,
    REQUIRE_DB_ENCRYPTION: process.env.REQUIRE_DB_ENCRYPTION,
    NODE_ENV: process.env.NODE_ENV
};

function restoreEnv(name, value) {
    if (typeof value === 'undefined') {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

afterEach(() => {
    restoreEnv('DB_ENCRYPTION_KEY', ORIGINAL_ENV.DB_ENCRYPTION_KEY);
    restoreEnv('DB_ENCRYPTION_KEY_ID', ORIGINAL_ENV.DB_ENCRYPTION_KEY_ID);
    restoreEnv('DB_ENCRYPTION_KEYS_JSON', ORIGINAL_ENV.DB_ENCRYPTION_KEYS_JSON);
    restoreEnv('DB_ENCRYPTION_ACTIVE_KEY_ID', ORIGINAL_ENV.DB_ENCRYPTION_ACTIVE_KEY_ID);
    restoreEnv('REQUIRE_DB_ENCRYPTION', ORIGINAL_ENV.REQUIRE_DB_ENCRYPTION);
    restoreEnv('NODE_ENV', ORIGINAL_ENV.NODE_ENV);
});

describe('DB encryption', () => {
    test('round-trips encrypted payloads with DB_ENCRYPTION_KEY', () => {
        process.env.DB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
        process.env.REQUIRE_DB_ENCRYPTION = 'true';
        process.env.NODE_ENV = 'test';

        assertDbEncryptionConfig();

        const plaintext = '{"id":"device","secret":"abc"}';
        const encrypted = encryptForStorage(plaintext);
        expect(isEncryptedValue(encrypted)).toBe(true);
        expect(getCipherKeyId(encrypted)).toBe('v1');
        expect(encrypted).not.toBe(plaintext);
        expect(decryptFromStorage(encrypted)).toBe(plaintext);
    });

    test('keeps plaintext when encryption key is not configured', () => {
        delete process.env.DB_ENCRYPTION_KEY;
        process.env.REQUIRE_DB_ENCRYPTION = 'false';
        process.env.NODE_ENV = 'test';

        const plaintext = 'legacy-value';
        expect(encryptForStorage(plaintext)).toBe(plaintext);
        expect(decryptFromStorage(plaintext)).toBe(plaintext);
    });

    test('fails closed when encrypted payload exists but key is missing', () => {
        process.env.DB_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
        const encrypted = encryptForStorage('sensitive');
        delete process.env.DB_ENCRYPTION_KEY;

        expect(() => decryptFromStorage(encrypted)).toThrow(/DB_ENCRYPTION_KEY/);
    });

    test('fails when encryption is required and key is invalid', () => {
        process.env.DB_ENCRYPTION_KEY = 'not-a-valid-key';
        process.env.REQUIRE_DB_ENCRYPTION = 'true';
        process.env.NODE_ENV = 'test';

        expect(() => assertDbEncryptionConfig()).toThrow(/DB encryption key is required/);
    });

    test('rejects malformed base64 key variants', () => {
        process.env.DB_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?';
        process.env.REQUIRE_DB_ENCRYPTION = 'true';
        process.env.NODE_ENV = 'test';

        expect(() => assertDbEncryptionConfig()).toThrow(/required/);
    });

    test('supports keyring config and encrypts with active key id', () => {
        const v1 = Buffer.alloc(32, 1).toString('base64');
        const v2 = Buffer.alloc(32, 2).toString('base64');
        process.env.DB_ENCRYPTION_KEYS_JSON = JSON.stringify({ v1, v2 });
        process.env.DB_ENCRYPTION_ACTIVE_KEY_ID = 'v2';
        process.env.REQUIRE_DB_ENCRYPTION = 'true';
        process.env.NODE_ENV = 'test';

        assertDbEncryptionConfig();
        expect(getActiveKeyId()).toBe('v2');

        const encrypted = encryptForStorage('rotate-me');
        expect(getCipherKeyId(encrypted)).toBe('v2');
        expect(decryptFromStorage(encrypted)).toBe('rotate-me');
    });

    test('can decrypt old-key ciphertext when old key is still in keyring', () => {
        const v1 = Buffer.alloc(32, 4).toString('base64');
        const v2 = Buffer.alloc(32, 5).toString('base64');
        process.env.DB_ENCRYPTION_KEYS_JSON = JSON.stringify({ v1, v2 });
        process.env.DB_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
        const oldCiphertext = encryptForStorage('legacy');

        process.env.DB_ENCRYPTION_ACTIVE_KEY_ID = 'v2';
        expect(decryptFromStorage(oldCiphertext)).toBe('legacy');
    });

    test('fails to decrypt ciphertext if its key id is absent from keyring', () => {
        const v1 = Buffer.alloc(32, 9).toString('base64');
        const v2 = Buffer.alloc(32, 10).toString('base64');

        process.env.DB_ENCRYPTION_KEYS_JSON = JSON.stringify({ v1 });
        process.env.DB_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
        const ciphertext = encryptForStorage('secret');

        process.env.DB_ENCRYPTION_KEYS_JSON = JSON.stringify({ v2 });
        process.env.DB_ENCRYPTION_ACTIVE_KEY_ID = 'v2';
        expect(() => decryptFromStorage(ciphertext)).toThrow(/not available/);
    });

    test('fails when keyring is provided without a valid active key id', () => {
        const v1 = Buffer.alloc(32, 7).toString('base64');
        const v2 = Buffer.alloc(32, 8).toString('base64');
        process.env.DB_ENCRYPTION_KEYS_JSON = JSON.stringify({ v1, v2 });
        delete process.env.DB_ENCRYPTION_ACTIVE_KEY_ID;
        process.env.REQUIRE_DB_ENCRYPTION = 'true';

        expect(() => assertDbEncryptionConfig()).toThrow(/DB_ENCRYPTION_ACTIVE_KEY_ID/);
    });
});
