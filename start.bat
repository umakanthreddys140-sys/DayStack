@echo off
title DAYSTACK — Student Productivity & Day Tracker
echo ========================================================
echo   🚀 Starting DAYSTACK Local Server...
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not detected in your PATH.
    echo Please install Node.js from https://nodejs.org/ to run DAYSTACK.
    echo.
    pause
    exit /b 1
)

echo Starting server on http://localhost:3000 ...
start "" http://localhost:3000
node server.js
pause
