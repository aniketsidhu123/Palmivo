@echo off
setlocal
cd /d "%~dp0"
if exist "runtime\node.exe" (
  "runtime\node.exe" scripts\serve.mjs --open
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js is missing. Use the packaged release with the runtime folder.
    pause
    exit /b 1
  )
  node scripts\serve.mjs --open
)
pause
