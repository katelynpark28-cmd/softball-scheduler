@echo off
REM Brown Softball Scheduler — one-click launcher
REM Double-click this file to open the app in your browser.
REM Leave the CMD window open while you use the app. Close it to stop the server.

cd /d "%~dp0"

echo.
echo  Brown Softball Scheduler
echo  ------------------------
echo  Opening http://localhost:5173/signin.html ...
echo.

start "" "http://localhost:5173/signin.html"

echo  Starting local server on port 5173.
echo  If you see "EADDRINUSE", a server is already running — that's fine, the browser will reach it.
echo.
echo  Leave this window open. Close it to stop the server.
echo.

npx --yes http-server -p 5173 -c-1 .

echo.
echo  Server stopped. Press any key to close this window.
pause >nul
