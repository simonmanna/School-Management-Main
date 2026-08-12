<#
.SYNOPSIS
  2026-08-r1 production upgrade driver. Idempotent and resumable.

.DESCRIPTION
  Every step records completion in state.json. Re-running skips finished steps,
  so an interrupted upgrade continues instead of repeating destructive work.

  Order matters and is not negotiable:
    backup -> phaseA (additive) -> phaseB (backfill) -> GATE -> phaseC (drop)
      -> phaseD (RLS) -> history -> drift -> build -> restart -> health -> verify

  phaseC is irreversible without a restore, so it is gated on
  MigrationReport.json reporting zero unmapped accounts.

.PARAMETER DryRun
  Run every read-only/verifying step and the phaseB dry run, but write nothing.

.PARAMETER Force
  Re-run a step already marked complete. Use deliberately.

.EXAMPLE
  .\upgrade.ps1 -DryRun
  .\upgrade.ps1
  .\upgrade.ps1 -Force -Step phaseB
#>
param(
    [switch]$DryRun,
    [switch]$Force,
    [string]$Step = ""
)

$ErrorActionPreference = "Stop"

$releaseDir = $PSScriptRoot
$repoRoot   = (Resolve-Path "$releaseDir\..\..").Path
$stateFile  = "$releaseDir\state.json"
$backupDir  = "$repoRoot\backups"
$apiBase    = "http://localhost:3000/api/v1"

# --- state -----------------------------------------------------------------

function Get-State {
    if (Test-Path $stateFile) { return (Get-Content $stateFile -Raw | ConvertFrom-Json) }
    return [pscustomobject]@{ release = "2026-08-r1"; started = (Get-Date -Format o); completed = @() }
}

function Save-State($state) {
    $state | ConvertTo-Json -Depth 5 | Out-File $stateFile -Encoding utf8
}

function Test-Done($state, [string]$name) {
    if ($Force -and ($Step -eq "" -or $Step -eq $name)) { return $false }
    return ($state.completed -contains $name)
}

function Complete-Step($state, [string]$name) {
    if ($state.completed -notcontains $name) {
        $state.completed = @($state.completed) + $name
    }
    $state | Add-Member -NotePropertyName "last" -NotePropertyValue $name -Force
    $state | Add-Member -NotePropertyName "lastAt" -NotePropertyValue (Get-Date -Format o) -Force
    Save-State $state
}

function Invoke-Step($state, [string]$name, [scriptblock]$body) {
    if (Test-Done $state $name) { Write-Host "  [skip] $name (already complete)"; return }
    Write-Host "  [run ] $name"
    if ($DryRun -and $name -notin @('preflight','baselineBefore','phaseBDryRun','drift')) {
        Write-Host "         DRY RUN — skipped"
        return
    }
    & $body
    Complete-Step $state $name
}

function Get-DatabaseUrl {
    if ($env:DATABASE_URL) { return $env:DATABASE_URL }
    $envFile = "$repoRoot\apps\api\.env"
    if (Test-Path $envFile) {
        $line = Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1
        if ($line) {
            $value = ($line.Line -split '=', 2)[1].Trim().Trim('"').Trim("'")
            if ($value) { return $value }
        }
    }
    throw "DATABASE_URL not found (checked environment and $envFile)."
}

function Invoke-Psql([string]$dbUrl, [string]$file) {
    psql "$dbUrl" --set ON_ERROR_STOP=on --single-transaction -f $file
    if ($LASTEXITCODE -ne 0) { throw "psql failed applying $file" }
}

# --- run -------------------------------------------------------------------

Set-Location $repoRoot
$state = Get-State
$dbUrl = Get-DatabaseUrl

Write-Host "=== 2026-08-r1 upgrade ===" -ForegroundColor Cyan
if ($DryRun) { Write-Host "DRY RUN — no writes" -ForegroundColor Yellow }
Write-Host "repo:  $repoRoot"
Write-Host "state: $stateFile"
Write-Host ""

