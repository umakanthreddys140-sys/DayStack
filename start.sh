#!/usr/bin/env bash
# DAYSTACK Local Startup Script for macOS & Linux

echo "========================================================"
echo "  🚀 Starting DAYSTACK Local Server..."
echo "========================================================"
echo ""

if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed or not found in your PATH."
    echo "Please install Node.js from https://nodejs.org/ to run DAYSTACK."
    exit 1
fi

PORT=3000
echo "Opening browser at http://localhost:${PORT} ..."

# Attempt to open browser based on OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "http://localhost:${PORT}" &
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if command -v xdg-open &> /dev/null; then
        xdg-open "http://localhost:${PORT}" &
    fi
fi

node server.js
