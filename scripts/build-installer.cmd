@echo off
setlocal EnableDelayedExpansion

:: Vox Deorum Installer Build Script
:: Prepares all files and builds the Inno Setup installer

title Building Vox Deorum Installer

echo.
echo =========================================
echo     Vox Deorum Installer Builder
echo =========================================
echo.

set "PROJECT_ROOT=%~dp0.."

:: Step 1: Download portable Node.js if not present
echo [1/6] Checking for portable Node.js...
if not exist "%PROJECT_ROOT%\node" (
    echo   Downloading portable Node.js v22.12.0...
    mkdir "%PROJECT_ROOT%\node" 2>nul

    :: Download Node.js
    set "NODE_ZIP=%TEMP%\node-v22.12.0-win-x64.zip"
    curl -L -o "!NODE_ZIP!" "https://nodejs.org/dist/v22.12.0/node-v22.12.0-win-x64.zip"

    if exist "!NODE_ZIP!" (
        echo   Extracting Node.js...
        powershell -Command "Expand-Archive -Path '!NODE_ZIP!' -DestinationPath '%TEMP%\node-extract' -Force"

        :: Move extracted files
        if exist "%TEMP%\node-extract\node-v22.12.0-win-x64" (
            xcopy /E /I /Y "%TEMP%\node-extract\node-v22.12.0-win-x64\*" "%PROJECT_ROOT%\node\" >nul 2>&1
            rmdir /S /Q "%TEMP%\node-extract" 2>nul
            del "!NODE_ZIP!" 2>nul
            echo   [OK] Portable Node.js downloaded
        ) else (
            echo   [ERROR] Failed to extract Node.js
            exit /b 1
        )
    ) else (
        echo   [ERROR] Failed to download Node.js
        echo   Please download manually from:
        echo   https://nodejs.org/dist/v22.12.0/node-v22.12.0-win-x64.zip
        echo   And extract to: %PROJECT_ROOT%\node\
        exit /b 1
    )
) else (
    echo   [OK] Portable Node.js found
)

:: Step 2: Install ALL npm dependencies (including dev) for compilation
echo.
echo [2/6] Installing all dependencies...
set "PATH=%PROJECT_ROOT%\node;%PATH%"

:: Install all dependencies using workspaces from root package.json
if exist "%PROJECT_ROOT%\package.json" (
    echo   Installing all dependencies via npm workspaces...
    pushd "%PROJECT_ROOT%"
    call npm install --include=dev
    if !errorlevel! neq 0 (
        echo   [ERROR] Dependency installation failed
        pause
        exit /b 1
    )
    echo   [OK] All workspace dependencies installed

    :: Install vox-agents/ui dependencies
    echo   Installing vox-agents/ui dependencies...
    cd vox-agents\ui
    call npm install --include=dev
    if !errorlevel! neq 0 (
        echo   [ERROR] vox-agents/ui dependency installation failed
        pause
        exit /b 1
    )
    echo   [OK] vox-agents/ui dependencies installed
    cd ..\..
    popd
)

:: Step 3: Build all TypeScript projects
echo.
echo [3/6] Building TypeScript projects...
pushd "%PROJECT_ROOT%"
call npm run build:all
if !errorlevel! neq 0 (
    echo   [ERROR] Build failed
    pause
    exit /b 1
)
echo   [OK] All projects built

:: Prune to production dependencies after build
echo   Pruning to production dependencies...
call npm install --omit=dev
call npm prune --omit=dev
echo   [OK] Production dependencies ready
popd

:: Step 4: Download pre-built DLLs if needed
echo.
echo [4/6] Checking pre-built DLLs...
if not exist "%PROJECT_ROOT%\scripts\release\CvGameCore_Expansion2.dll" (
    echo   Downloading pre-built DLLs...
    call "%PROJECT_ROOT%\scripts\download-dll.cmd"
    if not exist "%PROJECT_ROOT%\scripts\release\CvGameCore_Expansion2.dll" (
        echo   [ERROR] Pre-built DLL is missing and could not be downloaded.
        echo   The installer requires scripts\release\CvGameCore_Expansion2.dll.
        exit /b 1
    )
    echo   [OK] Pre-built DLLs ready
) else (
    echo   [OK] Pre-built DLLs found
)

:: Step 5: Create dist directory
echo.
echo [5/6] Preparing output directory...
if not exist "%PROJECT_ROOT%\dist" (
    mkdir "%PROJECT_ROOT%\dist"
)
echo   [OK] Output directory ready

:: Step 6: Check for Inno Setup and build installer
echo.
echo [6/6] Building installer...

:: Common Inno Setup locations
set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" (
    set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
) else if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" (
    set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
) else if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)

if "!ISCC!"=="" (
    echo   [ERROR] Inno Setup 6 not found!
    echo.
    echo   Please install Inno Setup 6 from:
    echo   https://jrsoftware.org/isdl.php
    echo.
    echo   After installation, run this script again.
    pause
    exit /b 1
)

echo   Found Inno Setup at: !ISCC!
echo   Compiling installer...
"!ISCC!" "%PROJECT_ROOT%\scripts\installer.iss"

if !errorlevel! equ 0 (
    echo   [OK] Installer built successfully!
    echo.

    :: Read version from release.txt
    set /p VERSION=<"%PROJECT_ROOT%\release.txt"
    set VERSION=!VERSION:v=!

    echo =========================================
    echo         Build Complete!
    echo =========================================
    echo.
    echo   Installer created at:
    echo   %PROJECT_ROOT%\dist\VoxDeorum-!VERSION!.exe
    echo.
    echo   You can now distribute this installer to users.
    echo   It includes everything needed to run Vox Deorum.
) else (
    echo   [ERROR] Failed to build installer
    echo   Check the error messages above.
    exit /b 1
)

echo.
pause