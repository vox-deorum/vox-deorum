@echo off
setlocal EnableDelayedExpansion

:: Vox Deorum Installation Script for Windows
:: Installs Steam, checks Civilization V, and sets up Vox Deorum with pre-built DLL

title Vox Deorum Installation

:: Configuration
set "SCRIPT_VERSION=2.1.0"
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "CIV5_APP_ID=8930"
set "TEMP_DIR=%TEMP%\VoxDeorumInstall"
set "VP_LINES_FILE=%SCRIPT_DIR%\vp-lines.txt"
set "SELECTED_LINE="
set "DEBUG_MODE=0"

:: Resolve the optional line and forward validation to download-dll.cmd.
:parse_arguments
if "%~1"=="" goto :arguments_parsed
if /i "%~1"=="--debug" (
    set "DEBUG_MODE=1"
    shift
    goto :parse_arguments
)
if /i "%~1"=="--line" (
    set "NEXT_ARGUMENT=%~2"
    if not defined NEXT_ARGUMENT goto :line_value_required
    if "!NEXT_ARGUMENT:~0,2!"=="--" goto :line_value_required
    set "SELECTED_LINE=!NEXT_ARGUMENT!"
    shift
    shift
    goto :parse_arguments
)
set "ARGUMENT_ERROR=%~1"
echo Error: Unsupported argument: !ARGUMENT_ERROR!
echo Usage: install.cmd [--line X.Y] [--debug]
exit /b 1

:line_value_required
echo Error: --line requires a VP line in X.Y format.
exit /b 1

:arguments_parsed
if not defined SELECTED_LINE if exist "%VP_LINES_FILE%" for /f "usebackq tokens=1,* delims==" %%A in ("%VP_LINES_FILE%") do if "%%A"=="DEFAULT_LINE" set "SELECTED_LINE=%%B"
set "DLL_BRANCH=vox-deorum-!SELECTED_LINE!"

if "%DEBUG_MODE%"=="1" (
    set "BUILD_DIR=%SCRIPT_DIR%\debug"
) else (
    set "BUILD_DIR=%SCRIPT_DIR%\release"
)

:: Set file paths based on build mode
set "PREBUILT_DLL=%BUILD_DIR%\CvGameCore_Expansion2.dll"
set "PREBUILT_PDB=%BUILD_DIR%\CvGameCore_Expansion2.pdb"
set "LUA_DLL=%BUILD_DIR%\lua51_win32.dll"
set "LUA_PDB=%BUILD_DIR%\lua51_win32.pdb"

:: Color codes removed - not reliably supported

:: Banner
echo.
echo =========================================
echo      Vox Deorum Installation Script
echo            Version %SCRIPT_VERSION%
echo           VP Line !SELECTED_LINE!
if "%DEBUG_MODE%"=="1" (
    echo           [DEBUG MODE ENABLED]
)
echo =========================================
echo.

:: Create temp directory
if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"

:: Download pre-built DLL if needed
echo [1/9] Downloading pre-built DLL...
if defined SELECTED_LINE (
    if "%DEBUG_MODE%"=="1" (
        call "%SCRIPT_DIR%\download-dll.cmd" --line "!SELECTED_LINE!" --debug
    ) else (
        call "%SCRIPT_DIR%\download-dll.cmd" --line "!SELECTED_LINE!"
    )
) else if "%DEBUG_MODE%"=="1" (
    call "%SCRIPT_DIR%\download-dll.cmd" --debug
) else (
    call "%SCRIPT_DIR%\download-dll.cmd"
)
if !errorlevel! neq 0 (
    echo Error: Failed to download pre-built DLL
    echo.
    echo Please check your internet connection or the release info file.
    pause
    exit /b 1
)

set "RELEASE_INFO=%SCRIPT_DIR%\dll-release-info-!SELECTED_LINE!.txt"
set "COMMIT="
for /f "usebackq tokens=1,* delims==" %%A in ("!RELEASE_INFO!") do if "%%A"=="COMMIT" set "COMMIT=%%B"

