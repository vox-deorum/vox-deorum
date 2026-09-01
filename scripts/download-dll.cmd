@echo off
setlocal EnableExtensions EnableDelayedExpansion

:: Download a pinned Vox Populi DLL release and materialize it for the installer.

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "SCRIPT_NAME=%~nx0"
set "LINES_FILE=%SCRIPT_DIR%\vp-lines.txt"
set "CACHE_DIR=%SCRIPT_DIR%\.dll-cache"
set "TEMP_ROOT=%TEMP%\VoxDeorumDLL"
set "BUILD_MODE=release"
set "SELECTED_LINE="

:parse_arguments
if "%~1"=="" goto :arguments_complete

if /i "%~1"=="--line" (
    set "NEXT_ARGUMENT=%~2"
    if not defined NEXT_ARGUMENT goto :line_value_required
    if "!NEXT_ARGUMENT:~0,2!"=="--" goto :line_value_required
    set "SELECTED_LINE=!NEXT_ARGUMENT!"
    shift
    shift
    goto :parse_arguments
)

if /i "%~1"=="--debug" (
    set "BUILD_MODE=debug"
    shift
    goto :parse_arguments
)

set "UNKNOWN_ARGUMENT=%~1"
echo Error: Unknown argument "!UNKNOWN_ARGUMENT!".
echo Usage: !SCRIPT_NAME! [--line X.Y] [--debug]
exit /b 1

:line_value_required
echo Error: --line requires a value such as 5.2.
echo Usage: !SCRIPT_NAME! [--line X.Y] [--debug]
exit /b 1

:arguments_complete
if not exist "%LINES_FILE%" (
    echo Error: Supported line records not found at:
    echo   %LINES_FILE%
    exit /b 1
)

set "DEFAULT_LINE="
set "LINES="
for /f "usebackq eol=; tokens=1,* delims==" %%A in ("%LINES_FILE%") do (
    if "%%A"=="DEFAULT_LINE" set "DEFAULT_LINE=%%B"
    if "%%A"=="LINES" set "LINES=%%B"
)
if not defined DEFAULT_LINE (
    echo Error: %LINES_FILE% must define DEFAULT_LINE.
    exit /b 1
)
if not defined LINES (
    echo Error: %LINES_FILE% must define LINES.
    exit /b 1
)
if not defined SELECTED_LINE set "SELECTED_LINE=!DEFAULT_LINE!"

:: Match a repository-controlled line before passing it through a percent-expanded pipe.
set "LINE_LISTED=0"
for %%L in (!LINES!) do if "%%L"=="!SELECTED_LINE!" (
    set "SELECTED_LINE=%%L"
    set "LINE_LISTED=1"
)
if "!LINE_LISTED!"=="0" (
    echo Error: VP line !SELECTED_LINE! is not listed in %LINES_FILE%.
    exit /b 1
)

