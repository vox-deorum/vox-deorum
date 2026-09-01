@echo off
setlocal EnableDelayedExpansion

:: Vox Deorum Quick Start Script
:: Downloads Git, clones repository, and runs installation

title Vox Deorum Quick Start

:: Parse an optional release tag, then preserve the remaining install arguments.
set "TAG="
set "INSTALL_ARGS="
if "%~1"=="" goto :collect_install_arguments
set "FIRST_ARGUMENT=%~1"
if "!FIRST_ARGUMENT:~0,2!"=="--" goto :collect_install_arguments
set "TAG=%~1"
shift

:collect_install_arguments
if "%~1"=="" goto :install_arguments_collected
set "INSTALL_ARGS=!INSTALL_ARGS! "%~1""
shift
goto :collect_install_arguments

:install_arguments_collected

:: Configuration
set "REPO_URL=https://github.com/CIVITAS-John/vox-deorum.git"
set "RELEASE_FILE_URL=https://raw.githubusercontent.com/CIVITAS-John/vox-deorum/main/release.txt"
:: Install in a vox-deorum subfolder next to this script
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "INSTALL_DIR=%SCRIPT_DIR%\vox-deorum"
set "TEMP_DIR=%TEMP%\VoxDeorumQuickStart"
set "GIT_VERSION=2.51.0"

:: Color codes removed - not reliably supported

:: Fetch release tag if not provided
if "%TAG%"=="" (
    echo Fetching latest release tag from GitHub...
    :: Direct curl approach - most reliable
    curl -s https://raw.githubusercontent.com/CIVITAS-John/vox-deorum/main/release.txt > "%TEMP%\vox_tag.txt" 2>nul
    if exist "%TEMP%\vox_tag.txt" (
        set /p TAG=<"%TEMP%\vox_tag.txt"
        del "%TEMP%\vox_tag.txt" >nul 2>&1
    )
)
if not "!TAG!"=="" (
    echo [OK] Using release tag: !TAG!
)

:: Banner
echo.
echo ============================================
echo       Vox Deorum Quick Start Script
echo ============================================
echo.
echo Release Tag: %TAG%
echo.
echo This script will:
echo   1. Install Git for Windows (if needed)
echo   2. Clone the Vox Deorum repository (tag: %TAG%)
echo   3. Initialize submodules
echo   4. Run the installation script
echo.

:: Create temp directory
if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"

:: Check for Git and Git LFS
echo [1/4] Checking for Git and Git LFS...
set "NEED_INSTALL=0"

where git >nul 2>&1
if %errorlevel% neq 0 (
    echo   Git not found. Installing Git for Windows...
    set "NEED_INSTALL=1"
    goto :InstallGit
)

echo   Git is installed, checking for LFS support...
for /f "delims=" %%i in ('git --version') do echo     %%i

:: Check if Git LFS is available
git lfs version >nul 2>&1
if %errorlevel% neq 0 (
    echo   [WARN] Git is installed but LFS is missing
    echo   Reinstalling Git for Windows to ensure LFS support...
    set "NEED_INSTALL=1"
    goto :InstallGit
)

echo   [OK] Git and Git LFS are already installed
:: Initialize Git LFS if needed
git lfs install >nul 2>&1
goto :CloneRepo

:InstallGit

:: Download and install Git for Windows
echo   Downloading Git for Windows...
set "GIT_INSTALLER=%TEMP_DIR%\Git-%GIT_VERSION%-64-bit.exe"
set "GIT_URL=https://github.com/git-for-windows/git/releases/download/v%GIT_VERSION%.windows.1/Git-%GIT_VERSION%-64-bit.exe"

:: Try curl first (usually faster and more reliable)
where curl >nul 2>&1
if %errorlevel% equ 0 (
    echo   Using curl to download Git installer...
    curl -L -o "%GIT_INSTALLER%" "%GIT_URL%"
) else (
    :: Fall back to PowerShell if curl not available
    echo   Curl not found, using PowerShell to download Git installer...
    powershell -Command "& { try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%GIT_URL%' -OutFile '%GIT_INSTALLER%' -UseBasicParsing } catch { exit 1 } }"
)

if not exist "%GIT_INSTALLER%" (
    echo   [FAIL] Failed to download Git installer
    echo.
    echo   Please install Git manually from: https://git-scm.com/download/win
    echo   Then run this script again.
    pause
    exit /b 1
)

echo   Running Git installer...
"%GIT_INSTALLER%" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="gitlfs,icons,ext\reg\shellhere,assoc,assoc_sh"

if %errorlevel% neq 0 (
    echo   [WARN] Git installation may have failed
    echo   If Git is not installed, please install manually and run this script again.
    pause
)

:RefreshPath
:: Refresh PATH to include Git
echo   Refreshing system PATH...
for /f "delims=" %%i in ('powershell -Command "[System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')"') do set "PATH=%%i"

:: Verify Git is now available
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo   [FAIL] Git still not found in PATH
    echo   You may need to:
    echo   1. Close this window
    echo   2. Open a new command prompt
    echo   3. Run this script again
    pause
    exit /b 1
)

