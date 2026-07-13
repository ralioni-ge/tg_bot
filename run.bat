@echo off
REM Telegram Bookmark Manager - Windows Startup Script
REM This script sets up the environment and starts the server

echo ============================================
echo   Telegram Bookmark Manager - Startup
echo ============================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.8+ from https://python.org
    pause
    exit /b 1
)

echo [1/5] Python found...

REM Check if .env file exists
if not exist ".env" (
    echo WARNING: .env file not found
    echo Please create a .env file with your Telegram API credentials
    echo Copy .env.example to .env and edit it
    pause
    exit /b 1
)

echo [2/5] Configuration file found...

REM Create virtual environment if it doesn't exist
if not exist "venv" (
    echo [3/5] Creating virtual environment...
    python -m venv venv
) else (
    echo [3/5] Virtual environment already exists...
)

REM Activate virtual environment
echo [4/5] Activating virtual environment...
call venv\Scripts\activate.bat

REM Install dependencies
echo [5/5] Installing/updating dependencies...
pip install -r backend\requirements.txt

echo.
echo ============================================
echo   Starting Server...
echo ============================================
echo.
echo Open your browser at: http://127.0.0.1:8000
echo.
echo Press Ctrl+C to stop the server
echo.

REM Start the server
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

pause
