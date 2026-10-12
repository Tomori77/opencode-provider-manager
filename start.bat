@echo off
setlocal
cd /d "%~dp0"
echo Starting opencode provider tool...
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH. Please install Node.js 18+ first.
  echo         Download: https://nodejs.org
  pause
  exit /b 1
)
echo Opening http://127.0.0.1:3456 ...
start "" http://127.0.0.1:3456
echo.
node server.js
echo.
echo Server stopped.
pause
