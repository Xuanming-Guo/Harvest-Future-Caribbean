@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0_launch-harvest.ps1" -Target control-room
if errorlevel 1 (
  pause
  exit /b 1
)