:: Warn without changing a contributor's source checkout when it differs from the selected pin.
set "DLL_SOURCE_DIR=%SCRIPT_DIR%\..\civ5-dll"
set "DLL_HEAD="
if exist "!DLL_SOURCE_DIR!\.git" (
    for /f "usebackq delims=" %%a in (`git -C "!DLL_SOURCE_DIR!" rev-parse HEAD 2^>nul`) do set "DLL_HEAD=%%a"
)
if /i not "!DLL_HEAD!"=="!COMMIT!" (
    echo.
    echo Warning: civ5-dll does not match the selected VP !SELECTED_LINE! pin.
    if defined DLL_HEAD (
        echo   Current HEAD: !DLL_HEAD!
    ) else (
        echo   Current HEAD: unavailable
    )
    echo   Selected pin: !COMMIT!
    echo.
    echo To repair the source checkout, run:
    echo   git -C "!DLL_SOURCE_DIR!" fetch origin !DLL_BRANCH!
    echo   git -C "!DLL_SOURCE_DIR!" switch --detach !COMMIT!
    echo.
)

:: Verify pre-built files exist
if not exist "%PREBUILT_DLL%" (
    echo Error: Pre-built DLL not found at:
    echo   !PREBUILT_DLL!
    echo.
    echo   Error: CvGameCore_Expansion2.dll not found in !BUILD_DIR!
    pause
    exit /b 1
)
echo   [OK] Pre-built DLL ready

:: Check for Lua DLL
if not exist "%LUA_DLL%" (
    echo   Warning: lua51_win32.dll not found in !BUILD_DIR!
) else (
    echo   [OK] Lua DLL found
)

:: Check for PDB files (always check for debug symbols)
if exist "%PREBUILT_PDB%" (
    echo   [OK] Debug symbols ^(PDB^) found for CvGameCore
) else (
    echo   Warning: CvGameCore_Expansion2.pdb not found
)
if exist "%LUA_PDB%" (
    echo   [OK] Debug symbols ^(PDB^) found for Lua
) else (
    echo   Warning: lua51_win32.pdb not found
)

:: Check/Install Steam
echo.
echo [2/9] Checking for Steam...
set "STEAM_FOUND=0"

:: Check registry for Steam path
for /f "tokens=2*" %%a in ('reg query "HKEY_CURRENT_USER\Software\Valve\Steam" /v SteamPath 2^>nul ^| findstr SteamPath') do (
    set "STEAM_PATH=%%b"
    set "STEAM_PATH=!STEAM_PATH:/=\!"
    set "STEAM_FOUND=1"
)

if "%STEAM_FOUND%"=="0" (
    for /f "tokens=2*" %%a in ('reg query "HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam" /v InstallPath 2^>nul ^| findstr InstallPath') do (
        set "STEAM_PATH=%%b"
        set "STEAM_FOUND=1"
    )
)

if "%STEAM_FOUND%"=="1" (
    echo   [OK] Steam found at: !STEAM_PATH!
) else (
    echo   Steam not found. Installing...
    :: Try winget first
    winget --version >nul 2>&1
    if !errorlevel! equ 0 (
        echo   Installing via winget...
        winget install Valve.Steam --accept-package-agreements --accept-source-agreements
    ) else (
        :: Download and run Steam installer
        echo   Downloading Steam installer...
        curl -L -o "%TEMP_DIR%\SteamSetup.exe" "https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe" >nul 2>&1
        if not exist "%TEMP_DIR%\SteamSetup.exe" (
            echo   curl failed, trying PowerShell...
            powershell -Command "try { Invoke-WebRequest -Uri 'https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe' -OutFile '%TEMP_DIR%\SteamSetup.exe' } catch { exit 1 }"
        )
        if exist "%TEMP_DIR%\SteamSetup.exe" (
            echo   Running Steam installer...
            "%TEMP_DIR%\SteamSetup.exe" /S
            echo.
        ) else (
            echo   Failed to download Steam installer
            echo   Please install Steam manually from: https://store.steampowered.com/
            pause
            exit /b 1
        )
    )

    :: Re-check for Steam after installation
    for /f "tokens=2*" %%a in ('reg query "HKEY_CURRENT_USER\Software\Valve\Steam" /v SteamPath 2^>nul ^| findstr SteamPath') do (
        set "STEAM_PATH=%%b"
        set "STEAM_PATH=!STEAM_PATH:/=\!"
    )
)

