# Puntual - Healthcheck & Alert Monitor (PowerShell) (E11.6f)
param (
    [string]$HealthUrl = "http://localhost:3000/health",
    [string]$AlertWebhookUrl = $env:ALERT_WEBHOOK_URL
)

$failFile = Join-Path $env:TEMP "puntual_health_fail_count.txt"
$failCount = 0
if (Test-Path $failFile) {
    [int]::TryParse((Get-Content $failFile -Raw).Trim(), [ref]$failCount) | Out-Null
}

try {
    $resp = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 5 -ErrorAction Stop
    if ($failCount -gt 0) {
        Write-Host "[$((Get-Date).ToUniversalTime().ToString('u'))] [INFO] Puntual API recovered to healthy state (200 OK)."
        Set-Content -Path $failFile -Value "0"
    } else {
        Write-Host "[$((Get-Date).ToUniversalTime().ToString('u'))] [OK] Puntual API is healthy: $($resp.status)"
    }
    exit 0
}
catch {
    $failCount++
    Set-Content -Path $failFile -Value "$failCount"
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Warning "[$((Get-Date).ToUniversalTime().ToString('u'))] [WARN] Healthcheck failed (HTTP $statusCode, attempt $failCount): $($_.ErrorDetails.Message)"

    if ($failCount -ge 2) {
        Write-Error "[$((Get-Date).ToUniversalTime().ToString('u'))] [ALERT] Sustained healthcheck failure ($failCount consecutive failures)!"
        if ($AlertWebhookUrl) {
            $payload = @{ text = "[ALERT] Puntual API healthcheck failed ($failCount consecutive failures). HTTP: $statusCode" } | ConvertTo-Json
            Invoke-RestMethod -Uri $AlertWebhookUrl -Method Post -Body $payload -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
        }
    }
    exit 1
}
