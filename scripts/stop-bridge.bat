@echo off
title Hentikan Sanfa Bridge Background
echo.
echo  Menghentikan Sanfa Bridge...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*sanfa-bridge.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('[OK] Berhasil menghentikan process ID: ' + $_.ProcessId) }"
echo.
echo  Sanfa Bridge telah dihentikan.
timeout /t 3 >nul