:: Download and setup SteamCMD
echo.
echo [3/9] Setting up SteamCMD...
set "STEAMCMD_DIR=%TEMP_DIR%\steamcmd"
set "STEAMCMD_EXE=%STEAMCMD_DIR%\steamcmd.exe"

if not exist "%STEAMCMD_EXE%" (
    echo   Downloading SteamCMD...
    if not exist "%STEAMCMD_DIR%" mkdir "%STEAMCMD_DIR%"
    curl -L -o "%TEMP_DIR%\steamcmd.zip" "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip" >nul 2>&1
    if not exist "%TEMP_DIR%\steamcmd.zip" (
        echo   curl failed, trying PowerShell...
        powershell -Command "try { Invoke-WebRequest -Uri 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip' -OutFile '%TEMP_DIR%\steamcmd.zip' } catch { exit 1 }"
    )

    if exist "%TEMP_DIR%\steamcmd.zip" (
        echo   Extracting SteamCMD...
        powershell -Command "Expand-Archive -Path '%TEMP_DIR%\steamcmd.zip' -DestinationPath '%STEAMCMD_DIR%' -Force"
    ) else (
        echo   Failed to download SteamCMD
        pause
        exit /b 1
    )
)
echo   [OK] SteamCMD ready
:: Check for Civ 5 installation using SteamCMD
echo.
echo [4/9] Checking for Civilization V installation...
echo   Running SteamCMD to check app %CIV5_APP_ID%...

:: Create SteamCMD script to check installation
echo @ShutdownOnFailedCommand 0 > "%TEMP_DIR%\check_civ5.txt"
echo @NoPromptForPassword 1 >> "%TEMP_DIR%\check_civ5.txt"
echo login anonymous >> "%TEMP_DIR%\check_civ5.txt"
echo app_info_print %CIV5_APP_ID% >> "%TEMP_DIR%\check_civ5.txt"
echo quit >> "%TEMP_DIR%\check_civ5.txt"

"%STEAMCMD_EXE%" +runscript "%TEMP_DIR%\check_civ5.txt" > "%TEMP_DIR%\steamcmd_output.txt" 2>&1

:: Check common installation paths
set "CIV5_FOUND=0"
set "CIV5_PATH="

:: Check default Steam library
if exist "%STEAM_PATH%\steamapps\common\Sid Meier's Civilization V\CivilizationV.exe" (
    set "CIV5_PATH=%STEAM_PATH%\steamapps\common\Sid Meier's Civilization V"
    set "CIV5_FOUND=1"
)

:: Check other common drives
if "%CIV5_FOUND%"=="0" (
    for %%D in (C D E F G) do (
        if exist "%%D:\SteamLibrary\steamapps\common\Sid Meier's Civilization V\CivilizationV.exe" (
            set "CIV5_PATH=%%D:\SteamLibrary\steamapps\common\Sid Meier's Civilization V"
            set "CIV5_FOUND=1"
        )
        if exist "%%D:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization V\CivilizationV.exe" (
            set "CIV5_PATH=%%D:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization V"
            set "CIV5_FOUND=1"
        )
        if exist "%%D:\Steam\steamapps\common\Sid Meier's Civilization V\CivilizationV.exe" (
            set "CIV5_PATH=%%D:\Steam\steamapps\common\Sid Meier's Civilization V"
            set "CIV5_FOUND=1"
        )
    )
)

if "%CIV5_FOUND%"=="1" (
    echo   [OK] Civilization V found at:
    echo     !CIV5_PATH!
) else (
    echo   Civilization V not found
    echo.
    echo   Please install Civilization V through Steam:
    echo   1. Open Steam and log in
    echo   2. Go to Library or Store
    echo   3. Install Civilization V ^(any edition^)
    echo   4. Note: Complete Edition recommended for all DLCs
    echo.
    echo   Opening Steam...
    start steam://install/!CIV5_APP_ID!
    echo.
    echo   After installation, please run this script again.
    pause
    exit /b 1
)

:: Setup MODS directory
echo.
echo [5/9] Setting up MODS directory...
:: Get the actual Documents folder path using PowerShell (handles OneDrive/redirected folders)
for /f "usebackq tokens=*" %%i in (`powershell -Command "[Environment]::GetFolderPath('MyDocuments')"`) do set "DOCUMENTS=%%i"
set "MODS_DIR=%DOCUMENTS%\My Games\Sid Meier's Civilization 5\MODS"
if not exist "%MODS_DIR%" (
    echo   Creating MODS directory...
    mkdir "%MODS_DIR%"
)
echo   [OK] MODS directory: !MODS_DIR!

