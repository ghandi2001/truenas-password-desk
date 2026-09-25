#!/bin/sh
# Never enable shell tracing: runtime configuration contains secrets.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
mode=${1:-deploy}
case "$mode" in deploy|--database-only) ;; *) printf 'Usage: %s [--database-only]\n' "$0" >&2; exit 2 ;; esac
command -v docker >/dev/null 2>&1 || { printf 'Install Docker with Compose first.\n' >&2; exit 1; }
docker info >/dev/null 2>&1 || { printf 'Start Docker first.\n' >&2; exit 1; }
[ -f .env ] || { printf 'Copy .env.example to .env and configure it locally first.\n' >&2; exit 1; }
chmod 600 .env
# Database-only setup does not require a public hostname yet.
if [ "$mode" = '--database-only' ]; then export APP_HOST=localhost; fi
docker compose config --quiet
if [ "$mode" = 'deploy' ]; then
  docker compose build app migrate
  # Fail before database work if required application configuration is missing.
  docker compose run --rm --no-deps migrate npx tsx -e 'require("./src/server/config").loadConfig()'
else
  docker compose build migrate
fi
docker compose up -d --wait db
docker compose run --rm --no-deps migrate npm run db:migrate
if [ "$mode" = '--database-only' ]; then
  printf 'Database ready and migrations applied. Run ./scripts/deploy.sh to seed and launch.\n'
  exit 0
fi
# TTY prompt; no password argument, environment variable, file or default password.
docker compose run --rm --no-deps migrate npm run db:seed
docker compose up -d --wait app proxy
printf 'Deployment complete. Open the APP_URL configured in your local .env.\n'
