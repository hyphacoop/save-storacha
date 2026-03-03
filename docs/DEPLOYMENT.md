# CI/CD Deployment Runbook

## CI Gate

The GitHub Actions workflow at `.github/workflows/ci-deploy.yml` enforces:

- committed `package-lock.json`
- `npm ci` dependency install
- `npm run test:ci` security + architecture regression gate

`test:ci` currently runs:

- `tests/db-encryption.test.mjs`
- `tests/architecture-regression.test.mjs`
- `tests/health-route.test.mjs`

## Deployment Model

Deployments are pinned to the pushed commit SHA (`github.sha`) and run remotely via SSH.
The deploy job is bound to GitHub Environment `staging`.

Required GitHub Environment (`staging`) secrets:

- `DEPLOY_HOST`: deployment host
- `DEPLOY_USER`: SSH user
- `DEPLOY_PATH`: path to checked-out app repo on host
- `DEPLOY_SSH_KEY`: private SSH key for deploy user
- `DEPLOY_KNOWN_HOSTS`: pinned SSH host key entries for deploy host

Optional secrets:

- `DEPLOY_SERVICE`: systemd service name to restart
- `DEPLOY_HEALTHCHECK_URL`: URL to probe after restart (recommended: `http://127.0.0.1:3000/health`)

## Remote deploy script

Workflow calls `./scripts/deploy.sh` on the target host with:

- `DEPLOY_REF` set to pushed commit SHA
- optional `DEPLOY_SERVICE`
- optional `DEPLOY_HEALTHCHECK_URL`

Script steps:

1. `git fetch --prune origin`
2. `git checkout --force $DEPLOY_REF`
3. `npm ci`
4. `npm run test:ci`
5. restart service if configured
6. run health check if configured
7. rollback to prior commit + restart service if any deploy step fails after checkout

## DB encryption configuration

Set these in runtime environment:

- `DB_ENCRYPTION_KEY`: single 32-byte key, base64 or hex encoded
- `DB_ENCRYPTION_KEYS_JSON`: keyring JSON object (recommended for rotation), for example `{"v1":"<base64>","v2":"<base64>"}`
- `DB_ENCRYPTION_ACTIVE_KEY_ID`: active key id for new writes when keyring is used
- `REQUIRE_DB_ENCRYPTION=true`: fail closed if key is absent/invalid

With encryption enabled, `admin_agents.agentData` rows are stored as `enc:<keyId>:<payload>`.

## Existing DB migration plan

1. Backup database file before migration.
2. Set `DB_ENCRYPTION_KEY` to the target key in migration shell.
3. Run:

```bash
npm run migrate:encrypt:agent-data
```

4. Verify no plaintext remains:

```bash
sqlite3 data/delegations.db "SELECT COUNT(*) FROM admin_agents WHERE substr(agentData,1,4) != 'enc:';"
```

5. Set runtime env on service:
- `DB_ENCRYPTION_KEY=<same key>`
- `REQUIRE_DB_ENCRYPTION=true`

6. Restart service and run healthcheck.

## Rotation

For full key rotation steps, see `KEY_ROTATION.md`.
