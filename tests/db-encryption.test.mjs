import { describe, test, expect, afterEach } from '@jest/globals';
import {
    assertDbEncryptionConfig,
    encryptForStorage,
    decryptFromStorage,
    isEncryptedValue
} from '../src/lib/dbEncryption.js';

const ORIGINAL_ENV = {
    DB_ENCRYPTION_KEY: process.env.DB_ENCRYPTION_KEY,
    REQUIRE_DB_ENCRYPTION: process.env.REQUIRE_DB_ENCRYPTION,
    NODE_ENV: process.env.NODE_ENV
};

afterEach(() => {
    process.env.DB_ENCRYPTION_KEY = ORIGINAL_ENV.DB_ENCRYPTION_KEY;
    process.env.REQUIRE_DB_ENCRYPTION = ORIGINAL_ENV.REQUIRE_DB_ENCRYPTION;
    process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
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

        expect(() => assertDbEncryptionConfig()).toThrow(/DB encryption key is required/);
    });
});
