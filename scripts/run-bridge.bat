@echo off
title Sanfa Bridge - Local Agent Connector
cd /d "%~dp0"
echo =======================================================
echo          SANFA BRIDGE - LOCAL AGENT CONNECTOR
echo =======================================================

echo Memeriksa file script bridge...
if not exist "sanfa-bridge.mjs" (
    echo [INFO] Mengunduh sanfa-bridge.mjs dari server...
    curl.exe -s -o sanfa-bridge.mjs https://sanfaagent.my.id/scripts/sanfa-bridge.mjs
)

echo Memeriksa instalasi Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js belum terinstall di laptop ini!
    echo Silakan install Node.js dari https://nodejs.org terlebih dahulu.
    echo Atau jalankan: winget install OpenJS.NodeJS.LTS
    pause
    exit /b 1
)

node sanfa-bridge.mjs
pause
