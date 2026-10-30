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
# optional: import the copied house files into Homeslice's storage right away
#   HOMESLICE_URL=http://host:8123   HOMESLICE_TOKEN_FILE=~/.ha_token
if [ -n "${HOMESLICE_URL:-}" ] && [ -n "${HOMESLICE_TOKEN_FILE:-}" ] && compgen -G "houses/*.yaml" >/dev/null; then
  if curl -sf -X POST -H "Authorization: Bearer $(cat "${HOMESLICE_TOKEN_FILE/#\~/$HOME}")" \
    "$HOMESLICE_URL/api/services/homeslice/import_files" >/dev/null; then
    echo "House files imported into Homeslice's storage."
  else
    echo "Could not import the house files (is the integration up to date and running?)."
  fi
fi
echo "Deployed to $HOMESLICE_HOST. Python changes need a Home Assistant restart, frontend and house changes a page reload."