:: Setup DLC directory for UI mods
echo.
echo [6/9] Installing UI mods to DLC directory...
set "DLC_DIR=%CIV5_PATH%\Assets\DLC"
set "SOURCE_VPUI=%SCRIPT_DIR%\..\civ5-dll\VPUI"
set "SOURCE_UI_BC1=%SCRIPT_DIR%\..\civ5-dll\UI_bc1"
set "DEST_VPUI=%DLC_DIR%\VPUI"
set "DEST_UI_BC1=%DLC_DIR%\UI_bc1"

if exist "%DLC_DIR%" (
    :: Copy VPUI
    if exist "!SOURCE_VPUI!" (
        echo   Copying VPUI to DLC folder...
        if exist "!DEST_VPUI!" (
            echo   Removing existing VPUI...
            rmdir /S /Q "!DEST_VPUI!" >nul 2>&1
        )
        xcopy /E /I /Y "!SOURCE_VPUI!" "!DEST_VPUI!" >nul 2>&1
        if !errorlevel! equ 0 (
            echo   [OK] VPUI installed to DLC folder
        ) else (
            echo   [WARN] Failed to copy VPUI to DLC folder
        )
    ) else (
        echo   [WARN] VPUI source folder not found
    )

    :: Copy UI_bc1
    if exist "!SOURCE_UI_BC1!" (
        echo   Copying UI_bc1 to DLC folder...
        if exist "!DEST_UI_BC1!" (
            echo   Removing existing UI_bc1...
            rmdir /S /Q "!DEST_UI_BC1!" >nul 2>&1
        )
        xcopy /E /I /Y "!SOURCE_UI_BC1!" "!DEST_UI_BC1!" >nul 2>&1
        if !errorlevel! equ 0 (
            echo   [OK] UI_bc1 installed to DLC folder
        ) else (
            echo   [WARN] Failed to copy UI_bc1 to DLC folder
        )
    ) else (
        echo   [WARN] UI_bc1 source folder not found
    )
) else (
    echo   [WARN] DLC directory not found at !DLC_DIR!
)
:: Check for existing Vox Populi installation
echo.
echo [7/10] Installing Vox Populi Community Patch...
set "VP_INSTALLED=0"
set "CP_PATH=%MODS_DIR%\(1) Community Patch"
set "VD_PATH=%MODS_DIR%\(1b) Vox Deorum"
set "VP_PATH=%MODS_DIR%\(2) Vox Populi"
set "EUI_PATH=%MODS_DIR%\(3a) VP - EUI Compatibility Files"

if exist "%CP_PATH%" (
    if exist "%VP_PATH%" (
        echo   [OK] Vox Populi already installed
        set "VP_INSTALLED=1"
    )
)

if "%VP_INSTALLED%"=="1" (
    :: Always override existing installation
    echo   Existing Vox Populi installation detected.
    echo   Overriding with fresh installation...
    set "VP_INSTALLED=0"
)

