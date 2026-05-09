#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
NODE_HOME="$("${ROOT_DIR}/scripts/ensure-node.sh")"
export PATH="${NODE_HOME}/bin:${PATH}"

for arg in "$@"; do
  case "$arg" in
    --port=*) export PORT="${arg#*=}" ;;
    --public-base-url=*) export PUBLIC_BASE_URL="${arg#*=}" ;;
    --admin-service-base-url=*) export ADMIN_SERVICE_BASE_URL="${arg#*=}" ;;
    --admin-service-public-base-url=*) export ADMIN_SERVICE_PUBLIC_BASE_URL="${arg#*=}" ;;
    --storage-root=*) export WEBHARD_STORAGE_ROOT="${arg#*=}" ;;
    --db-host=*) export WEBHARD_DB_HOST="${arg#*=}" ;;
    --db-port=*) export WEBHARD_DB_PORT="${arg#*=}" ;;
    --db-database=*) export WEBHARD_DB_DATABASE="${arg#*=}" ;;
    --db-username=*) export WEBHARD_DB_USERNAME="${arg#*=}" ;;
    --db-password=*) export WEBHARD_DB_PASSWORD="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

cd "$ROOT_DIR"

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  npm install
fi

if [ "${SKIP_BUILD:-false}" != "true" ]; then
  npm run build
fi

exec node dist/main.js
