@echo off
title Hapus Sanfa Bridge Auto-Start
echo.
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_FOLDER%\SanfaBridge.vbs"

if exist "%SHORTCUT_PATH%" (
    del /f /q "%SHORTCUT_PATH%" >nul
    echo [SUKSES] Sanfa Bridge berhasil dihapus dari Auto-Start Windows.
) else (
    echo [INFO] Sanfa Bridge belum terdaftar di Auto-Start.
)

echo.
timeout /t 3 >nul
