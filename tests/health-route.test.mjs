import { describe, test, expect } from '@jest/globals';
import { getHealthPayload } from '../src/routes/healthRoutes.js';

describe('health route payload', () => {
    test('returns expected health structure', () => {
        const payload = getHealthPayload();
        expect(payload.ok).toBe(true);
        expect(payload.service).toBe('save-storacha');
        expect(typeof payload.timestamp).toBe('string');
        expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
    });
});
