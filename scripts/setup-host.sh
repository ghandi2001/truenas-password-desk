#!/bin/sh
# setup-host.sh — readiness check and safe delegation for Password Desk deployment.
# Never enable shell tracing: the surrounding files hold operator secrets.
set -eu

usage() {
  cat >&2 <<'EOF'
Usage: setup-host.sh [--check | --prepare-cache ARCH | --deploy]

  --check            Non-mutating readiness report (Docker, .env variable
                     names only, build cache, architecture). Never prints
                     secret values and never authenticates with TrueNAS.
  --prepare-cache    Download integrity-verified npm archives for the target
                     build architecture (x64 or arm64). Uses the network.
  --deploy           Require typed confirmation, validate Compose config
                     quietly, then run the existing scripts/deploy.sh here.
EOF
  exit 2
}

die() { printf 'setup-host: %s\n' "$1" >&2; exit 1; }

mode=${1:---check}
[ "$#" -le 2 ] || usage
case "$mode" in
  --check|--prepare-cache|--deploy) ;;
  *) usage ;;
esac

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

command -v docker >/dev/null 2>&1 || die 'Docker is not installed. Install Docker with Compose yourself; this script will not.'
docker info >/dev/null 2>&1 || die 'Docker daemon is unreachable. Start Docker first.'

# The Docker daemon's platform (not this client's) is what images build for.
docker_arch=$(docker info --format '{{.Architecture}}' 2>/dev/null || printf '%s' "$(uname -m)")
case "$docker_arch" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) die 'Unsupported build architecture (need x64 or arm64). Build on a supported host.' ;;
esac

cache_ready() {
  [ -f .build-cache/manifest.json ] && [ -n "$(find .build-cache -maxdepth 1 -name '*.tgz' -print -quit 2>/dev/null)" ]
}

case "$mode" in
  --check)
    printf 'Password Desk host readiness check (names only; nothing mutated, no TrueNAS access)\n'
    printf 'Architecture for image build: %s\n' "$arch"
    if [ -f .env ]; then
      printf '  .env: present (mode %s)\n' "$(stat -c '%a' .env 2>/dev/null || printf '?')"
      printf '  .env defines (names only): %s\n' "$(sed -e 's/[[:space:]]#.*//' .env | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' | cut -d= -f1 | paste -sd, -)"
    else
      printf '  .env: MISSING — copy .env.example to .env and configure it locally\n'
    fi
    if docker compose version >/dev/null 2>&1; then
      printf '  docker compose plugin: present\n'
    else
      printf '  docker compose plugin: MISSING\n'
    fi
    if cache_ready; then
      printf '  build cache: present (%s entries in manifest)\n' \
        "$(python3 -c 'import json; print(len(json.load(open(".build-cache/manifest.json"))))' 2>/dev/null || printf '?')"
    else
      printf '  build cache: MISSING — run: python3 scripts/prepare-build-cache.py --arch %s\n' "$arch"
    fi
    printf 'Check complete. --check does not authenticate with TrueNAS and changes no SMB password.\n'
    ;;
  --prepare-cache)
    [ "${2:-}" = 'x64' ] || [ "${2:-}" = 'arm64' ] || die 'Pass the build architecture: --prepare-cache x64|arm64'
    command -v python3 >/dev/null 2>&1 || die 'python3 is required to prepare the build cache.'
    printf 'Preparing verified offline npm archives for linux/%s (network downloads).\n' "$2"
    python3 scripts/prepare-build-cache.py --arch "$2"
    ;;
  --deploy)
    [ -f .env ] || die 'No .env in the repository root. Copy .env.example to .env and configure it locally first.'
    chmod 600 .env
    cache_ready || die "Build cache missing. Run first: scripts/setup-host.sh --prepare-cache $arch"
    [ -t 0 ] && [ -t 1 ] || die 'Deployment needs an interactive terminal for the first-admin prompt.'
    printf 'This will build images and start db, app and proxy using your local .env.\n'
    printf 'Type DEPLOY to continue: '
    read -r answer
    [ "$answer" = 'DEPLOY' ] || die 'Aborted; nothing was deployed.'
    docker compose config --quiet
    exec sh scripts/deploy.sh
    ;;
esac