if "%VP_INSTALLED%"=="0" (
    :: Copy full Community Patch, Vox Deorum, Vox Populi, and EUI Compatibility Files
    echo   Installing Community Patch, Vox Deorum, Vox Populi, and EUI Compatibility Files...

    :: Check if source folders exist
    set "SOURCE_CP=%SCRIPT_DIR%\..\civ5-dll\(1) Community Patch"
    set "SOURCE_VD=%SCRIPT_DIR%\..\civ5-mod"
    set "SOURCE_VP=%SCRIPT_DIR%\..\civ5-dll\(2) Vox Populi"
    set "SOURCE_EUI=%SCRIPT_DIR%\..\civ5-dll\(3a) VP - EUI Compatibility Files"

    if exist "!SOURCE_CP!" (
        echo   Removing old mod folders if they exist...
        :: Delete existing mod folders first (similar to robocopy /mir), but continue even if deletion fails
        if exist "!CP_PATH!" rmdir /S /Q "!CP_PATH!" 2>nul
        if exist "!VD_PATH!" rmdir /S /Q "!VD_PATH!" 2>nul
        if exist "!VP_PATH!" rmdir /S /Q "!VP_PATH!" 2>nul
        if exist "!EUI_PATH!" rmdir /S /Q "!EUI_PATH!" 2>nul

        echo   Copying ^(1^) Community Patch...
        xcopy /E /I /Y "!SOURCE_CP!" "!CP_PATH!" >nul 2>&1

        :: Copy the pre-built DLL
        echo   Copying pre-built DLL...
        copy /Y "!PREBUILT_DLL!" "!CP_PATH!\CvGameCore_Expansion2.dll" >nul 2>&1

        :: Copy Lua DLL to Civ5 folder
        if exist "!LUA_DLL!" (
            echo   Copying Lua DLL...
            copy /Y "!LUA_DLL!" "!CIV5_PATH!\lua51_win32.dll" >nul 2>&1
        )

        :: Copy PDB files (always copy debug symbols if available)
        if exist "!PREBUILT_PDB!" (
            echo   Copying CvGameCore debug symbols...
            copy /Y "!PREBUILT_PDB!" "!CP_PATH!\CvGameCore_Expansion2.pdb" >nul 2>&1
        )
        if exist "!LUA_PDB!" (
            echo   Copying Lua debug symbols...
            copy /Y "!LUA_PDB!" "!CIV5_PATH!\lua51_win32.pdb" >nul 2>&1
        )

        :: Copy Vox Deorum mod
        if exist "!SOURCE_VD!" (
            echo   Copying ^(1b^) Vox Deorum...
            xcopy /E /I /Y "!SOURCE_VD!" "!VD_PATH!" >nul 2>&1
            :: Don't copy .bat files
            del "!VD_PATH!\*.bat" >nul 2>&1
        )

        if exist "!SOURCE_VP!" (
            echo   Copying ^(2^) Vox Populi...
            xcopy /E /I /Y "!SOURCE_VP!" "!VP_PATH!" >nul 2>&1
        )

        if exist "!SOURCE_EUI!" (
            echo   Copying ^(3a^) EUI Compatibility Files...
            xcopy /E /I /Y "!SOURCE_EUI!" "!EUI_PATH!" >nul 2>&1
        )

        :: Delete cached localization database to force regeneration
        if exist "!DOCUMENTS!\My Games\Sid Meier's Civilization 5\cache\Localization-Merged.db" (
            del "!DOCUMENTS!\My Games\Sid Meier's Civilization 5\cache\Localization-Merged.db" >nul 2>&1
            echo   [OK] Cleared cached Localization-Merged.db
        )

        echo   [OK] Mods installed successfully
    ) else (
        echo   Warning: Source mod folders not found
        echo   Expected at: !SOURCE_CP!
        echo   Please manually copy:
        echo     - ^(1^) Community Patch folder to !CP_PATH!
        echo     - ^(1b^) Vox Deorum folder to !VD_PATH!
        echo     - ^(2^) Vox Populi folder to !VP_PATH!
        echo     - ^(3a^) EUI Compatibility Files folder to !EUI_PATH!
        echo     - CvGameCore_Expansion2.dll to !CP_PATH!\
    )
)

:skip_vp_override
:: Copy config.ini and UserSettings.ini if not present in game settings folder
echo.
echo [8/10] Checking Vox Deorum configuration files...
set "SETTINGS_DIR=%DOCUMENTS%\My Games\Sid Meier's Civilization 5"
set "CONFIG_SOURCE=%SCRIPT_DIR%\configs\config.ini"
set "CONFIG_DEST=%SETTINGS_DIR%\config.ini"
set "USERSETTINGS_SOURCE=%SCRIPT_DIR%\configs\UserSettings.ini"
set "USERSETTINGS_DEST=%SETTINGS_DIR%\UserSettings.ini"

:: Check and copy config.ini
if exist "%CONFIG_SOURCE%" (
    if not exist "%CONFIG_DEST%" (
        echo   Copying config.ini to game settings folder...
        copy /Y "%CONFIG_SOURCE%" "%CONFIG_DEST%" >nul 2>&1
        if !errorlevel! equ 0 (
            echo   [OK] config.ini copied to game settings
        ) else (
            echo   [WARN] Could not copy config.ini to %SETTINGS_DIR%
        )
    ) else (
        echo   [OK] config.ini already exists in game settings
    )
) else (
    echo   [WARN] config.ini not found in scripts folder
)

