# =========================================================================
# SANFA BRIDGE - One-Line PowerShell Launcher (Zero-Install)
# https://sanfaagent.my.id
# =========================================================================
$Server = "https://sanfaagent.my.id"
$Dir = Join-Path $env:LOCALAPPDATA "SanfaBridge"
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }

Write-Host "==============================================================" -ForegroundColor DarkYellow
Write-Host "         SANFA BRIDGE — LOCAL AGENT CONNECTOR (CLI)           " -ForegroundColor White -NoNewline
Write-Host " [v2.0]" -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor DarkYellow

# Check Node.js
$hasNode = (Get-Command node -ErrorAction SilentlyContinue) -ne $null
if (-not $hasNode) {
    Write-Host "[!] Node.js belum terdeteksi di laptop ini." -ForegroundColor Yellow
    Write-Host "[*] Mencoba menginstall Node.js LTS via winget..." -ForegroundColor Cyan
    try {
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $hasNode = (Get-Command node -ErrorAction SilentlyContinue) -ne $null
    } catch {
        Write-Host "[X] Gagal auto-install Node.js via winget." -ForegroundColor Red
    }

    if (-not $hasNode) {
        Write-Host "`n[PENTING] Silakan unduh dan pasang Node.js sekali dari: https://nodejs.org" -ForegroundColor Yellow
        Write-Host "Setelah pasang Node.js, jalankan kembali perintah ini!`n" -ForegroundColor Yellow
        return
    }
}

# Download latest sanfa-bridge.mjs
$scriptPath = Join-Path $Dir "sanfa-bridge.mjs"
Write-Host "[*] Menghubungkan ke server Sanfa Agent..." -ForegroundColor Gray
try {
    Invoke-RestMethod -Uri "$Server/scripts/sanfa-bridge.mjs" -OutFile $scriptPath
} catch {
    Write-Host "[!] Gagal download script terbaru, menggunakan cache lokal..." -ForegroundColor Yellow
}

# Run bridge in local directory
Set-Location $Dir
node sanfa-bridge.mjs --server $Server $args
