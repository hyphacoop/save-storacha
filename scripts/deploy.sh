#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DEPLOY_REF:-}" ]]; then
  echo "DEPLOY_REF is required"
  exit 1
fi

PREV_REF="$(git rev-parse HEAD)"
CHECKED_OUT_NEW_REF=0
ROLLBACK_DONE=0

restart_service() {
  local service="$1"
  if systemctl restart "$service"; then
    return 0
  fi

  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo -n systemctl restart "$service"
    return 0
  fi

  echo "Failed to restart ${service}: no non-interactive privilege path available"
  return 1
}

rollback() {
  if [[ "$CHECKED_OUT_NEW_REF" -ne 1 || "$ROLLBACK_DONE" -eq 1 ]]; then
    return
  fi

  echo "Deploy failed; rolling back to ${PREV_REF}"
  git checkout --force "${PREV_REF}"
  npm ci
  if [[ -n "${DEPLOY_SERVICE:-}" ]]; then
    restart_service "${DEPLOY_SERVICE}"
  fi
  ROLLBACK_DONE=1
}

on_error() {
  local exit_code="$1"
  trap - ERR
  set +e
  rollback
  exit "$exit_code"
}

trap 'on_error $?' ERR

echo "Deploying commit ${DEPLOY_REF}"
git fetch --prune origin
git checkout --force "${DEPLOY_REF}"
CHECKED_OUT_NEW_REF=1

echo "Installing dependencies with npm ci"
npm ci

echo "Running CI gate before restart"
npm run test:ci

if [[ -n "${DEPLOY_SERVICE:-}" ]]; then
  echo "Restarting service ${DEPLOY_SERVICE}"
  restart_service "${DEPLOY_SERVICE}"
fi

if [[ -n "${DEPLOY_HEALTHCHECK_URL:-}" ]]; then
  echo "Running health check ${DEPLOY_HEALTHCHECK_URL}"
  curl -fsS "${DEPLOY_HEALTHCHECK_URL}" >/dev/null
fi

trap - ERR
echo "Deployment completed"
