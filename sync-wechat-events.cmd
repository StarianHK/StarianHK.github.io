@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

title WeChat Events Sync
echo Preparing WeChat sync...

if not exist "node_modules\playwright-core\package.json" (
  echo Installing frontend dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

if not exist "node_modules\hugo-bin\vendor\hugo.exe" (
  echo Installing Hugo...
  call node node_modules\hugo-bin\lib\install.js
  if errorlevel 1 goto :fail
)

call node scripts\sync-wechat-events.mjs --push
if errorlevel 1 goto :fail

echo.
echo Completed.
pause
exit /b 0

:fail
echo.
echo Sync failed. Check the messages above.
pause
exit /b 1
