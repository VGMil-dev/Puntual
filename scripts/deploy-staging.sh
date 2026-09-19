#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-$HOME/puntual-staging}"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.staging.yml"
HEALTHCHECK_URL="http://localhost:3001/health"
MAX_WAIT=60

cd "$DEPLOY_DIR"

echo "=== [DEPLOY_START] $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

echo "--- 1. Pull latest develop ---"
git fetch origin develop
git reset --hard origin/develop

echo "--- 2. Ensure .env exists ---"
if [ ! -f ".env" ]; then
  echo "❌ .env no existe en $DEPLOY_DIR. Créalo antes del primer deploy."
  exit 1
fi

echo "--- 3. Pull/build Docker images ---"
docker compose -f "$COMPOSE_FILE" build puntual-api

echo "--- 4. Start data services first ---"
docker compose -f "$COMPOSE_FILE" up -d puntual-postgres puntual-redis

echo "--- 5. Wait for Postgres healthy ---"
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" ps puntual-postgres | grep -q "healthy"; then
    echo "✅ Postgres healthy"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "❌ Postgres no healthy tras 60s"
    docker compose -f "$COMPOSE_FILE" logs --tail=50 puntual-postgres
    exit 1
  fi
  sleep 2
done

echo "--- 6. Run Prisma migrations ---"
docker compose -f "$COMPOSE_FILE" run --rm --no-deps puntual-api \
  sh -c "cd /app && pnpm prisma migrate deploy --schema=./prisma/schema.prisma" \
  || {
    echo "❌ Migraciones fallaron"
    exit 1
  }

echo "--- 7. Up API ---"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans puntual-api

echo "--- 8. Healthcheck ---"
elapsed=0
until curl -sf "$HEALTHCHECK_URL" > /dev/null; do
  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    echo "❌ API no respondió en ${MAX_WAIT}s"
    docker compose -f "$COMPOSE_FILE" logs --tail=100 puntual-api
    exit 1
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

echo "✅ API healthy en ${elapsed}s"
echo "=== [DEPLOY_END] $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
