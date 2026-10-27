#!/bin/sh
# Never enable shell tracing: runtime configuration contains secrets.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
command -v docker >/dev/null 2>&1 || { printf 'Install Docker with Compose first.\n' >&2; exit 1; }
docker info >/dev/null 2>&1 || { printf 'Start Docker first.\n' >&2; exit 1; }
[ -f .env ] || { printf 'Copy .env.example to .env and configure POSTGRES_PASSWORD locally first.\n' >&2; exit 1; }
chmod 600 .env
# Compose requires this placeholder even though the proxy is not started.
export APP_HOST=localhost
docker compose config --quiet
images=$(docker compose config --images db migrate)
[ -n "$images" ] || { printf 'Could not resolve required local images. Check Compose configuration.\n' >&2; exit 1; }
# Building here would need apt packages and Prisma engines from the Internet.
for image in $images; do
  docker image inspect "$image" >/dev/null 2>&1 || {
    printf 'Required local image missing: %s. Import the prepared images with docker load -i <archive> first; see README.md.\n' "$image" >&2
    exit 1
  }
done
docker compose up -d --wait --no-build --pull never db
docker compose run --rm --no-deps --pull never -e CHECKPOINT_DISABLE=1 migrate npm run db:migrate
# Hidden interactive password prompt; existing administrators are preserved.
docker compose run --rm --no-deps --pull never -e CHECKPOINT_DISABLE=1 migrate npm run db:seed
printf 'Setup complete. Database migrated and initial admin ready.\n'