:: Check and copy UserSettings.ini
if exist "%USERSETTINGS_SOURCE%" (
    if not exist "%USERSETTINGS_DEST%" (
        echo   Copying UserSettings.ini to game settings folder...
        copy /Y "%USERSETTINGS_SOURCE%" "%USERSETTINGS_DEST%" >nul 2>&1
        if !errorlevel! equ 0 (
            echo   [OK] UserSettings.ini copied to game settings
        ) else (
            echo   [WARN] Could not copy UserSettings.ini to %SETTINGS_DIR%
        )
    ) else (
        echo   [OK] UserSettings.ini already exists in game settings
    )
) else (
    echo   [WARN] UserSettings.ini not found in scripts folder
)

:: Install Node.js dependencies
echo.
echo [9/10] Installing Node.js dependencies...
set "PROJECT_ROOT=%SCRIPT_DIR%\.."
echo   Project root: !PROJECT_ROOT!

:: Check if Node.js is installed
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo   Node.js not found. Installing Node.js 22...

    :: Check for admin rights
    net session >nul 2>&1
    if !errorlevel! equ 0 (
        set "HAS_ADMIN=1"
        echo   Administrator rights detected. Attempting MSI installation...
    ) else (
        set "HAS_ADMIN=0"
        echo   No administrator rights. Using portable installation...
        goto :install_portable_node
    )

    :: Download and install Node.js MSI installer (only if admin)
    if "!HAS_ADMIN!"=="1" (
        echo   Downloading Node.js 22 installer...
        set "NODE_INSTALLER=%TEMP_DIR%\node-v22.19.0-x64.msi"
        curl -L -o "!NODE_INSTALLER!" "https://nodejs.org/dist/v22.19.0/node-v22.19.0-x64.msi" >nul 2>&1
        if not exist "!NODE_INSTALLER!" (
            echo   curl failed, trying PowerShell...
            powershell -Command "try { Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.19.0/node-v22.19.0-x64.msi' -OutFile '!NODE_INSTALLER!' } catch { exit 1 }"
        )

        if exist "!NODE_INSTALLER!" (
            echo   Installing Node.js 22...
            msiexec /i "!NODE_INSTALLER!" /qn /norestart
            if !errorlevel! equ 0 (
                echo   [OK] Node.js 22 installed successfully
                :: Add Node.js to PATH for current session
                set "PATH=%ProgramFiles%\nodejs;!PATH!"
                :: Also try the default install location
                if exist "%ProgramFiles%\nodejs\node.exe" (
                    set "NODE_PATH=%ProgramFiles%\nodejs"
                ) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
                    set "NODE_PATH=%ProgramFiles(x86)%\nodejs"
                ) else if exist "%LocalAppData%\Programs\nodejs\node.exe" (
                    set "NODE_PATH=%LocalAppData%\Programs\nodejs"
                )
                if defined NODE_PATH (
                    set "PATH=!NODE_PATH!;!PATH!"
                    echo   Added Node.js to PATH: !NODE_PATH!
                )
                
                :: Refresh environment variables
                if exist "%SCRIPT_DIR%\refreshenv.cmd" (
                    call "%SCRIPT_DIR%\refreshenv.cmd" >nul 2>&1
                ) else if exist "%ProgramData%\chocolatey\bin\refreshenv.cmd" (
                    call "%ProgramData%\chocolatey\bin\refreshenv.cmd" >nul 2>&1
                ) else (
                    :: Try to refresh PATH from registry if refreshenv.cmd not available
                    for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYSTEM_PATH=%%B"
                    for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%B"
                    if defined SYSTEM_PATH if defined USER_PATH (
                        set "PATH=!SYSTEM_PATH!;!USER_PATH!"
                    )
                )
            ) else (
                echo   [WARN] Failed to install Node.js via MSI installer
                echo   Attempting portable Node.js installation...
                goto :install_portable_node
            )
        ) else (
            echo   [WARN] Failed to download Node.js installer
            echo   Attempting portable Node.js installation...
            goto :install_portable_node
        )
    )

    :: Skip portable installation if previous method succeeded
    goto :check_node_installed

