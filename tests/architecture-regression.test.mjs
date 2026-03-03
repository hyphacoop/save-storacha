import { describe, beforeEach, test, expect, jest } from '@jest/globals';
import { ensureAuthenticated } from '../src/routes/authRoutes.js';
import { flexibleAuth } from '../src/routes/spaceRoutes.js';
import {
    createSession,
    getSession,
    clearSession,
    updateVerificationStatus,
    storeDelegation,
    getDelegationsForUser
} from '../src/lib/store.js';
import { getDatabase } from '../src/lib/db.js';

function createMockRes() {
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
    return res;
}

function clearCoreTables() {
    const db = getDatabase();
    db.prepare('DELETE FROM account_sessions').run();
    db.prepare('DELETE FROM delegations').run();
    db.prepare('DELETE FROM admin_spaces').run();
    db.prepare('DELETE FROM did_email_mapping').run();
}

describe('Architecture regression guard', () => {
    beforeEach(() => {
        clearCoreTables();
    });

    test('ensureAuthenticated rejects missing session header', () => {
        const req = { headers: {} };
        const res = createMockRes();
        const next = jest.fn();

        ensureAuthenticated(req, res, next);

        expect(res.statusCode).toBe(401);
        expect(res.body.message).toMatch(/No session ID/);
        expect(next).not.toHaveBeenCalled();
    });

    test('ensureAuthenticated accepts valid session and injects identity', () => {
        const { sessionId } = createSession('admin@example.com', 'did:key:z6Mkadmin', {}, true);
        const req = { headers: { 'x-session-id': sessionId } };
        const res = createMockRes();
        const next = jest.fn();

        ensureAuthenticated(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.userEmail).toBe('admin@example.com');
        expect(req.userDid).toBe('did:key:z6Mkadmin');
        clearSession(sessionId);
    });

    test('flexibleAuth blocks unverified session and allows verified session', () => {
        const { sessionId } = createSession('admin2@example.com', 'did:key:z6Mkadmin2', {}, false);

        const unverifiedReq = { headers: { 'x-session-id': sessionId } };
        const unverifiedRes = createMockRes();
        const unverifiedNext = jest.fn();
        flexibleAuth(unverifiedReq, unverifiedRes, unverifiedNext);
        expect(unverifiedRes.statusCode).toBe(401);
        expect(unverifiedNext).not.toHaveBeenCalled();

        updateVerificationStatus(sessionId, 'email', true);
        updateVerificationStatus(sessionId, 'did', true);

        const verifiedReq = { headers: { 'x-session-id': sessionId } };
        const verifiedRes = createMockRes();
        const verifiedNext = jest.fn();
        flexibleAuth(verifiedReq, verifiedRes, verifiedNext);

        expect(verifiedNext).toHaveBeenCalledTimes(1);
        expect(verifiedReq.userType).toBe('admin');
        expect(verifiedReq.userEmail).toBe('admin2@example.com');
        expect(Boolean(getSession(sessionId)?.isVerified)).toBe(true);
        clearSession(sessionId);
    });

    test('flexibleAuth validates delegated DID mode', () => {
        const invalidReq = { headers: { 'x-user-did': 'not-a-did' } };
        const invalidRes = createMockRes();
        const invalidNext = jest.fn();
        flexibleAuth(invalidReq, invalidRes, invalidNext);
        expect(invalidRes.statusCode).toBe(400);
        expect(invalidNext).not.toHaveBeenCalled();

        const validReq = { headers: { 'x-user-did': 'did:key:z6Mkdelegated' } };
        const validRes = createMockRes();
        const validNext = jest.fn();
        flexibleAuth(validReq, validRes, validNext);
        expect(validNext).toHaveBeenCalledTimes(1);
        expect(validReq.userType).toBe('delegated');
        expect(validReq.userDid).toBe('did:key:z6Mkdelegated');
    });

    test('delegation persistence tracks delegated architecture contracts', () => {
        const userDid = 'did:key:z6Mkdelegateduser';
        const spaceDid = 'did:key:z6Mkspace';
        storeDelegation(userDid, spaceDid, 'cid-123', 'car-payload', null, 'admin@example.com');

        const delegations = getDelegationsForUser(userDid);
        expect(delegations).toHaveLength(1);
        expect(delegations[0].spaceDid).toBe(spaceDid);
        expect(delegations[0].createdBy).toBe('admin@example.com');
    });
});
