# =========================================================================
# SANFA BRIDGE - One-Line PowerShell Launcher (Zero-Install & Auto-Start)
# https://sanfaagent.my.id
#
# Usage:
#   # Jalankan sekali pakai (jendela aktif):
#   $env:BRIDGE_TOKEN='TOKEN'; irm https://sanfaagent.my.id/bridge.ps1 | iex
#
#   # Pasang Auto-Start (Tiap laptop nyala otomatis aktif di background):
#   $env:BRIDGE_TOKEN='TOKEN'; $env:BRIDGE_STARTUP='1'; irm https://sanfaagent.my.id/bridge.ps1 | iex
# =========================================================================
$Server = "https://sanfaagent.my.id"
$Dir = Join-Path $env:LOCALAPPDATA "SanfaBridge"
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }

Write-Host "==============================================================" -ForegroundColor DarkYellow
Write-Host "         SANFA BRIDGE — LOCAL AGENT CONNECTOR (CLI)           " -ForegroundColor White -NoNewline
Write-Host " [v2.2]" -ForegroundColor Green
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
Write-Host "[*] Mengunduh script terbaru dari server..." -ForegroundColor Gray
try {
    Invoke-RestMethod -Uri "$Server/scripts/sanfa-bridge.mjs" -OutFile $scriptPath
} catch {
    Write-Host "[!] Menggunakan script lokal yang tersedia..." -ForegroundColor Yellow
}

# Resolve token: env var takes priority, then $args, then prompt
$Token = ""
if ($env:BRIDGE_TOKEN -and $env:BRIDGE_TOKEN.Trim() -ne "") {
    $Token = $env:BRIDGE_TOKEN.Trim()
} else {
    for ($i = 0; $i -lt $args.Count; $i++) {
        if ($args[$i] -eq "--token" -and ($i+1) -lt $args.Count) {
            $Token = $args[$i+1]
            break
        }
    }
}

# Cek apakah mode Auto-Start diminta
$isStartup = ($args -contains "--startup") -or ($args -contains "-startup") -or ($env:BRIDGE_STARTUP -eq "1") -or ($env:AUTO_START -eq "1")

if ($isStartup) {
    # Pastikan token ada sebelum didaftarkan ke auto-start
    if ($Token -eq "") {
        $Token = Read-Host "Masukkan Token Akun Sanfa kamu"
    }

    if ($Token -ne "") {
        # Simpan config lokal
        $cfgPath = Join-Path $Dir "bridge-config.json"
        $cfg = @{ server = $Server; token = $Token } | ConvertTo-Json
        Set-Content -Path $cfgPath -Value $cfg -Encoding UTF8 -Force

        # Buat launcher VBS di Startup Windows
        $StartupFolder = [Environment]::GetFolderPath('Startup')
        $VbsPath = Join-Path $StartupFolder "SanfaBridge.vbs"
        $vbsContent = "Set WshShell = CreateObject(`"WScript.Shell`")`r`nWshShell.CurrentDirectory = `"$Dir`"`r`nWshShell.Run `"node `"`"$Dir\sanfa-bridge.mjs`"`" --server `"$Server`" --token `"$Token`"`, 0, False"
        Set-Content -Path $VbsPath -Value $vbsContent -Encoding ASCII -Force

        # Buat uninstaller sederhana di folder bridge
        $uninstPath = Join-Path $Dir "uninstall-startup.bat"
        $uninstContent = "@echo off`r`ndel /f /q `"$VbsPath`" >nul 2>&1`r`necho [SUKSES] Sanfa Bridge berhasil dihapus dari Auto-Start Windows.`r`npause"
        Set-Content -Path $uninstPath -Value $uninstContent -Encoding ASCII -Force

        Write-Host ""
        Write-Host "==============================================================" -ForegroundColor Green
        Write-Host "  [SUKSES] SANFA BRIDGE TERPASANG KE AUTO-START WINDOWS!       " -ForegroundColor White
        Write-Host "==============================================================" -ForegroundColor Green
        Write-Host "  * Folder Kerja : $Dir" -ForegroundColor Gray
        Write-Host "  * File Startup : $VbsPath" -ForegroundColor Gray
        Write-Host "  * Status       : Berjalan senyap di background (0% CPU, ~25MB RAM)." -ForegroundColor Cyan
        Write-Host "  * Auto-Start   : Otomatis aktif setiap kali laptop dinyalakan!" -ForegroundColor Yellow
        Write-Host "==============================================================`n" -ForegroundColor Green

        # Matikan proses node sanfa-bridge lama jika ada, lalu jalankan yang baru via vbs
        Start-Process "wscript.exe" -ArgumentList "`"$VbsPath`""
        Write-Host "[✓] Bridge telah aktif di laptop ini. Anda bisa langsung pakai web Sanfa!`n" -ForegroundColor Green
        return
    }
}

# Run bridge secara interaktif jika bukan mode startup
Set-Location $Dir
if ($Token -ne "") {
    node sanfa-bridge.mjs --server $Server --token $Token
} else {
    node sanfa-bridge.mjs --server $Server $args
}
