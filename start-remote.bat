@echo off
title DAYSTACK Remote Access Launcher
color 0b
cls
echo ======================================================
echo           DAYSTACK Remote Mobile Access
echo ======================================================
echo.
echo Starting DAYSTACK Server...
start "" node server.js
timeout /t 2 >nul
cls
echo ======================================================
echo           DAYSTACK Remote Mobile Access
echo ======================================================
echo.
echo [1] On Same Home Wi-Fi:
echo     Open on Phone: http://10.35.187.28:3000
echo.
echo [2] Outside / At College (4G or College Wi-Fi):
echo     Creating your secure remote link...
echo.
echo ------------------------------------------------------
echo Press Ctrl+C anytime to stop.
echo ------------------------------------------------------
echo.
ssh -R 80:localhost:3000 a.pinggy.io
pause