:install_portable_node
    echo   Installing portable Node.js to local node/ folder...
    set "PORTABLE_NODE_DIR=!PROJECT_ROOT!\node"
    set "NODE_ZIP=%TEMP_DIR%\node-v22.19.0-win-x64.zip"

    :: Download portable Node.js
    echo   Downloading portable Node.js 22.19.0...
    curl -L -o "!NODE_ZIP!" "https://nodejs.org/dist/v22.19.0/node-v22.19.0-win-x64.zip" >nul 2>&1
    if not exist "!NODE_ZIP!" (
        echo   curl failed, trying PowerShell...
        powershell -Command "try { Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.19.0/node-v22.19.0-win-x64.zip' -OutFile '!NODE_ZIP!' } catch { exit 1 }"
    )

    if exist "!NODE_ZIP!" (
        echo   Extracting portable Node.js...
        :: Create node directory if it doesn't exist
        if not exist "!PORTABLE_NODE_DIR!" mkdir "!PORTABLE_NODE_DIR!"

        :: Extract the zip file
        powershell -Command "Expand-Archive -Path '!NODE_ZIP!' -DestinationPath '!TEMP_DIR!\node-extract' -Force"

        :: Move files from extracted folder to node/ directory
        if exist "!TEMP_DIR!\node-extract\node-v22.19.0-win-x64" (
            xcopy /E /I /Y "!TEMP_DIR!\node-extract\node-v22.19.0-win-x64\*" "!PORTABLE_NODE_DIR!" >nul 2>&1
            echo   [OK] Portable Node.js extracted to: !PORTABLE_NODE_DIR!

            :: Add to PATH for current session
            set "PATH=!PORTABLE_NODE_DIR!;!PATH!"
            echo   Added portable Node.js to PATH

            :: Clean up extraction folder
            if exist "!TEMP_DIR!\node-extract" rmdir /S /Q "!TEMP_DIR!\node-extract" >nul 2>&1
        ) else (
            echo   [ERROR] Failed to extract portable Node.js
        )
    ) else (
        echo   [ERROR] Failed to download portable Node.js
        echo   Please install Node.js manually from https://nodejs.org/
    )

:check_node_installed
    :: Re-check if Node.js is now available
    where node >nul 2>&1
    if !errorlevel! neq 0 (
        echo   [WARN] Node.js still not found. Skipping dependency installation...
    ) else (
        echo   [OK] Node.js is now available
    )
) else (
    :: Node.js found, check version
    for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VERSION=%%v"
    echo   [OK] Node.js found ^(!NODE_VERSION!^)
)

:: Final check before installing dependencies
where node >nul 2>&1
if !errorlevel! equ 0 (
    :: Install dependencies using workspaces from root package.json
    if exist "!PROJECT_ROOT!\package.json" (
        echo   Installing all dependencies via npm workspaces...
        pushd "!PROJECT_ROOT!"
        call npm install
        if !errorlevel! equ 0 (
            echo   [OK] All dependencies installed via workspaces

            :: Pre-build mcp-server to ensure it's ready to use
            echo   Building MCP server...
            pushd "!PROJECT_ROOT!\mcp-server"
            call npm run build
            if !errorlevel! equ 0 (
                echo   [OK] MCP server built successfully
            ) else (
                echo   [WARN] Failed to build MCP server
            )
            popd
        ) else (
            echo   [WARN] Failed to install dependencies
            echo   Error level: !errorlevel!
        )
        popd
        
        if exist "!PROJECT_ROOT!\vox-agents\ui\package.json" (
            echo   Installing WebUI dependencies...
            pushd "!PROJECT_ROOT!\vox-agents\ui"
            call npm install
            popd
        )

        :: Setup .env file if it doesn't exist
        if exist "!PROJECT_ROOT!\vox-agents\.env.default" (
            if not exist "!PROJECT_ROOT!\vox-agents\.env" (
                echo.
                echo   Setting up environment configuration...
                echo.
                copy /Y "!PROJECT_ROOT!\vox-agents\.env.default" "!PROJECT_ROOT!\vox-agents\.env" >nul 2>&1
                set "ENV_CREATED=1"
            ) else (
                echo   [OK] .env file already exists
            )
        )
    )
)

:: Verification
echo.
echo [10/10] Verification...
set "SUCCESS=1"