# 0. Preflight — the sync-drain gate.
# Restoring the server database while a tablet still holds unsynced sales
# produces duplicates or silently drops them on reconnect, and no restore can
# recover those. This must be clean BEFORE services stop.
Invoke-Step $state "preflight" {
    Write-Host "         checking open sync dead-letters..."
    $dl = (psql "$dbUrl" -t -A -c 'SELECT COUNT(*) FROM "SyncOpDeadLetter" WHERE status = ''open''').Trim()
    if ($LASTEXITCODE -ne 0) { throw "preflight query failed" }
    if ([int]$dl -ne 0) { throw "SYNC NOT DRAINED: $dl open dead-letter(s). Resolve before upgrading." }

    Write-Host "         checking pending stock posting jobs..."
    $jobs = (psql "$dbUrl" -t -A -c 'SELECT COUNT(*) FROM "StockPostingJob" WHERE status IN (''pending'',''failed'')').Trim()
    if ([int]$jobs -ne 0) { throw "STOCK QUEUE NOT DRAINED: $jobs pending/failed job(s)." }

    Write-Host "         checking open cash sessions..."
    $sessions = (psql "$dbUrl" -t -A -c 'SELECT COUNT(*) FROM "CashSession" WHERE status = ''open''').Trim()
    if ([int]$sessions -ne 0) { throw "$sessions cash session(s) still open. Close all shifts first." }

    Write-Host "         OK — dead-letters 0, jobs 0, open sessions 0"
    Write-Host "         NOTE: on-device outboxes must be confirmed empty in each tablet's UI."
}

# 1. Backup. Nothing below is safe without one.
Invoke-Step $state "backup" {
    if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $file  = "$backupDir\pre-2026-08-r1-$stamp.dump"
    pg_dump --format=custom --file="$file" "$dbUrl"
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed — refusing to continue" }
    if (-not (Test-Path $file)) { throw "pg_dump reported success but $file is missing" }
    $state | Add-Member -NotePropertyName "backupFile" -NotePropertyValue $file -Force
    $sha = (git rev-parse HEAD).Trim()
    $state | Add-Member -NotePropertyName "rollbackSha" -NotePropertyValue $sha -Force
    Write-Host "         backup:   $file"
    Write-Host "         rollback: $sha"
}

# 2. Financial baseline BEFORE any schema change.
Invoke-Step $state "baselineBefore" {
    pnpm tsx "$releaseDir\verify.ts" --capture "$releaseDir\baseline-before.json"
    if ($LASTEXITCODE -ne 0) { throw "baseline capture failed" }
}

# 3. Phase A — additive DDL. Old code still runs against this, which is what
#    makes a pre-phaseC rollback a code-only revert.
Invoke-Step $state "phaseA" {
    $f = "$releaseDir\phaseA-additive.sql"
    if (-not (Test-Path $f)) { throw "$f not found — generate it during the staging rehearsal (see README)." }
    Invoke-Psql $dbUrl $f
}

# 4. Phase B — backfill, dry run first so the report exists for the gate.
Invoke-Step $state "phaseBDryRun" {
    pnpm tsx "$releaseDir\phaseB-backfill.ts"
    if ($LASTEXITCODE -ne 0) { throw "phaseB dry run reported unmapped accounts — see MigrationReport.md" }
}

Invoke-Step $state "phaseB" {
    pnpm tsx "$releaseDir\phaseB-backfill.ts" --apply
    if ($LASTEXITCODE -ne 0) { throw "phaseB apply failed" }
}

# 5. GATE. Phase C is irreversible without a restore.
Invoke-Step $state "gate" {
    $reportFile = "$releaseDir\MigrationReport.json"
    if (-not (Test-Path $reportFile)) { throw "MigrationReport.json missing — phase B did not run." }
    $report = Get-Content $reportFile -Raw | ConvertFrom-Json
    if ($report.unmapped -ne 0) {
        throw "GATE FAILED: $($report.unmapped) unmapped account(s). Phase C would destroy their classification."
    }
    if ($report.needsReview -gt 0) {
        Write-Host "         $($report.needsReview) account(s) flagged for review." -ForegroundColor Yellow
        Write-Host "         Read MigrationReport.md now — phase C makes the old value unrecoverable."
        $answer = Read-Host "         Type 'reviewed' to proceed"
        if ($answer -ne 'reviewed') { throw "Aborted at the mapping gate." }
    }
    Write-Host "         gate passed: unmapped=0"
}

# 6. Phase C — drop the legacy columns.
Invoke-Step $state "phaseC" {
    $f = "$releaseDir\phaseC-contract.sql"
    if (-not (Test-Path $f)) { throw "$f not found — generate it during the staging rehearsal (see README)." }
    Invoke-Psql $dbUrl $f
}

