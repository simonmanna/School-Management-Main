param(
    [ValidateSet("full","web-only")]
    [string]$Mode = "full",
    # Skip the pre-flight pg_dump. Only for callers that already took one in the
    # same maintenance window (deployment/<release>/upgrade.ps1 does).
    [switch]$SkipBackup
)

$owner  = "simonmanna"
$repo   = "POS-CAFE-ABILIZ"
$posDir = "C:\microsoft\POS-CAFE"
$nginx  = "C:\Program Files\nginx\nginx.exe"
$versionFile = "$posDir\.version"
$backupDir   = "$posDir\backups"
$apiBase     = "http://localhost:3000/api/v1"

# --- helpers ---

# DATABASE_URL drives the backup and the drift gate. Prefer the ambient
# environment, fall back to apps/api/.env so this works from a bare shell.
function Get-DatabaseUrl {
    if ($env:DATABASE_URL) { return $env:DATABASE_URL }
    $envFile = "$posDir\apps\api\.env"
    if (Test-Path $envFile) {
        $line = Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1
        if ($line) {
            $value = ($line.Line -split '=', 2)[1].Trim().Trim('"').Trim("'")
            if ($value) { return $value }
        }
    }
    throw "DATABASE_URL not found (checked environment and $envFile). Cannot back up or verify the schema."
}

function Restart-Services {
    Write-Host "Restarting services..."
    # Both restarts are checked. The previous version tested $? after the API
    # restart but only $LASTEXITCODE after the web one, so a failed API restart
    # went unnoticed.
    nssm restart pos-cafe-api
    if ($LASTEXITCODE -ne 0) { throw "Failed to restart pos-cafe-api" }
    Start-Sleep 3
    nssm restart pos-cafe-web
    if ($LASTEXITCODE -ne 0) { throw "Failed to restart pos-cafe-web" }
}

# Liveness/readiness gate. The café is not reopened until these pass, so a
# half-migrated API is caught here rather than by the first cashier.
function Assert-Healthy {
    Write-Host "Health gate..."
    $deadline = (Get-Date).AddSeconds(90)
    $paths = @('/health', '/health/ready')
    foreach ($path in $paths) {
        $ok = $false
        while ((Get-Date) -lt $deadline) {
            try {
                $resp = Invoke-WebRequest -UseBasicParsing -Uri "$apiBase$path" -TimeoutSec 5
                if ($resp.StatusCode -eq 200) { $ok = $true; break }
            } catch { Start-Sleep 3 }
        }
        if (-not $ok) { throw "Health check failed: $apiBase$path did not return 200 within 90s" }
        Write-Host "  OK $path"
    }
}

function Save-Version {
    $tag = git describe --tags --abbrev=0 2>$null
    if ($tag) { $tag | Out-File $versionFile -Encoding UTF8 }
}

# --- web-only: download pre-built artifact ---
if ($Mode -eq "web-only") {
    Write-Host "Fetching latest release..."
    $release = $null
    try {
        $release = Invoke-RestMethod "https://api.github.com/repos/$owner/$repo/releases/latest"
    } catch { throw "Cannot fetch latest release: $_" }

    $tag = $release.tag_name
    if ((Test-Path $versionFile) -and ((Get-Content $versionFile) -eq $tag)) {
        Write-Host "Already on $tag — nothing to do"; exit 0
    }

    $zipUrl = ($release.assets | Where-Object { $_.name -eq "pos-web.zip" }).browser_download_url
    if (-not $zipUrl) { throw "pos-web.zip not found in release $tag" }

    Write-Host "Downloading $tag ..."
    Invoke-WebRequest $zipUrl -OutFile "$env:TEMP\pos-web.zip"

    Remove-Item "$posDir\apps\web\dist" -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path "$posDir\apps\web\dist" -Force | Out-Null
    Expand-Archive "$env:TEMP\pos-web.zip" -DestinationPath "$posDir\apps\web\dist" -Force

    nssm restart pos-cafe-web
    if ($LASTEXITCODE -ne 0) { throw "Failed to restart pos-cafe-web" }
    $tag | Out-File $versionFile -Encoding UTF8
    Write-Host "Web updated to $tag"
    exit 0
}

