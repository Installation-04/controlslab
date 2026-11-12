#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
#
# ControlsLab installer — builds and starts the single container.
#
#   ./install.sh              install (or re-apply) and start
#   ./install.sh --update     git pull, rebuild and restart
#   ./install.sh --uninstall  stop and remove the container, network and image
#   ./install.sh --help
#
# Idempotent: safe to run several times. Needs Docker with the Compose plugin.
set -eu

cd "$(dirname "$0")"

say()  { printf '%s\n' "$*"; }
fail() { printf 'Erreur / Error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: ./install.sh [--update | --uninstall | --help]

  (no option)   create .env from .env.example if missing, build and start
  --update      git pull (fast-forward only), rebuild and restart
  --uninstall   stop and remove the container, network and local image
                (your browser data is untouched: it never lived on the server)
USAGE
}

MODE=install
case "${1:-}" in
  "") ;;
  --update) MODE=update ;;
  --uninstall) MODE=uninstall ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

command -v docker >/dev/null 2>&1 || fail "Docker introuvable. Installez Docker: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "Le plugin « docker compose » (v2) est requis. / The Docker Compose v2 plugin is required."
docker info >/dev/null 2>&1 || fail "Le démon Docker ne répond pas (droits? service arrêté?). / Cannot reach the Docker daemon."

if [ "$MODE" = uninstall ]; then
  docker compose down --rmi local --remove-orphans
  say "ControlsLab désinstallé. / ControlsLab removed."
  exit 0
fi

if [ ! -f .env ]; then
  cp .env.example .env
  say "Fichier .env créé à partir de .env.example (modifiez-le au besoin). / Created .env from .env.example."
fi

if [ "$MODE" = update ]; then
  command -v git >/dev/null 2>&1 || fail "git est requis pour --update."
  git pull --ff-only
fi

# shellcheck disable=SC1091
. ./.env
PORT="${WEB_PORT:-12000}"

docker compose up -d --build

say "Attente du démarrage… / Waiting for the container to become healthy…"
tries=0
while [ "$tries" -lt 60 ]; do
  status=$(docker inspect --format '{{.State.Health.Status}}' controlslab-web 2>/dev/null || echo starting)
  [ "$status" = healthy ] && break
  [ "$status" = unhealthy ] && { docker compose logs --tail 30 web >&2; fail "Le conteneur est « unhealthy »."; }
  tries=$((tries + 1))
  sleep 2
done
[ "$status" = healthy ] || { docker compose logs --tail 30 web >&2; fail "Délai dépassé. / Timed out."; }

say ""
say "✓ ControlsLab est prêt / is ready :  http://localhost:${PORT}"
