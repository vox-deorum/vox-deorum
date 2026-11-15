@echo off
setlocal DisableDelayedExpansion
REM Clean up raw DLL captures in Documents.
echo Cleaning up VoxDeorumRL capture files...

REM Use the actual Documents folder, including OneDrive or redirected locations.
set "RL_DATA="
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('MyDocuments')"`) do set "RL_DATA=%%i\My Games\Sid Meier's Civilization 5\VoxDeorumRL"
if not defined RL_DATA echo Could not locate Documents. Skipping VoxDeorumRL cleanup.

where recycle >nul 2>&1
if %errorlevel% equ 0 (
    if defined RL_DATA if exist "%RL_DATA%" recycle /s /q "%RL_DATA%\*.*"
) else (
    echo recycle is not installed. Deleting permanently instead of sending to the Recycle Bin.
    echo These files will not be recoverable.
    if defined RL_DATA if exist "%RL_DATA%" del /s /q "%RL_DATA%\*.*"
)

echo Capture cleanup finished.