# 7. Phase D — RLS policies and triggers. `migrate diff` cannot emit these, so
#    they come from the migration SQL directly. Both files are idempotent.
Invoke-Step $state "phaseD" {
    $rls1 = "$repoRoot\apps\api\prisma\migrations\20260727120001_rls_and_triggers\migration.sql"
    $rls2 = "$repoRoot\apps\api\prisma\migrations\20260731093000_rls_all_org_scoped_tables\migration.sql"
    Invoke-Psql $dbUrl $rls1
    Invoke-Psql $dbUrl $rls2
    pnpm --filter @erp/api rls:setup-role
    if ($LASTEXITCODE -ne 0) { throw "rls:setup-role failed" }
}

# 8. Reconcile migration history — preserve, never delete.
#    The legacy rows stay: they are the deployment audit trail. The new names are
#    registered so ordinary `migrate deploy` works from here on.
Invoke-Step $state "history" {
    $names = @(
        "20260727120000_squashed_baseline",
        "20260727120001_rls_and_triggers",
        "20260731090000_approval_workflow_multistep",
        "20260731093000_rls_all_org_scoped_tables",
        "20260731094500_cogs_correction_movement_type"
    )
    foreach ($n in $names) {
        pnpm --filter @erp/api exec prisma migrate resolve --applied $n
        if ($LASTEXITCODE -ne 0) { throw "migrate resolve --applied $n failed" }
    }
    pnpm --filter @erp/api exec prisma migrate status
}

# 9. Drift gate — proves the database now matches schema.prisma exactly.
Invoke-Step $state "drift" {
    pnpm --filter @erp/api exec prisma migrate diff --from-url "$dbUrl" --to-schema-datamodel ./prisma/schema.prisma --exit-code
    if ($LASTEXITCODE -ne 0) { throw "SCHEMA DRIFT: database does not match schema.prisma. Do not restart services." }
    Write-Host "         no drift"
}

# 10. Build.
Invoke-Step $state "build" {
    pnpm install --frozen-lockfile;      if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
    pnpm --filter @erp/shared build;     if ($LASTEXITCODE -ne 0) { throw "shared build failed" }
    pnpm --filter @erp/api db:generate;  if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }
    pnpm --filter @erp/api build;        if ($LASTEXITCODE -ne 0) { throw "api build failed" }
    pnpm --filter @erp/web build;        if ($LASTEXITCODE -ne 0) { throw "web build failed" }
}

# 11. Restart + health gate.
Invoke-Step $state "restart" {
    nssm restart pos-cafe-api
    if ($LASTEXITCODE -ne 0) { throw "Failed to restart pos-cafe-api" }
    Start-Sleep 3
    nssm restart pos-cafe-web
    if ($LASTEXITCODE -ne 0) { throw "Failed to restart pos-cafe-web" }

    $deadline = (Get-Date).AddSeconds(120)
    foreach ($path in @('/health', '/health/ready')) {
        $ok = $false
        while ((Get-Date) -lt $deadline) {
            try {
                $r = Invoke-WebRequest -UseBasicParsing -Uri "$apiBase$path" -TimeoutSec 5
                if ($r.StatusCode -eq 200) { $ok = $true; break }
            } catch { Start-Sleep 3 }
        }
        if (-not $ok) { throw "Health check failed: $apiBase$path" }
        Write-Host "         OK $path"
    }
}

# 12. Financial verification. The money must not have moved.
Invoke-Step $state "verifyAfter" {
    pnpm tsx "$releaseDir\verify.ts" --compare "$releaseDir\baseline-before.json"
    if ($LASTEXITCODE -ne 0) { throw "FINANCIAL VERIFICATION FAILED — roll back." }
}

Write-Host ""
Write-Host "=== upgrade complete ===" -ForegroundColor Green
Write-Host "Backup:   $($state.backupFile)"
Write-Host "Rollback: $($state.rollbackSha)"
Write-Host ""
Write-Host "Still to do by hand:"
Write-Host "  - smoke: sale -> refund -> shift close -> Z-report -> trial balance"
Write-Host "  - print a receipt and a KOT"
Write-Host "  - watch the 24h monitoring table in README.md"
