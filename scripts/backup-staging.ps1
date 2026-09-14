# Puntual - Staging Database Backup Script (PowerShell) (E11.6d)
param (
    [string]$BackupDir = (Join-Path $PSScriptRoot "../backups/staging"),
    [string]$ContainerName = "puntual_dev_postgres", # Uses dev for local test or staging on server
    [string]$PostgresUser = $env:POSTGRES_USER,
    [string]$PostgresDb = $env:POSTGRES_DB,
    [int]$RetentionDays = 7
)

if (-not $PostgresUser) { $PostgresUser = "puntual_dev" }
if (-not $PostgresDb) { $PostgresDb = "puntual_dev" }

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd_HHmmssZ")
$backupSql = Join-Path $BackupDir "backup_staging_${timestamp}.sql"
$logFile = Join-Path $BackupDir "backup.log"

function Write-Log($msg) {
    $line = "[$((Get-Date).ToUniversalTime().ToString('u'))] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

Write-Log "[START] Starting staging PostgreSQL backup..."

try {
    # Execute pg_dump inside container
    & docker exec $ContainerName pg_dump -U $PostgresUser -d $PostgresDb --clean --if-exists | Out-File -FilePath $backupSql -Encoding utf8
    $size = (Get-Item $backupSql).Length
    Write-Log "[SUCCESS] Backup created successfully: $backupSql (Size: $size bytes)"

    # Enforce retention
    $cutoff = (Get-Date).AddDays(-$RetentionDays)
    Get-ChildItem -Path $BackupDir -Filter "backup_staging_*.sql*" | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
        Remove-Item $_.FullName -Force
        Write-Log "[PURGED] Deleted old backup: $($_.FullName)"
    }
    Write-Log "[FINISH] Staging backup job finished."
    exit 0
}
catch {
    Write-Log "[ERROR] Backup failed: $_"
    exit 1
}
