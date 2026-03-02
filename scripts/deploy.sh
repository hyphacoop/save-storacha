#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DEPLOY_REF:-}" ]]; then
  echo "DEPLOY_REF is required"
  exit 1
fi

echo "Deploying commit ${DEPLOY_REF}"
git fetch --prune origin
git checkout --force "${DEPLOY_REF}"

echo "Installing dependencies with npm ci"
npm ci

echo "Running CI gate before restart"
npm run test:ci

if [[ -n "${DEPLOY_SERVICE:-}" ]]; then
  echo "Restarting service ${DEPLOY_SERVICE}"
  systemctl restart "${DEPLOY_SERVICE}"
fi

if [[ -n "${DEPLOY_HEALTHCHECK_URL:-}" ]]; then
  echo "Running health check ${DEPLOY_HEALTHCHECK_URL}"
  curl -fsS "${DEPLOY_HEALTHCHECK_URL}" >/dev/null
fi

echo "Deployment completed"
