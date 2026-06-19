@echo off
cd /d "%~dp0"

if not exist "node_modules\next\dist\bin\next" (
  echo [EventLifter] node_modules missing. Run once: npm install
  pause
  exit /b 1
)

if not exist ".next\BUILD_ID" (
  echo [EventLifter] No build found. Building once...
  call npm run build
  if errorlevel 1 exit /b 1
)

set NODE_ENV=production
set PORT=3000
set HOSTNAME=127.0.0.1

echo [EventLifter] Starting on http://127.0.0.1:%PORT%  (open https://eventlifter-core.test/)
node node_modules\next\dist\bin\next start -p %PORT%
