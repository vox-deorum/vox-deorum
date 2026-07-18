@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Deploying Vox Deorum Mod to Civ5 MODS
echo ========================================
echo.

REM Get the actual Documents folder path using PowerShell
for /f "usebackq tokens=*" %%i in (`powershell -Command "[Environment]::GetFolderPath('MyDocuments')"`) do set "DOCUMENTS=%%i"

REM Construct the destination path
set "DEST_DIR=%DOCUMENTS%\My Games\Sid Meier's Civilization 5\MODS\(1b) Vox Deorum"
set "SOURCE_DIR=%~dp0"

REM Remove trailing backslash from SOURCE_DIR if present
if "%SOURCE_DIR:~-1%"=="\" set "SOURCE_DIR=%SOURCE_DIR:~0,-1%"

echo Source: "%SOURCE_DIR%"
echo Destination: "%DEST_DIR%"
echo.

REM Create destination directory if it doesn't exist
if not exist "%DEST_DIR%" (
    echo Creating directory: "%DEST_DIR%"
    mkdir "%DEST_DIR%" 2>nul
    if !ERRORLEVEL! neq 0 (
        echo Error: Failed to create destination directory
        exit /b 1
    )
)

echo Copying mod files...
echo.

REM Copy all directories (Lua, SQL, XML)
for /d %%D in ("%SOURCE_DIR%\*") do (
    set "DIRNAME=%%~nxD"
    echo Copying directory: !DIRNAME!
    xcopy "%%D" "%DEST_DIR%\!DIRNAME!" /E /Y /I /Q >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo Warning: Failed to copy directory !DIRNAME!
    )
)

REM Copy all files except batch scripts
for %%F in ("%SOURCE_DIR%\*.*") do (
    set "FILENAME=%%~nxF"
    REM Skip batch files
    if /i not "%%~xF"==".bat" (
        echo Copying file: !FILENAME!
        copy /Y "%%F" "%DEST_DIR%\" >nul 2>&1
        if !ERRORLEVEL! neq 0 (
            echo Warning: Failed to copy file !FILENAME!
        )
    )
)

echo.
echo ========================================
echo Deployment Complete!
echo ========================================
echo.
echo Mod installed to:
echo "%DEST_DIR%"
echo.
echo You can now:
echo 1. Launch Civilization V
echo 2. Go to MODS menu
echo 3. Enable "(5) Vox Deorum"
echo.