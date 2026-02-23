import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { logger, sanitizeForLog, sanitizeLogMessage } from '../src/lib/logger.js';

describe('logger sanitization', () => {
  beforeEach(() => {
    logger.setLogLevel(logger.LOG_LEVELS.DEBUG);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('sanitizes sensitive keys recursively', () => {
    const input = {
      email: 'alice@example.com',
      sessionId: 'f'.repeat(64),
      nested: {
        signature: 'abc123',
        safe: 'ok'
      },
      list: [{ delegationCar: 'base64-car-data' }]
    };

    const result = sanitizeForLog(input);

    expect(result.email).toBe('[REDACTED]');
    expect(result.sessionId).toBe('[REDACTED]');
    expect(result.nested.signature).toBe('[REDACTED]');
    expect(result.nested.safe).toBe('ok');
    expect(result.list[0].delegationCar).toBe('[REDACTED]');
  });

  test('sanitizes sensitive patterns in free-form strings', () => {
    const message = 'admin@example.com did:key:z6Mkwxyz authorization: token123';
    const sanitized = sanitizeLogMessage(message);

    expect(sanitized).toContain('[REDACTED_EMAIL]');
    expect(sanitized).toContain('[REDACTED_DID]');
    expect(sanitized).toContain('authorization: [REDACTED]');
  });

  test('logger output is sanitized in message and data', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    logger.info(
      'Auth attempt did:key:z6Mkwxyz admin@example.com x-session-id: abc123',
      {
        sessionId: 'abc123',
        note: 'token=secret456',
        nested: {
          challenge: 'challenge-body',
          regular: 'did:key:z6Mkregular'
        }
      }
    );

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(infoSpy.mock.calls[0][0]);

    expect(payload.message).toContain('[REDACTED_DID]');
    expect(payload.message).toContain('[REDACTED_EMAIL]');
    expect(payload.message).toContain('x-session-id: [REDACTED]');
    expect(payload.sessionId).toBe('[REDACTED]');
    expect(payload.note).toContain('token=[REDACTED]');
    expect(payload.nested.challenge).toBe('[REDACTED]');
    expect(payload.nested.regular).toContain('[REDACTED_DID]');
  });

  test('redacts header-like keys and long opaque blobs', () => {
    const result = sanitizeForLog({
      headers: {
        'x-session-id': 'abcdef1234567890',
        authorization: 'Bearer something-secret'
      },
      rawBlob: 'Z'.repeat(120),
      hexId: 'f'.repeat(64)
    });

    expect(result.headers['x-session-id']).toBe('[REDACTED]');
    expect(result.headers.authorization).toBe('[REDACTED]');
    expect(result.rawBlob).toBe('[REDACTED_BLOB]');
    expect(result.hexId).toBe('[REDACTED_HEX]');
  });
});
