# DB Encryption Key Rotation Runbook

This runbook rotates encryption keys for `admin_agents.agentData` without downtime.

## Prerequisites

- Backup `data/delegations.db`.
- Deploy build that supports keyring config (`DB_ENCRYPTION_KEYS_JSON` and `DB_ENCRYPTION_ACTIVE_KEY_ID`).

## Phase 1: Introduce keyring, keep old active

1. Configure both old and new keys:

```bash
DB_ENCRYPTION_KEYS_JSON='{"v1":"<old-key-base64>","v2":"<new-key-base64>"}'
DB_ENCRYPTION_ACTIVE_KEY_ID='v1'
REQUIRE_DB_ENCRYPTION=true
```

2. Deploy and verify service health.

## Phase 2: Switch active key for new writes

1. Update only active key id:

```bash
DB_ENCRYPTION_ACTIVE_KEY_ID='v2'
```

2. Deploy and verify service health.

At this point:
- new writes use `enc:v2:*`
- old `enc:v1:*` rows still decrypt because `v1` is still in keyring

## Phase 3: Re-encrypt existing rows to active key

Run migration with both keys still present:

```bash
npm run migrate:encrypt:agent-data
```

Validate:

```bash
sqlite3 data/delegations.db "SELECT COUNT(*) FROM admin_agents WHERE agentData LIKE 'enc:v1:%';"
```

Expected: `0`.

## Phase 4: Remove old key

1. Update keyring to keep only `v2`:

```bash
DB_ENCRYPTION_KEYS_JSON='{"v2":"<new-key-base64>"}'
DB_ENCRYPTION_ACTIVE_KEY_ID='v2'
```

2. Deploy and verify health + auth smoke checks.

## Rollback

- If any phase fails, restore previous env vars and redeploy.
- Do not remove old key from keyring until Phase 3 validation succeeds.