# --- full update ---
Write-Host "=== POS-CAFE-ABILIZ Full Update ==="

Set-Location $posDir
$dbUrl = Get-DatabaseUrl

# 0. Pre-flight backup
# Nothing below this point is safe without a restorable dump. Taken before the
# pull so the backup always matches the code currently running.
if ($SkipBackup) {
    Write-Host "0/10  backup SKIPPED (-SkipBackup)"
} else {
    Write-Host "0/10  pg_dump pre-flight backup..."
    if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }
    $stamp      = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupFile = "$backupDir\pre-update-$stamp.dump"
    pg_dump --format=custom --file="$backupFile" "$dbUrl"
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed — refusing to update without a backup" }
    if (-not (Test-Path $backupFile)) { throw "pg_dump reported success but $backupFile is missing" }
    Write-Host "      backup: $backupFile"
}

# 1. Record the current commit so a rollback has something to aim at
$rollbackSha = (git rev-parse HEAD).Trim()
$rollbackSha | Out-File "$posDir\.rollback-sha" -Encoding UTF8
Write-Host "1/10  rollback point: $rollbackSha"

# 2. Pull latest
Write-Host "2/10  git pull origin main..."
git pull origin main
if ($LASTEXITCODE -ne 0) { throw "git pull failed" }

# 3. Install dependencies
Write-Host "3/10  pnpm install..."
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

# 4. Build shared lib
Write-Host "4/10  pnpm shared:build..."
pnpm --filter @erp/shared build
if ($LASTEXITCODE -ne 0) { throw "shared build failed" }

# 5. Generate Prisma client
Write-Host "5/10  prisma generate..."
pnpm --filter @erp/api db:generate
if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }

# 6. Deploy DB migrations
# This MUST be fatal. It previously warned and continued, which rebuilt the API
# against a schema the database did not have and restarted into a total outage
# while still printing "Update complete".
#
# This step does NOT handle a renamed migration history or any destructive
# schema change — those go through deployment/<release>/upgrade.ps1 instead.
# It also never runs db:seed: the seed deleteMany's menu tables (prisma/seed.ts)
# and would wipe a live menu.
Write-Host "6/10  prisma migrate deploy..."
pnpm --filter @erp/api db:deploy
if ($LASTEXITCODE -ne 0) {
    throw "db:deploy FAILED. The database is not on the expected schema. Do NOT restart services — investigate, or roll back to $rollbackSha."
}

# 7. Drift gate
# Proves the live database now matches schema.prisma exactly. Empty diff = exit
# 0; any difference = non-zero. Catches the case where migrate deploy exits 0
# but the schema still is not what the new Prisma client expects.
Write-Host "7/10  schema drift gate..."
pnpm --filter @erp/api exec prisma migrate diff --from-url "$dbUrl" --to-schema-datamodel ./prisma/schema.prisma --exit-code
if ($LASTEXITCODE -ne 0) {
    throw "SCHEMA DRIFT: the database does not match schema.prisma. Do NOT restart services — investigate, or roll back to $rollbackSha."
}

# 8. Build API
Write-Host "8/10  pnpm --filter api build..."
pnpm --filter @erp/api build
if ($LASTEXITCODE -ne 0) { throw "api build failed" }

# 9. Build web
Write-Host "9/10  pnpm --filter web build..."
pnpm --filter @erp/web build
if ($LASTEXITCODE -ne 0) { throw "web build failed" }

# 10. Restart services, then gate on health before anyone is let back in
Write-Host "10/10 Restarting services..."
Restart-Services
Assert-Healthy
Save-Version

Write-Host "=== Update complete ==="
