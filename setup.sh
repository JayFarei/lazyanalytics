#!/usr/bin/env bash
set -euo pipefail

# lazyanalytics bootstrap for repo-clone users.
# Builds the worker bundle + CLI, then hands off to "lazyanalytics setup".
# All flags are forwarded, e.g.: ./setup.sh --sites example.com --yes

cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || { echo "Error: Node.js 20+ is required. Install from https://nodejs.org"; exit 1; }

NODE_VERSION=$(node -v | cut -d. -f1 | tr -d 'v')
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "Error: Node.js 20+ required (found v$NODE_VERSION)"
  exit 1
fi

echo "Installing dependencies..."
npm install

echo "Building worker bundle and CLI..."
npm run build

exec node cli/dist/index.js setup "$@"
