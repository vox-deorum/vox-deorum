@echo off
setlocal EnableDelayedExpansion

:: Download DLL Script - Downloads prebuilt DLLs from GitHub releases
:: Uses caching to avoid re-downloading if release tag hasn't changed

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "RELEASE_INFO=%SCRIPT_DIR%\dll-release-info.txt"
set "CACHE_DIR=%SCRIPT_DIR%\.dll-cache"
set "TEMP_DIR=%TEMP%\VoxDeorumDLL"

:: Parse arguments
set "BUILD_MODE=release"
if "%~1"=="--debug" set "BUILD_MODE=debug"

:: Check if release info file exists
if not exist "%RELEASE_INFO%" (
    echo Error: Release info file not found at:
    echo   %RELEASE_INFO%
    echo.
    echo Please ensure the repository is up to date.
    exit /b 1
)

:: Read release info
for /f "tokens=1,2 delims==" %%a in ('type "%RELEASE_INFO%"') do (
    if "%%a"=="RELEASE_TAG" set "RELEASE_TAG=%%b"
    if "%%a"=="COMMIT" set "COMMIT=%%b"
    if "%%a"=="REPO" set "REPO=%%b"
)

:: Trim whitespace from variables
for /f "tokens=* delims= " %%a in ("%RELEASE_TAG%") do set "RELEASE_TAG=%%a"
for /f "tokens=* delims= " %%a in ("%COMMIT%") do set "COMMIT=%%a"
for /f "tokens=* delims= " %%a in ("%REPO%") do set "REPO=%%a"

echo.
echo =========================================
echo   Vox Deorum DLL Download
echo =========================================
echo.
echo Release Tag: %RELEASE_TAG%
echo Commit: %COMMIT%
echo Repository: %REPO%
echo Build Mode: %BUILD_MODE%
echo.

:: Set output directories
set "OUTPUT_DIR=%SCRIPT_DIR%\%BUILD_MODE%"
set "CACHE_TAG_FILE=%CACHE_DIR%\%BUILD_MODE%-tag.txt"

:: Create directories
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%"
if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"

:: Check cache - if tag matches, skip download
if exist "%CACHE_TAG_FILE%" (
    set /p CACHED_TAG=<"%CACHE_TAG_FILE%"
    if "!CACHED_TAG!"=="%RELEASE_TAG%" (
        echo [CACHE] Release tag matches cached version
        if exist "%OUTPUT_DIR%\CvGameCore_Expansion2.dll" (
            set "CACHE_METADATA_READY=0"
            if exist "%CACHE_DIR%\version.txt" if exist "%CACHE_DIR%\release-tag.txt" set "CACHE_METADATA_READY=1"
            if "!CACHE_METADATA_READY!"=="1" (
                echo [CACHE] DLL already downloaded and up to date
                echo [OK] Using cached DLLs from %OUTPUT_DIR%
                exit /b 0
            ) else (
                echo [CACHE] DLL is cached but version metadata is missing, refreshing...
            )
        ) else (
            echo [CACHE] Tag matches but DLL missing, re-downloading...
        )
    ) else (
        echo [CACHE] Release tag changed from !CACHED_TAG! to %RELEASE_TAG%
        echo [CACHE] Will download new version...
    )
)

:: Download release artifacts using GitHub CLI or curl
echo [1/3] Downloading release artifacts...

:: Set file names based on build mode
if "%BUILD_MODE%"=="debug" (
    set "DLL_NAME=CvGameCore_Expansion2-Debug.dll"
    set "PDB_NAME=CvGameCore_Expansion2-Debug.pdb"
) else (
    set "DLL_NAME=CvGameCore_Expansion2-Release.dll"
    set "PDB_NAME=CvGameCore_Expansion2-Release.pdb"
)
set "VERSION_NAME=version.txt"
if exist "%TEMP_DIR%\%VERSION_NAME%" del "%TEMP_DIR%\%VERSION_NAME%"