echo(%SELECTED_LINE%| findstr /r /x /c:"[0-9][0-9]*\.[0-9][0-9]*" >nul
if errorlevel 1 (
    echo Error: Invalid VP line "!SELECTED_LINE!". Use X.Y, for example 5.2.
    exit /b 1
)

set "RELEASE_INFO=%SCRIPT_DIR%\dll-release-info-!SELECTED_LINE!.txt"
if not exist "!RELEASE_INFO!" (
    echo Error: Release pin not found at:
    echo   !RELEASE_INFO!
    exit /b 1
)

set "RELEASE_TAG="
set "COMMIT="
for /f "usebackq eol=; tokens=1,* delims==" %%A in ("!RELEASE_INFO!") do (
    if "%%A"=="RELEASE_TAG" set "RELEASE_TAG=%%B"
    if "%%A"=="COMMIT" set "COMMIT=%%B"
)
if not defined RELEASE_TAG (
    echo Error: !RELEASE_INFO! must define RELEASE_TAG.
    exit /b 1
)
if not defined COMMIT (
    echo Error: !RELEASE_INFO! must define COMMIT.
    exit /b 1
)

set "REPO=CIVITAS-John/vox-populi"
set "BRANCH=vox-deorum-!SELECTED_LINE!"
set "OUTPUT_DIR=%SCRIPT_DIR%\!BUILD_MODE!"
set "LINE_CACHE_DIR=%CACHE_DIR%\!SELECTED_LINE!"
set "CACHE_MODE_DIR=!LINE_CACHE_DIR!\!BUILD_MODE!"
set "CACHE_DLL=!CACHE_MODE_DIR!\CvGameCore_Expansion2.dll"
set "CACHE_PDB=!CACHE_MODE_DIR!\CvGameCore_Expansion2.pdb"
set "CACHE_VERSION=!CACHE_MODE_DIR!\version.txt"
set "CACHE_TAG=!CACHE_MODE_DIR!\release-tag.txt"
set "TEMP_DIR=%TEMP_ROOT%\!SELECTED_LINE!\!BUILD_MODE!"

if "!BUILD_MODE!"=="debug" (
    set "DLL_NAME=CvGameCore_Expansion2-Debug.dll"
    set "PDB_NAME=CvGameCore_Expansion2-Debug.pdb"
) else (
    set "DLL_NAME=CvGameCore_Expansion2-Release.dll"
    set "PDB_NAME=CvGameCore_Expansion2-Release.pdb"
)
set "TEMP_DLL=!TEMP_DIR!\!DLL_NAME!"
set "TEMP_PDB=!TEMP_DIR!\!PDB_NAME!"
set "TEMP_VERSION=!TEMP_DIR!\version.txt"
set "OUTPUT_DLL=!OUTPUT_DIR!\CvGameCore_Expansion2.dll"
set "OUTPUT_PDB=!OUTPUT_DIR!\CvGameCore_Expansion2.pdb"
set "TOP_VERSION=!CACHE_DIR!\version.txt"
set "TOP_TAG=!CACHE_DIR!\release-tag.txt"

echo.
echo =========================================
echo   Vox Deorum DLL Download
echo =========================================
echo.
echo VP Line: !SELECTED_LINE!
echo Release Tag: !RELEASE_TAG!
echo Commit: !COMMIT!
echo Repository: !REPO!
echo Branch: !BRANCH!
echo Build Mode: !BUILD_MODE!
echo.

:: A cache is valid only when all required artifacts match the pinned release.
set "CACHE_VALID=0"
call :is_nonempty "!CACHE_DLL!" CACHE_DLL_READY
call :is_nonempty "!CACHE_VERSION!" CACHE_VERSION_READY
call :is_nonempty "!CACHE_TAG!" CACHE_TAG_READY
if "!CACHE_DLL_READY!"=="1" if "!CACHE_VERSION_READY!"=="1" if "!CACHE_TAG_READY!"=="1" (
    set "CACHED_TAG="
    set /p "CACHED_TAG="<"!CACHE_TAG!"
    if "!CACHED_TAG!"=="!RELEASE_TAG!" set "CACHE_VALID=1"
)
if "!CACHE_VALID!"=="1" goto :materialize_cache

if not exist "!TEMP_DIR!" mkdir "!TEMP_DIR!"
if not exist "!TEMP_DIR!" (
    echo Error: Could not create temporary download directory:
    echo   !TEMP_DIR!
    exit /b 1
)
call :clear_temporary_files

echo [1/3] Downloading release artifacts...
where gh >nul 2>&1
if !errorlevel! equ 0 (
    echo   Using GitHub CLI...
    call gh release download "!RELEASE_TAG!" ^
        --repo "!REPO!" ^
        --pattern "!DLL_NAME!" ^
        --pattern "!PDB_NAME!" ^
        --pattern "version.txt" ^
        --dir "!TEMP_DIR!" ^
        --clobber
    set "GH_EXIT_CODE=!errorlevel!"
    call :check_ready
    if "!GH_EXIT_CODE!"=="0" if "!DOWNLOADS_READY!"=="1" goto :replace_cache
    echo   [WARN] GitHub CLI did not provide all required artifacts. Trying direct download...
    call :clear_temporary_files
)

set "RELEASE_URL=https://github.com/!REPO!/releases/download/!RELEASE_TAG!"
echo   Downloading !DLL_NAME!...
curl -f -sS -L -o "!TEMP_DLL!" "!RELEASE_URL!/!DLL_NAME!"
if errorlevel 1 (
    echo Error: Failed to download !DLL_NAME!.
    call :clear_temporary_files
    exit /b 1
)

echo   Downloading !PDB_NAME! if it is available...
curl -f -sS -L -o "!TEMP_PDB!" "!RELEASE_URL!/!PDB_NAME!"
set "PDB_CURL_EXIT_CODE=!errorlevel!"
call :is_nonempty "!TEMP_PDB!" TEMP_PDB_READY
if not "!PDB_CURL_EXIT_CODE!"=="0" goto :pdb_unavailable
if "!TEMP_PDB_READY!"=="0" goto :pdb_unavailable
goto :download_version

:pdb_unavailable
if exist "!TEMP_PDB!" del /q "!TEMP_PDB!" >nul 2>&1
echo   [WARN] No debug symbols for this release.

:download_version
echo   Downloading version.txt...
curl -f -sS -L -o "!TEMP_VERSION!" "!RELEASE_URL!/version.txt"
if errorlevel 1 (
    echo Error: Failed to download required version.txt metadata.
    call :clear_temporary_files
    exit /b 1
)
call :check_ready
if "!DOWNLOADS_READY!"=="0" (
    echo Error: The downloaded release is missing a nonempty DLL or version.txt.
    call :clear_temporary_files
    exit /b 1
)

:replace_cache
echo [2/3] Replacing the !SELECTED_LINE! !BUILD_MODE! cache...
if not exist "!CACHE_MODE_DIR!" mkdir "!CACHE_MODE_DIR!"
if not exist "!CACHE_MODE_DIR!" (
    echo Error: Could not create cache directory:
    echo   !CACHE_MODE_DIR!
    call :clear_temporary_files
    exit /b 1
)

del /q "!CACHE_TAG!" >nul 2>&1
if exist "!CACHE_TAG!" goto :cache_write_failed
copy /Y "!TEMP_DLL!" "!CACHE_DLL!" >nul
if errorlevel 1 goto :cache_write_failed
copy /Y "!TEMP_VERSION!" "!CACHE_VERSION!" >nul
if errorlevel 1 goto :cache_write_failed
call :is_nonempty "!TEMP_PDB!" TEMP_PDB_READY
if "!TEMP_PDB_READY!"=="1" (
    copy /Y "!TEMP_PDB!" "!CACHE_PDB!" >nul
    if errorlevel 1 goto :cache_write_failed
) else (
    del /q "!CACHE_PDB!" >nul 2>&1
    if exist "!CACHE_PDB!" goto :cache_write_failed
)
call :is_nonempty "!CACHE_DLL!" CACHE_DLL_READY
call :is_nonempty "!CACHE_VERSION!" CACHE_VERSION_READY
if "!CACHE_DLL_READY!"=="0" goto :cache_write_failed
if "!CACHE_VERSION_READY!"=="0" goto :cache_write_failed
> "!CACHE_TAG!" echo !RELEASE_TAG!
call :is_nonempty "!CACHE_TAG!" CACHE_TAG_READY
if "!CACHE_TAG_READY!"=="0" goto :cache_write_failed
call :clear_temporary_files

:materialize_cache
echo [3/3] Materializing the !SELECTED_LINE! !BUILD_MODE! cache...
if not exist "!OUTPUT_DIR!" mkdir "!OUTPUT_DIR!"
if not exist "!OUTPUT_DIR!" (
    echo Error: Could not create output directory:
    echo   !OUTPUT_DIR!
    exit /b 1
)
copy /Y "!CACHE_DLL!" "!OUTPUT_DLL!" >nul
if errorlevel 1 goto :mat_fail
if exist "!CACHE_PDB!" (
    copy /Y "!CACHE_PDB!" "!OUTPUT_PDB!" >nul
    if errorlevel 1 goto :mat_fail
) else (
    del /q "!OUTPUT_PDB!" >nul 2>&1
    if exist "!OUTPUT_PDB!" goto :mat_fail
)
copy /Y "!CACHE_VERSION!" "!TOP_VERSION!" >nul
if errorlevel 1 goto :mat_fail
copy /Y "!CACHE_TAG!" "!TOP_TAG!" >nul
if errorlevel 1 goto :mat_fail

set "VP_VERSION="
set /p "VP_VERSION="<"!CACHE_VERSION!"
echo [OK] VP version: !VP_VERSION!
echo [OK] DLL: !OUTPUT_DLL!
exit /b 0

:cache_write_failed
echo Error: Could not write the complete cache entry.
del /q "!CACHE_TAG!" >nul 2>&1
if exist "!CACHE_TAG!" echo Error: Could not invalidate the incomplete cache entry.
call :clear_temporary_files
exit /b 1

:mat_fail
echo Error: Could not materialize all selected DLL files.
exit /b 1

:check_ready
set "DOWNLOADS_READY=0"
call :is_nonempty "!TEMP_DLL!" TEMP_DLL_READY
call :is_nonempty "!TEMP_VERSION!" TEMP_VERSION_READY
if "!TEMP_DLL_READY!"=="1" if "!TEMP_VERSION_READY!"=="1" set "DOWNLOADS_READY=1"
exit /b 0

:is_nonempty
set "%~2=0"
if not exist "%~1" exit /b 0
for %%F in ("%~1") do if %%~zF GTR 0 set "%~2=1"
exit /b 0

:clear_temporary_files
if exist "!TEMP_DLL!" del /q "!TEMP_DLL!" >nul 2>&1
if exist "!TEMP_PDB!" del /q "!TEMP_PDB!" >nul 2>&1
if exist "!TEMP_VERSION!" del /q "!TEMP_VERSION!" >nul 2>&1
exit /b 0
