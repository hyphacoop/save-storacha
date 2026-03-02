# CI/CD Deployment Runbook

## CI Gate

The GitHub Actions workflow at `.github/workflows/ci-deploy.yml` enforces:

- committed `package-lock.json`
- `npm ci` dependency install
- `npm run test:ci` security + architecture regression gate

`test:ci` currently runs:

- `tests/logger-sanitization.test.mjs`
- `tests/no-console-logging.test.mjs`
- `tests/db-encryption.test.mjs`
- `tests/architecture-regression.test.mjs`

## Deployment Model

Deployments are pinned to the pushed commit SHA (`github.sha`) and run remotely via SSH.

Required GitHub repository secrets:

- `DEPLOY_HOST`: deployment host
- `DEPLOY_USER`: SSH user
- `DEPLOY_PATH`: path to checked-out app repo on host
- `DEPLOY_SSH_KEY`: private SSH key for deploy user

Optional secrets:

- `DEPLOY_SERVICE`: systemd service name to restart
- `DEPLOY_HEALTHCHECK_URL`: URL to probe after restart

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

## DB encryption configuration

Set these in runtime environment:

- `DB_ENCRYPTION_KEY`: 32-byte key, base64 or hex encoded
- `REQUIRE_DB_ENCRYPTION=true`: fail closed if key is absent/invalid

With encryption enabled, new `admin_agents.agentData` rows are stored as encrypted payloads (`enc:v1:*`).