:: Try using gh CLI first
where gh >nul 2>&1
if !errorlevel! equ 0 (
    echo   Using GitHub CLI to download release assets...

    gh release download "%RELEASE_TAG%" ^
        --repo "%REPO%" ^
        --pattern "%DLL_NAME%" ^
        --pattern "%PDB_NAME%" ^
        --dir "%TEMP_DIR%" ^
        --clobber

    if !errorlevel! equ 0 (
        gh release download "%RELEASE_TAG%" ^
            --repo "%REPO%" ^
            --pattern "%VERSION_NAME%" ^
            --dir "%TEMP_DIR%" ^
            --clobber >nul 2>&1
        if !errorlevel! neq 0 (
            echo   [WARN] Failed to download %VERSION_NAME% (VP version metadata)
        )
        echo   [OK] Downloaded via GitHub CLI
        goto :copy_files
    ) else (
        echo   [WARN] GitHub CLI download failed, trying direct download...
    )
)

:: Fallback to direct download via curl
echo   Using direct download...
set "RELEASE_URL=https://github.com/%REPO%/releases/download/%RELEASE_TAG%"

echo   Downloading %DLL_NAME%...
curl -f -L -o "%TEMP_DIR%\%DLL_NAME%" "%RELEASE_URL%/%DLL_NAME%"
if !errorlevel! neq 0 (
    echo   Error: Failed to download %DLL_NAME%
    exit /b 1
)

echo   Downloading %PDB_NAME%...
curl -f -L -o "%TEMP_DIR%\%PDB_NAME%" "%RELEASE_URL%/%PDB_NAME%"
if !errorlevel! neq 0 (
    echo   [WARN] Failed to download %PDB_NAME% (debug symbols)
)

echo   Downloading %VERSION_NAME%...
curl -f -L -o "%TEMP_DIR%\%VERSION_NAME%" "%RELEASE_URL%/%VERSION_NAME%"
if !errorlevel! neq 0 (
    echo   [WARN] Failed to download %VERSION_NAME% (VP version metadata)
)

:copy_files
:: Copy files to output directory with correct names
echo.
echo [2/3] Installing DLL files...

if exist "%TEMP_DIR%\%DLL_NAME%" (
    copy /Y "%TEMP_DIR%\%DLL_NAME%" "%OUTPUT_DIR%\CvGameCore_Expansion2.dll" >nul 2>&1
    if !errorlevel! equ 0 (
        echo   [OK] Installed CvGameCore_Expansion2.dll
    ) else (
        echo   [ERROR] Failed to copy DLL
        exit /b 1
    )
) else (
    echo   [ERROR] DLL file not found in temp directory
    exit /b 1
)

if exist "%TEMP_DIR%\%PDB_NAME%" (
    copy /Y "%TEMP_DIR%\%PDB_NAME%" "%OUTPUT_DIR%\CvGameCore_Expansion2.pdb" >nul 2>&1
    if !errorlevel! equ 0 (
        echo   [OK] Installed debug symbols (PDB)
    ) else (
        echo   [WARN] Failed to copy PDB file
    )
)

if exist "%TEMP_DIR%\%VERSION_NAME%" (
    copy /Y "%TEMP_DIR%\%VERSION_NAME%" "%CACHE_DIR%\version.txt" >nul 2>&1
    if !errorlevel! equ 0 (
        echo   [OK] Cached VP version metadata
    ) else (
        echo   [WARN] Failed to cache VP version metadata
    )
) else (
    echo   [WARN] VP version metadata not found in release assets
)

:: Update cache tag
echo.
echo [3/3] Updating cache...
echo %RELEASE_TAG%>"%CACHE_TAG_FILE%"
echo %RELEASE_TAG%>"%CACHE_DIR%\release-tag.txt"
echo   [OK] Cache updated

:: Cleanup
if exist "%TEMP_DIR%\%DLL_NAME%" del "%TEMP_DIR%\%DLL_NAME%"
if exist "%TEMP_DIR%\%PDB_NAME%" del "%TEMP_DIR%\%PDB_NAME%"
if exist "%TEMP_DIR%\%VERSION_NAME%" del "%TEMP_DIR%\%VERSION_NAME%"

echo.
echo =========================================
echo   Download Complete!
echo =========================================
echo   DLL: %OUTPUT_DIR%\CvGameCore_Expansion2.dll
if exist "%OUTPUT_DIR%\CvGameCore_Expansion2.pdb" (
    echo   PDB: %OUTPUT_DIR%\CvGameCore_Expansion2.pdb
)
echo =========================================
echo.

exit /b 0