echo   [OK] Git installed successfully
:CloneRepo
:: Check if installation directory already exists
echo.
echo [2/4] Cloning repository...
if exist "%INSTALL_DIR%" (
    echo   [INFO] Installation directory already exists: %INSTALL_DIR%
    cd /d "%INSTALL_DIR%"

    :: Check if it's a git repository
    git rev-parse --git-dir >nul 2>&1
    if %errorlevel% equ 0 (
        echo   Updating existing repository...

        :: Simple force update - user configs are not tracked by git
        echo   Fetching latest changes...
        git fetch --depth 1 --force origin tag "%TAG%"

        echo   Updating to tag %TAG%...
        git reset --hard "%TAG%"
        if %errorlevel% neq 0 (
            echo   [WARN] Shallow update failed. Trying full fetch...
            git fetch --unshallow 2>nul
            git reset --hard "%TAG%"
            if %errorlevel% neq 0 (
                echo   [WARN] Update failed. Continuing with existing version...
            )
        )

        echo   [OK] Repository updated successfully
        goto :InitSubmodules
    ) else (
        echo   [FAIL] Directory exists but is not a Git repository
        echo   Please delete or rename: %INSTALL_DIR%
        pause
        exit /b 1
    )
)

:: Clone the repository (shallow clone for faster download)
echo   Cloning from: %REPO_URL%
echo   Tag: %TAG%
echo   Destination: %INSTALL_DIR%
echo   Using shallow clone for faster download...
git clone --depth 1 --branch "%TAG%" "%REPO_URL%" "%INSTALL_DIR%"

if %errorlevel% neq 0 (
    echo   [FAIL] Failed to clone repository.
    echo   Please check:
    echo   1. Internet connection
    echo   2. Repository URL is correct: %REPO_URL%
    echo   3. You have access to the repository.
    echo   You can manually clone with:
    echo   git clone %REPO_URL% %INSTALL_DIR%
    pause
    exit /b 1
)

echo   [OK] Repository cloned successfully
cd /d "%INSTALL_DIR%"

:InitSubmodules
:: Initialize and update submodules
echo.
echo [3/4] Initializing submodules...

:: Initialize submodules
git submodule init
if %errorlevel% neq 0 (
    echo   [WARN] Failed to initialize submodules
)

:: Initialize Git LFS (Git for Windows includes LFS)
echo   Initializing Git LFS...
git lfs install
if %errorlevel% neq 0 (
    echo   [WARN] Failed to initialize Git LFS. Prebuilt DLLs may not download correctly.
) else (
    echo   [OK] Git LFS initialized
)

:: Force update submodules with shallow clone for faster download
echo   Downloading submodule content (this may take a few minutes)...
:: Use force to ensure we get the latest commits referenced by the main repo
git submodule update --init --recursive --depth 1 --force
if %errorlevel% neq 0 (
    echo   [WARN] Some submodules may have failed with shallow clone
    echo   Attempting full submodule update...
    :: Try without depth limitation if shallow fails
    git submodule update --init --recursive --force
    if %errorlevel% neq 0 (
        echo   [WARN] Some submodules may have failed to download
        echo   You can manually update them later with:
        echo   git submodule update --init --recursive --force
    )
) else (
    echo   [OK] Submodules initialized

    :: Pull LFS files for prebuilt DLLs
    echo   Downloading prebuilt DLL files via Git LFS...
    git lfs pull
    if %errorlevel% neq 0 (
        echo   [WARN] Failed to download LFS files. You may need to build DLLs manually.
    ) else (
        echo   [OK] Prebuilt DLLs downloaded
    )
)

:: Run installation script
echo.
echo [4/4] Running installation script...
set "INSTALL_SCRIPT=%INSTALL_DIR%\scripts\install.cmd"
if not exist "%INSTALL_SCRIPT%" (
    echo   [FAIL] Installation script not found at:
    echo   %INSTALL_SCRIPT%
    echo.
    echo   Repository structure may be incorrect.
    pause
    exit /b 1
)

echo.
echo ============================================
echo    Starting Vox Deorum Installation...
echo ============================================
echo.

:: Run the installation script with the supplied install arguments.
call "%INSTALL_SCRIPT%" %INSTALL_ARGS%
set "INSTALL_RESULT=!errorlevel!"

:: Check if installation was successful
if "!INSTALL_RESULT!"=="0" (
    echo.
    echo ============================================
    echo       Quick Start Completed Successfully!
    echo ============================================
    echo.
    echo Repository location: %INSTALL_DIR%
) else (
    echo.
    echo ============================================
    echo     Quick Start Completed with Warnings
    echo ============================================
    echo.
    echo Some components may need manual configuration.
    echo Repository location: %INSTALL_DIR%
)

:: Cleanup
echo.
echo Cleaning up temporary files...
if exist "%TEMP_DIR%" (
    rd /s /q "%TEMP_DIR%" 2>nul
)

:: Create desktop shortcut to repository
echo.
choice /C YN /M "Create desktop shortcut to Vox Deorum folder?"
if errorlevel 2 goto skip_shortcut
powershell -Command "& { $ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%USERPROFILE%\Desktop\Vox Deorum.lnk'); $s.TargetPath = '%INSTALL_DIR%\scripts\'; $s.IconLocation = '%SystemRoot%\System32\shell32.dll,3'; $s.Save() }"
echo   [OK] Desktop shortcut created
:skip_shortcut

echo.
pause
exit /b !INSTALL_RESULT!
