import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index.js';

function clearConsoleMocks() {
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    if (global.console?.[method]?.mockClear) {
      global.console[method].mockClear();
    }
  }
}

function collectLogOutput() {
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const chunks = [];

  for (const method of methods) {
    const calls = global.console?.[method]?.mock?.calls || [];
    for (const args of calls) {
      chunks.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    }
  }

  return chunks.join('\n');
}

async function waitForAppRoutesReady() {
  for (let i = 0; i < 30; i++) {
    const res = await request(app).get('/auth/session');
    if (res.status !== 404) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('App routes did not become ready in time');
}

describe('logging integration', () => {
  beforeAll(async () => {
    await waitForAppRoutesReady();
  });

  beforeEach(() => {
    clearConsoleMocks();
  });

  test('does not leak raw auth verification inputs to logs', async () => {
    const rawDid = 'did:key:z6MkintegrationRawDid123456789';
    const rawChallengeId = 'challenge-raw-987654321';
    const rawSignature = 'sig_raw_leakcheck_1234567890';
    const rawSessionId = 'session_raw_leakcheck_1234567890';
    const rawEmail = 'leakcheck@example.org';

    const res = await request(app)
      .post('/auth/verify')
      .send({
        did: rawDid,
        challengeId: rawChallengeId,
        signature: rawSignature,
        sessionId: rawSessionId,
        email: rawEmail
      });

    expect(res.status).toBe(401);

    const output = collectLogOutput();

    expect(output).not.toContain(rawDid);
    expect(output).not.toContain(rawChallengeId);
    expect(output).not.toContain(rawSignature);
    expect(output).not.toContain(rawSessionId);
    expect(output).not.toContain(rawEmail);
    expect(output).toContain('[REDACTED]');
  });

  test('does not leak session header value in request logging', async () => {
    const rawHeaderSession = 'x-session-id-raw-leakcheck-556677';

    const res = await request(app)
      .get('/auth/session')
      .set('x-session-id', rawHeaderSession);

    expect(res.status).toBe(401);

    const output = collectLogOutput();

    expect(output).toContain('/session');
    expect(output).not.toContain(rawHeaderSession);
  });
});
