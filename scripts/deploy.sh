#!/usr/bin/env bash
# Builds the frontend and copies the integration and the private house files to a
# Home Assistant host over SSH. Settings come from .deploy.env (not in git):
#   HOMESLICE_HOST=user@host
#   HOMESLICE_CONFIG=/path/to/homeassistant/config
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .deploy.env ] && source .deploy.env
: "${HOMESLICE_HOST:?set HOMESLICE_HOST in .deploy.env}"
: "${HOMESLICE_CONFIG:?set HOMESLICE_CONFIG in .deploy.env}"

npm run --silent build
rsync -a --delete --exclude __pycache__ custom_components/homeslice/ "$HOMESLICE_HOST:$HOMESLICE_CONFIG/custom_components/homeslice/"
if compgen -G "houses/*.yaml" >/dev/null; then
  rsync -a houses/*.yaml "$HOMESLICE_HOST:$HOMESLICE_CONFIG/homeslice/"
fi
echo "Deployed to $HOMESLICE_HOST. Python changes need a Home Assistant restart, frontend and house changes a page reload."
