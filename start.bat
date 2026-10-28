@echo off
title Negi - PF Card Cutter
cd /d "%~dp0"
if not exist "server.js" (
  echo.
  echo   Negi's files are not in this folder.
  echo   Right-click the zip, choose "Extract All...", then run start.bat from the extracted folder.
  echo.
  pause
  exit /b
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Get the LTS version from https://nodejs.org, install it, then run start.bat again.
  echo.
  start "" https://nodejs.org
  pause
  exit /b
)
node server.js
echo.
echo   Negi stopped. Scroll up to see any error message.
pause
