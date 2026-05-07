#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
NODE_HOME="$("${ROOT_DIR}/scripts/ensure-node.sh")"
export PATH="${NODE_HOME}/bin:${PATH}"

cd "$ROOT_DIR"

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  npm install
fi

if [ "${SKIP_BUILD:-false}" != "true" ]; then
  npm run build
fi

exec node dist/main.js
