@echo off
title Pasang Sanfa Bridge Auto-Start Windows
cd /d "%~dp0"

echo ==============================================================
echo    PASANG SANFA BRIDGE AUTO-START (SETIAP LAPTOP MENYALA)
echo ==============================================================
echo.
echo Script ini akan mendaftarkan Sanfa Bridge ke Startup Windows.
echo Setiap kali laptop dinyalakan, Bridge otomatis aktif di background
echo secara senyap tanpa jendela CMD (RAM ~25MB, CPU 0%%).
echo.

rem Cek Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js belum terpasang di laptop ini!
    echo Silakan pasang Node.js dari https://nodejs.org terlebih dahulu.
    pause
    exit /b 1
)

rem Cek Token
set "TOKEN_VAL="
if exist "bridge-config.json" (
    echo [INFO] Menemukan konfigurasi tersimpan di bridge-config.json.
) else (
    echo Masukkan Token Akun Sanfa Anda (lihat di Profil akun):
    set /p "TOKEN_VAL=Token: "
    if not defined TOKEN_VAL (
        echo [ERROR] Token wajib diisi!
        pause
        exit /b 1
    )
    (
        echo {
        echo   "server": "https://sanfaagent.my.id",
        echo   "token": "%TOKEN_VAL%"
        echo }
    ) > bridge-config.json
    echo [OK] Token berhasil disimpan ke bridge-config.json.
)

rem Path Startup Windows
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS_STARTUP=%STARTUP_FOLDER%\SanfaBridge.vbs"

rem Buat VBS launcher di folder Startup yang mengarah ke folder ini
(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo WshShell.CurrentDirectory = "%~dp0"
echo WshShell.Run "node ""%~dp0sanfa-bridge.mjs""", 0, False
) > "%VBS_STARTUP%"

echo.
echo ==============================================================
echo [SUKSES] Sanfa Bridge berhasil didaftarkan ke Startup Windows!
echo ==============================================================
echo File Startup : %VBS_STARTUP%
echo Target Script: %~dp0sanfa-bridge.mjs
echo.
echo Mulai sekarang, setiap kali laptop Anda menyala,
echo laptop Anda otomatis langsung terhubung ke Sanfa Agent.
echo.
echo Menjalankan Bridge di background sekarang...
wscript.exe "%VBS_STARTUP%"
echo [OK] Bridge sudah aktif berjalan di latar belakang!
echo.
pause
