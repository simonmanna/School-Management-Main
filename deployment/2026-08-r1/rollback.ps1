<#
.SYNOPSIS
  Roll back the 2026-08-r1 upgrade.

.DESCRIPTION
  There are two rollbacks, and which one applies depends entirely on whether
  phase C has run:

    BEFORE phaseC — code-only. Phase A is purely additive, so the old build
      ignores the new columns and runs fine against the upgraded schema. Fast,
      no data loss.

    AFTER phaseC  — restore-only. The legacy Account.accountType and isGroup
      columns are gone. There is no forward path back; the database must be
      restored from the pre-upgrade dump, which means losing anything written
      since the cutover began.

  The script reads state.json to decide, and refuses to guess.

.EXAMPLE
  .\rollback.ps1
  .\rollback.ps1 -ConfirmRestore
#>
param(
    # Required for the destructive path. Restoring discards every write made
    # since the backup was taken.
    [switch]$ConfirmRestore
)

$ErrorActionPreference = "Stop"

$releaseDir = $PSScriptRoot
$repoRoot   = (Resolve-Path "$releaseDir\..\..").Path
$stateFile  = "$releaseDir\state.json"

if (-not (Test-Path $stateFile)) { throw "state.json not found — upgrade.ps1 never ran here. Nothing to roll back." }
$state = Get-Content $stateFile -Raw | ConvertFrom-Json

$phaseCDone  = $state.completed -contains "phaseC"
$rollbackSha = $state.rollbackSha
$backupFile  = $state.backupFile

if (-not $rollbackSha) { throw "state.json has no rollbackSha — cannot determine the pre-upgrade commit." }

Write-Host "=== 2026-08-r1 rollback ===" -ForegroundColor Cyan
Write-Host "phaseC applied: $phaseCDone"
Write-Host "rollback commit: $rollbackSha"
Write-Host "backup: $backupFile"
Write-Host ""

Set-Location $repoRoot

Write-Host "Stopping services..."
nssm stop pos-cafe-api
nssm stop pos-cafe-web

if (-not $phaseCDone) {
    # --- Code-only path ------------------------------------------------------
    Write-Host "Phase C has NOT run. Reverting code only; the schema stays (additive)." -ForegroundColor Green

    git checkout $rollbackSha
    if ($LASTEXITCODE -ne 0) { throw "git checkout $rollbackSha failed" }

    pnpm install --frozen-lockfile;     if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
    pnpm --filter @erp/shared build;    if ($LASTEXITCODE -ne 0) { throw "shared build failed" }
    pnpm --filter @erp/api db:generate; if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }
    pnpm --filter @erp/api build;       if ($LASTEXITCODE -ne 0) { throw "api build failed" }
    pnpm --filter @erp/web build;       if ($LASTEXITCODE -ne 0) { throw "web build failed" }
} else {
    # --- Restore path --------------------------------------------------------
    Write-Host "Phase C HAS run. The legacy columns are gone — only a restore can undo this." -ForegroundColor Red
    Write-Host "Restoring DISCARDS every database write made since the backup was taken." -ForegroundColor Red

    if (-not $ConfirmRestore) {
        throw "Refusing to restore without -ConfirmRestore. Re-run with that switch once you accept the data loss."
    }
    if (-not $backupFile -or -not (Test-Path $backupFile)) {
        throw "Backup file '$backupFile' not found. Cannot restore. Do not proceed — get the dump first."
    }

    $answer = Read-Host "Type the word RESTORE to confirm discarding post-cutover writes"
    if ($answer -ne 'RESTORE') { throw "Aborted." }

    if ($env:DATABASE_URL) { $dbUrl = $env:DATABASE_URL }
    else {
        $line = Select-String -Path "$repoRoot\apps\api\.env" -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1
        if (-not $line) { throw "DATABASE_URL not found." }
        $dbUrl = ($line.Line -split '=', 2)[1].Trim().Trim('"').Trim("'")
    }

    pg_restore --clean --if-exists --no-owner --dbname="$dbUrl" "$backupFile"
    if ($LASTEXITCODE -ne 0) { throw "pg_restore FAILED. Do not start services. Escalate — the database is in an unknown state." }

    git checkout $rollbackSha
    if ($LASTEXITCODE -ne 0) { throw "git checkout $rollbackSha failed" }

    pnpm install --frozen-lockfile;     if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
    pnpm --filter @erp/shared build;    if ($LASTEXITCODE -ne 0) { throw "shared build failed" }
    pnpm --filter @erp/api db:generate; if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }
    pnpm --filter @erp/api build;       if ($LASTEXITCODE -ne 0) { throw "api build failed" }
    pnpm --filter @erp/web build;       if ($LASTEXITCODE -ne 0) { throw "web build failed" }
}

Write-Host "Starting services..."
nssm start pos-cafe-api
if ($LASTEXITCODE -ne 0) { throw "Failed to start pos-cafe-api" }
Start-Sleep 3
nssm start pos-cafe-web
if ($LASTEXITCODE -ne 0) { throw "Failed to start pos-cafe-web" }

# Mark the state so a later upgrade.ps1 run does not think it is mid-flight.
Rename-Item $stateFile "state.rolled-back-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"

Write-Host ""
Write-Host "=== rollback complete ===" -ForegroundColor Green
Write-Host "Verify before reopening: /health, /health/ready, then one test sale."