:: Check Steam
if exist "%STEAM_PATH%\steam.exe" (
    echo   [OK] Steam installed
) else (
    echo   [FAIL] Steam not found
    set "SUCCESS=0"
)

:: Check Civ 5
if "%CIV5_FOUND%"=="1" (
    echo   [OK] Civilization V installed
) else (
    echo   [FAIL] Civilization V not found
    set "SUCCESS=0"
)

:: Check Community Patch
if exist "%CP_PATH%\CvGameCore_Expansion2.dll" (
    echo   [OK] Community Patch DLL installed
) else (
    echo   [FAIL] Community Patch DLL not found
    set "SUCCESS=0"
)

:: Check Vox Deorum
if exist "%VD_PATH%" (
    echo   [OK] Vox Deorum installed
) else (
    echo   [WARN] Vox Deorum not found
)

:: Check Vox Populi
if exist "%VP_PATH%" (
    echo   [OK] Vox Populi installed
) else (
    echo   [WARN] Vox Populi not found ^(optional^)
)

:: Check EUI Compatibility Files
if exist "%EUI_PATH%" (
    echo   [OK] ^(3a^) EUI Compatibility Files installed
) else (
    echo   [WARN] ^(3a^) EUI Compatibility Files not found
)

:: Check VPUI in DLC
if exist "%DLC_DIR%\VPUI" (
    echo   [OK] VPUI installed in DLC folder
) else (
    echo   [WARN] VPUI not found in DLC folder
)

:: Check UI_bc1 in DLC
if exist "%DLC_DIR%\UI_bc1" (
    echo   [OK] UI_bc1 installed in DLC folder
) else (
    echo   [WARN] UI_bc1 not found in DLC folder
)

:: Check Lua DLL
if exist "%CIV5_PATH%\lua51_win32.dll" (
    echo   [OK] Lua DLL installed
) else (
    echo   [WARN] Lua DLL not installed
)

:: Check debug symbols (always check if installed)
if exist "%CP_PATH%\CvGameCore_Expansion2.pdb" (
    echo   [OK] CvGameCore debug symbols installed
)
if exist "%CIV5_PATH%\lua51_win32.pdb" (
    echo   [OK] Lua debug symbols installed
)

:: Check config.ini
if exist "%CONFIG_DEST%" (
    echo   [OK] Vox Deorum config.ini installed
) else (
    echo   [WARN] config.ini not found in game settings
)

:: Check UserSettings.ini
if exist "%USERSETTINGS_DEST%" (
    echo   [OK] UserSettings.ini installed
) else (
    echo   [WARN] UserSettings.ini not found in game settings
)

:: Final message
echo.
echo =========================================
if "%SUCCESS%"=="1" (
    echo        Installation Complete!
    echo.
    echo Next steps:
    echo   1. Configure your LLM API keys in the .env file
    echo   2. Launch the game manually once to install dependencies
    echo   3. Run scripts\vox-deorum.cmd to start all services
    echo   4. Start playing with AI assistance!
    echo.
    echo The Vox Deorum DLL has been installed.
    echo Debug symbols will be copied if available.

    :: Open .env file if it was just created
    if "%ENV_CREATED%"=="1" (
        echo.
        echo Opening .env file for API key configuration...
        start notepad "!PROJECT_ROOT!\vox-agents\.env"
    )
) else (
    echo      Installation Partially Complete
    echo.
    echo Please resolve any issues above and run again.
)
echo =========================================
:: Cleanup
echo.
echo Cleaning up...
if exist "%TEMP_DIR%\steamcmd.zip" del "%TEMP_DIR%\steamcmd.zip"
if exist "%TEMP_DIR%\SteamSetup.exe" del "%TEMP_DIR%\SteamSetup.exe"
if exist "%TEMP_DIR%\check_civ5.txt" del "%TEMP_DIR%\check_civ5.txt"
if exist "%TEMP_DIR%\steamcmd_output.txt" del "%TEMP_DIR%\steamcmd_output.txt"
if exist "%TEMP_DIR%\node-v22.19.0-x64.msi" del "%TEMP_DIR%\node-v22.19.0-x64.msi"
if exist "%TEMP_DIR%\node-v22.19.0-win-x64.zip" del "%TEMP_DIR%\node-v22.19.0-win-x64.zip"

echo.
exit /b 0
