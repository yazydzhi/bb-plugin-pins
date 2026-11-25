#!/bin/zsh
set -euo pipefail
# Deploy the static page to ponravilos.ru (served at https://ponravilos.ru/bb-plugin-pins/).
# tar over ssh: the server has no rsync. Files removed locally are not removed remotely.
ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="${DEPLOY_HOST:-root@ponravilos.ru}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/www/html/bb-plugin-pins}"
COPYFILE_DISABLE=1 tar czf - -C "$ROOT" --exclude .DS_Store --exclude deploy.sh . \
  | ssh "$HOST" "mkdir -p '$REMOTE_DIR' && tar xzf - -C '$REMOTE_DIR' && chmod -R a+rX '$REMOTE_DIR'"
echo "✓ https://ponravilos.ru/bb-plugin-pins/"
