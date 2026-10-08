@echo off
title BIG BITES Server
cd /d "%~dp0"

set "START_SCRIPT=%~dp0Start-BigBitesServer.ps1"

if not exist "%START_SCRIPT%" (
  echo BIG BITES POS startup script not found: %START_SCRIPT%
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%START_SCRIPT%"

exit /b 0