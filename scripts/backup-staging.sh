#!/usr/bin/env bash
# Puntual - Staging Database Backup Script (E11.6d)
# Runs automated pg_dump with compression, external storage, and 7-day retention.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/puntual-staging}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
CONTAINER_NAME="${PG_CONTAINER:-puntual_staging_postgres}"
POSTGRES_USER="${POSTGRES_USER:-puntual_staging}"
POSTGRES_DB="${POSTGRES_DB:-puntual_staging}"
TIMESTAMP=$(date -u +"%Y%m%d_%H%M%SZ")
BACKUP_FILE="${BACKUP_DIR}/backup_staging_${TIMESTAMP}.sql.gz"
LOG_FILE="${BACKUP_DIR}/backup.log"

mkdir -p "$BACKUP_DIR"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" | tee -a "$LOG_FILE"
}

log "[START] Starting staging PostgreSQL backup..."

# Dump database using docker exec into pg_dump with gzip compression
if docker exec "$CONTAINER_NAME" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists | gzip -9 > "$BACKUP_FILE"; then
  BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  log "[SUCCESS] Backup created successfully: ${BACKUP_FILE} (Size: ${BACKUP_SIZE})"
else
  log "[ERROR] pg_dump failed!"
  exit 1
fi

# Enforce retention policy: delete backups older than RETENTION_DAYS
log "[CLEANUP] Enforcing retention policy: deleting backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "backup_staging_*.sql.gz" -type f -mtime +"$RETENTION_DAYS" -exec rm -f {} \; -exec log "[PURGED] Deleted old backup: {}" \;

log "[FINISH] Staging backup job finished."
