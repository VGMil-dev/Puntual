#!/usr/bin/env bash
# Puntual - Healthcheck & Alert Monitor (E11.6f)
# Checks GET /health. Alerts when 2 consecutive checks fail.

HEALTH_URL="${HEALTH_URL:-http://localhost:3000/health}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
FAIL_COUNT_FILE="/tmp/puntual_health_fail_count"

touch "$FAIL_COUNT_FILE"
FAILS=$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo 0)

HTTP_CODE=$(curl -s -o /tmp/puntual_health_resp.json -w "%{http_code}" "$HEALTH_URL")

if [ "$HTTP_CODE" -eq 200 ]; then
  if [ "$FAILS" -gt 0 ]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [INFO] Puntual API recovered to healthy state (200 OK)."
    echo 0 > "$FAIL_COUNT_FILE"
  fi
  exit 0
else
  FAILS=$((FAILS + 1))
  echo "$FAILS" > "$FAIL_COUNT_FILE"
  BODY=$(cat /tmp/puntual_health_resp.json 2>/dev/null)
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [WARN] Healthcheck failed (HTTP $HTTP_CODE, attempt $FAILS): $BODY"

  if [ "$FAILS" -ge 2 ]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [ALERT] Puntual API sustained failure! (HTTP $HTTP_CODE, $FAILS consecutive checks failed)."
    if [ -n "$ALERT_WEBHOOK_URL" ]; then
      curl -s -X POST -H "Content-Type: application/json" \
        -d "{\"text\":\"[ALERT] Puntual API healthcheck failed sustained ($FAILS consecutive times). Response: $BODY\"}" \
        "$ALERT_WEBHOOK_URL" || true
    fi
  fi
  exit 1
fi
