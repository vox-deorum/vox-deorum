@echo off
setlocal enabledelayedexpansion

:: Vox Deorum Services Manager
:: Usage: vox-deorum.cmd [--keep-open] [vox-agents-mode] [additional-args...]
:: Default mode: webui (launches web interface)
:: Supports any mode matching an npm script in vox-agents (e.g. briefer, strategist)
:: --keep-open keeps each service window open after its command exits
:: Example: vox-deorum.cmd --keep-open --strategist --verbose --debug
:: Graceful shutdown uses local POST /shutdown endpoints discovered from plain-text temp files.

:: Configure Node.js (prefer bundled over system)
set "BUNDLED_NODE=%~dp0..\node"
set "NODE_FOUND="

:: Try bundled Node.js first
if exist "%BUNDLED_NODE%\npm.cmd" (
    echo [DEBUG] Found bundled npm.cmd at %BUNDLED_NODE%\npm.cmd
    call "%BUNDLED_NODE%\npm.cmd" --version >nul 2>&1
    if !errorlevel! equ 0 (
        set "PATH=%BUNDLED_NODE%;%PATH%"
        set "NODE_FOUND=bundled"
        echo [INFO] Using bundled Node.js
    ) else (
        echo [DEBUG] Bundled npm.cmd test failed with errorlevel !errorlevel!
    )
)

:: Fall back to system Node.js
if not defined NODE_FOUND (
    where npm >nul 2>&1
    if !errorlevel! equ 0 (
        set "NODE_FOUND=system"
        echo [INFO] Using system Node.js
    )
)

:: Exit if no Node.js found
if not defined NODE_FOUND (
    echo [ERROR] Node.js not found. Install it or place a portable version in: %BUNDLED_NODE%
    pause
    exit /b 1
)

where curl >nul 2>&1
if errorlevel 1 (
    echo [ERROR] curl.exe not found in PATH. Windows curl is required for graceful shutdown.
    pause
    exit /b 1
)

:: Read the launcher-only option without forwarding it to Vox Agents.
set "CHILD_CMD_SWITCH=/c"
set "CHILD_COMMAND_SUFFIX="
set "KEEP_OPEN="
set "VOX_MODE="
set "ADDITIONAL_ARGS="
for %%a in (%*) do (
    if /i "%%~a"=="--keep-open" (
        set "KEEP_OPEN=1"
        set "CHILD_CMD_SWITCH=/k"
        set "CHILD_COMMAND_SUFFIX= & powershell -NoProfile -Command Set-Content -LiteralPath $env:VOX_SERVICE_EXIT_FILE -Value ([string]::Empty)"
    ) else if not defined VOX_MODE (
        set "VOX_MODE=%%~a"
    ) else (
        set "ADDITIONAL_ARGS=!ADDITIONAL_ARGS! %%a"
    )
)
if not defined VOX_MODE set "VOX_MODE=webui"

:: Remove -- prefix if present
set "VOX_MODE=%VOX_MODE:--=-%"

:: Check if vox-agents/src exists to determine dev vs dist mode
if not exist "%~dp0..\vox-agents\src\index.ts" (
    echo [INFO] Source directory not found, using compiled distribution...

    :: Map webui to start:dist; all other modes get :dist suffix
    if "%VOX_MODE%"=="webui" (
        set "VOX_MODE=start:dist"
    ) else (
        set "VOX_MODE=%VOX_MODE%:dist"
    )
) else (
    :: Map webui to start; all other modes pass through as-is
    if "%VOX_MODE%"=="webui" set "VOX_MODE=start"
)

set "RUN_ID=%RANDOM%%RANDOM%%RANDOM%"
set "GRACEFUL_STOP_TIMEOUT=30"
set "BRIDGE_PID_FILE=%TEMP%\vox-deorum-bridge-%RUN_ID%.pid"
set "MCP_PID_FILE=%TEMP%\vox-deorum-mcp-%RUN_ID%.pid"
set "VOX_PID_FILE=%TEMP%\vox-deorum-vox-%RUN_ID%.pid"
set "BRIDGE_URL_FILE=%TEMP%\vox-deorum-bridge-%RUN_ID%.shutdown"
set "MCP_URL_FILE=%TEMP%\vox-deorum-mcp-%RUN_ID%.shutdown"
set "VOX_URL_FILE=%TEMP%\vox-deorum-vox-%RUN_ID%.shutdown"
set "BRIDGE_EXIT_FILE=%TEMP%\vox-deorum-bridge-%RUN_ID%.exit"
set "MCP_EXIT_FILE=%TEMP%\vox-deorum-mcp-%RUN_ID%.exit"
set "VOX_EXIT_FILE=%TEMP%\vox-deorum-vox-%RUN_ID%.exit"
set "BRIDGE_LOG_FILE=%~dp0..\bridge-service\logs\combined.log"
set "MCP_LOG_FILE=%~dp0..\mcp-server\logs\combined.log"
set "VOX_LOG_FILE=%~dp0..\vox-agents\logs\combined.log"

del "%BRIDGE_PID_FILE%" 2>nul
del "%MCP_PID_FILE%" 2>nul
del "%VOX_PID_FILE%" 2>nul
del "%BRIDGE_URL_FILE%" 2>nul
del "%MCP_URL_FILE%" 2>nul
del "%VOX_URL_FILE%" 2>nul
del "%BRIDGE_EXIT_FILE%" 2>nul
del "%MCP_EXIT_FILE%" 2>nul
del "%VOX_EXIT_FILE%" 2>nul

echo(
echo(========================================
echo(    Vox Deorum Services Manager
echo(========================================
echo(
echo [INFO] Mode: %VOX_MODE%
if defined KEEP_OPEN echo [INFO] Service windows will remain open after their commands exit.
echo [INFO] Starting services in order...
echo.

:: Determine bridge-service command based on source availability
set "BRIDGE_COMMAND=start"
if not exist "%~dp0..\bridge-service\src\index.ts" (
    set "BRIDGE_COMMAND=start:dist"
)

:: Determine mcp-server command based on source availability
set "MCP_COMMAND=start"
if not exist "%~dp0..\mcp-server\src\index.ts" (
    set "MCP_COMMAND=start:dist"
)

set "BRIDGE_PID="
set "MCP_PID="
set "VOX_PID="
set "BRIDGE_SHUTDOWN_URL="
set "MCP_SHUTDOWN_URL="
set "VOX_SHUTDOWN_URL="
set "KILL_CIV_MODE="
set "CIV_PID="
set "FAILED_SERVICE_ID="
set "FAILED_SERVICE_NAME="
set "FAILED_SERVICE_LOG="
set "FAILED_SERVICE_LOG_START_LINE=0"

call :count_log_lines "%BRIDGE_LOG_FILE%" BRIDGE_LOG_START_LINE
call :count_log_lines "%MCP_LOG_FILE%" MCP_LOG_START_LINE
call :count_log_lines "%VOX_LOG_FILE%" VOX_LOG_START_LINE

:: Refuse to start when a prior service is still listening on a required port.
call :check_port_free 5000 "Bridge Service"
if errorlevel 1 goto :startup_failed
call :check_port_free 4000 "MCP Server"
if errorlevel 1 goto :startup_failed

:: Start Bridge Service
echo [1/3] Starting Bridge Service (%BRIDGE_COMMAND%)...
powershell -Command "$env:BRIDGE_SHUTDOWN_URL_FILE='%BRIDGE_URL_FILE%'; $env:VOX_SERVICE_EXIT_FILE='%BRIDGE_EXIT_FILE%'; $p = Start-Process cmd -WorkingDirectory '%~dp0..\bridge-service' -ArgumentList '%CHILD_CMD_SWITCH%','npm run %BRIDGE_COMMAND%!CHILD_COMMAND_SUFFIX!' -PassThru; $p.Id" > "%BRIDGE_PID_FILE%"
if errorlevel 1 goto :startup_failed
set /p BRIDGE_PID=<"%BRIDGE_PID_FILE%"
echo        Started with PID: %BRIDGE_PID%

:: Start MCP Server
echo [2/3] Starting MCP Server (%MCP_COMMAND%)...
powershell -Command "$env:MCP_SHUTDOWN_URL_FILE='%MCP_URL_FILE%'; $env:VOX_SERVICE_EXIT_FILE='%MCP_EXIT_FILE%'; $p = Start-Process cmd -WorkingDirectory '%~dp0..\mcp-server' -ArgumentList '%CHILD_CMD_SWITCH%','npm run %MCP_COMMAND%!CHILD_COMMAND_SUFFIX!' -PassThru; $p.Id" > "%MCP_PID_FILE%"
if errorlevel 1 goto :startup_failed
set /p MCP_PID=<"%MCP_PID_FILE%"
echo        Started with PID: %MCP_PID%

:: Start Vox Agents
echo [3/3] Starting Vox Agents (mode: %VOX_MODE%!ADDITIONAL_ARGS!)...
if "!ADDITIONAL_ARGS!"=="" (
    powershell -Command "$env:VOX_SHUTDOWN_URL_FILE='%VOX_URL_FILE%'; $env:VOX_SERVICE_EXIT_FILE='%VOX_EXIT_FILE%'; $p = Start-Process cmd -WorkingDirectory '%~dp0..\vox-agents' -ArgumentList '%CHILD_CMD_SWITCH%','npm run %VOX_MODE%!CHILD_COMMAND_SUFFIX!' -PassThru; $p.Id" > "%VOX_PID_FILE%"
) else (
    set "NPM_COMMAND=npm run %VOX_MODE% -- !ADDITIONAL_ARGS!"
    powershell -Command "$env:VOX_SHUTDOWN_URL_FILE='%VOX_URL_FILE%'; $env:VOX_SERVICE_EXIT_FILE='%VOX_EXIT_FILE%'; $p = Start-Process cmd -WorkingDirectory '%~dp0..\vox-agents' -ArgumentList '%CHILD_CMD_SWITCH%','!NPM_COMMAND!!CHILD_COMMAND_SUFFIX!' -PassThru; $p.Id" > "%VOX_PID_FILE%"
)
if errorlevel 1 goto :startup_failed
set /p VOX_PID=<"%VOX_PID_FILE%"
echo        Started with PID: %VOX_PID%

echo.
echo [INFO] Waiting for shutdown URLs...

call :wait_for_url_file "%BRIDGE_URL_FILE%" "Bridge Service" 60
if errorlevel 2 goto :unexpected_exit
if errorlevel 1 goto :startup_failed
set /p BRIDGE_SHUTDOWN_URL=<"%BRIDGE_URL_FILE%"
call :extract_port "%BRIDGE_SHUTDOWN_URL%"
set "BRIDGE_PORT=!EXTRACTED_PORT!"
echo        Bridge Service URL: %BRIDGE_SHUTDOWN_URL%

call :wait_for_url_file "%MCP_URL_FILE%" "MCP Server" 60
if errorlevel 2 goto :unexpected_exit
if errorlevel 1 goto :startup_failed
set /p MCP_SHUTDOWN_URL=<"%MCP_URL_FILE%"
call :extract_port "%MCP_SHUTDOWN_URL%"
set "MCP_PORT=!EXTRACTED_PORT!"
echo        MCP Server URL: %MCP_SHUTDOWN_URL%

call :wait_for_url_file "%VOX_URL_FILE%" "Vox Agents" 90
if errorlevel 2 goto :unexpected_exit
if errorlevel 1 goto :startup_failed
set /p VOX_SHUTDOWN_URL=<"%VOX_URL_FILE%"
call :extract_port "%VOX_SHUTDOWN_URL%"
set "VOX_PORT=!EXTRACTED_PORT!"
echo        Shutdown URL: %VOX_SHUTDOWN_URL%

call :check_services_running
if errorlevel 1 goto :unexpected_exit

echo ========================================
echo All services started successfully!
echo ========================================
echo.
echo Services running:
echo   - Bridge Service (Port: %BRIDGE_PORT%, PID: %BRIDGE_PID%)
echo     %BRIDGE_SHUTDOWN_URL%
echo   - MCP Server (Port: %MCP_PORT%, PID: %MCP_PID%)
echo     %MCP_SHUTDOWN_URL%
echo   - Vox Agents (Port: %VOX_PORT%, Mode: %VOX_MODE%, PID: %VOX_PID%)
echo     %VOX_SHUTDOWN_URL%
echo.
echo Press Q to stop all services.
echo Press K to stop all services, then kill CivilizationV.exe.

:monitor_loop
choice /c QKT /n /t 1 /d T >nul
set "CHOICE_RESULT=!errorlevel!"
call :check_services_running
if errorlevel 1 goto :unexpected_exit
if "!CHOICE_RESULT!"=="1" (
    set "PENDING_ACTION=Q"
    set "CONFIRM_PROMPT=Stop all services? (Y/N)"
    goto :confirm_shutdown
)
if "!CHOICE_RESULT!"=="2" (
    set "PENDING_ACTION=K"
    set "CONFIRM_PROMPT=Stop all services and kill CivilizationV.exe? (Y/N)"
    goto :confirm_shutdown
)
if "!CHOICE_RESULT!"=="3" goto :monitor_loop
echo [ERROR] Could not read launcher input.
goto :startup_failed

:confirm_shutdown
choice /c YN /n /m "!CONFIRM_PROMPT!"
set "CONFIRM_RESULT=!errorlevel!"
call :check_services_running
if errorlevel 1 goto :unexpected_exit
if "!CONFIRM_RESULT!"=="1" (
    if "!PENDING_ACTION!"=="K" (
        set "KILL_CIV_MODE=1"
        echo [INFO] Kill-game mode selected. Services will stop first, then CivilizationV.exe will be force-killed if found.
    )
    goto :normal_shutdown
)
if "!CONFIRM_RESULT!"=="2" goto :monitor_loop
echo [ERROR] Could not read launcher confirmation.
goto :startup_failed

:normal_shutdown
echo.
echo [INFO] Shutting down services...

call :shutdown_services

if defined KILL_CIV_MODE (
    echo.
    echo [INFO] Looking for CivilizationV.exe...
    call :find_civ_pid
    if defined CIV_PID (
        echo [INFO] Found CivilizationV.exe with PID: !CIV_PID!
        echo [INFO] Force-killing CivilizationV.exe...
        taskkill /PID !CIV_PID! /T /F >nul 2>&1
        call :wait_for_exit "!CIV_PID!" 5 >nul 2>&1
        echo [INFO] CivilizationV.exe kill requested.
    ) else (
        echo [INFO] CivilizationV.exe is not running.
    )
)

call :cleanup_temp_files

echo.
echo ========================================
echo All services stopped.
echo ========================================
echo.

endlocal
exit /b 0

:unexpected_exit
:: Stop the remaining services and show the failed service's recent output.
echo.
echo [ERROR] %FAILED_SERVICE_NAME% exited unexpectedly.
echo [INFO] Shutting down remaining services...
call :shutdown_services
call :print_failed_log_tail
call :cleanup_temp_files
pause
endlocal
exit /b 1

:shutdown_services
:: Stop every service through its existing graceful shutdown path.
echo [1/3] Stopping Vox Agents (PID: %VOX_PID%)...
call :stop_service "Vox Agents" "%VOX_PID%" "%VOX_SHUTDOWN_URL%" %GRACEFUL_STOP_TIMEOUT% "%VOX_EXIT_FILE%"
echo [2/3] Stopping MCP Server (PID: %MCP_PID%)...
call :stop_service "MCP Server" "%MCP_PID%" "%MCP_SHUTDOWN_URL%" %GRACEFUL_STOP_TIMEOUT% "%MCP_EXIT_FILE%"
echo [3/3] Stopping Bridge Service (PID: %BRIDGE_PID%)...
call :stop_service "Bridge Service" "%BRIDGE_PID%" "%BRIDGE_SHUTDOWN_URL%" %GRACEFUL_STOP_TIMEOUT% "%BRIDGE_EXIT_FILE%"
exit /b 0

:wait_for_url_file
set "WAIT_FILE=%~1"
set "WAIT_NAME=%~2"
set /a WAIT_LIMIT=%~3
set /a WAIT_COUNT=0
:wait_for_url_file_loop
if exist "%WAIT_FILE%" (
    set "WAIT_VALUE="
    set /p WAIT_VALUE=<"%WAIT_FILE%"
    if defined WAIT_VALUE exit /b 0
)
call :check_services_running
if errorlevel 1 (
    echo [ERROR] %FAILED_SERVICE_NAME% exited before %WAIT_NAME% published its shutdown URL.
    exit /b 2
)
if !WAIT_COUNT! GEQ !WAIT_LIMIT! (
    echo [ERROR] Timed out waiting for %WAIT_NAME% shutdown URL file: %WAIT_FILE%
    exit /b 1
)
timeout /t 1 /nobreak >nul
set /a WAIT_COUNT+=1
goto :wait_for_url_file_loop

:check_services_running
:: Record the first service command that exits unexpectedly.
if defined FAILED_SERVICE_ID exit /b 1
if defined BRIDGE_PID (
    call :check_service_running "bridge" "Bridge Service" "%BRIDGE_PID%" "%BRIDGE_EXIT_FILE%" "%BRIDGE_LOG_FILE%" "%BRIDGE_LOG_START_LINE%"
    if errorlevel 1 exit /b 1
)
if defined MCP_PID (
    call :check_service_running "mcp" "MCP Server" "%MCP_PID%" "%MCP_EXIT_FILE%" "%MCP_LOG_FILE%" "%MCP_LOG_START_LINE%"
    if errorlevel 1 exit /b 1
)
if defined VOX_PID (
    call :check_service_running "vox" "Vox Agents" "%VOX_PID%" "%VOX_EXIT_FILE%" "%VOX_LOG_FILE%" "%VOX_LOG_START_LINE%"
    if errorlevel 1 exit /b 1
)
exit /b 0

:check_service_running
:: Check the wrapper PID, plus the command-exit marker used by retained windows.
if defined KEEP_OPEN if exist "%~4" goto :record_service_exit
call :is_pid_running "%~3"
if not errorlevel 1 exit /b 0
:record_service_exit
set "FAILED_SERVICE_ID=%~1"
set "FAILED_SERVICE_NAME=%~2"
set "FAILED_SERVICE_LOG=%~5"
set "FAILED_SERVICE_LOG_START_LINE=%~6"
exit /b 1

:print_failed_log_tail
:: Print up to 50 combined log lines written by the failed launch.
echo.
echo ========================================
echo Final log lines from this %FAILED_SERVICE_NAME% launch
echo ========================================
if not defined FAILED_SERVICE_LOG (
    echo [INFO] No log file is configured for this service.
    exit /b 0
)
if not exist "%FAILED_SERVICE_LOG%" (
    echo [INFO] Combined log not found: %FAILED_SERVICE_LOG%
    exit /b 0
)
for %%A in ("%FAILED_SERVICE_LOG%") do if %%~zA EQU 0 (
    echo [INFO] Combined log is empty: %FAILED_SERVICE_LOG%
    exit /b 0
)
set "TAIL_LAST_LINE=0"
for /f %%a in ('find /v /c "" ^< "%FAILED_SERVICE_LOG%"') do set "TAIL_LAST_LINE=%%a"
if !TAIL_LAST_LINE! EQU 0 (
    echo [INFO] Combined log has no readable lines: %FAILED_SERVICE_LOG%
    exit /b 0
)
if !TAIL_LAST_LINE! LEQ !FAILED_SERVICE_LOG_START_LINE! (
    echo [INFO] No new combined log output was written by this launch.
    exit /b 0
)
set /a TAIL_SKIP_LINES=TAIL_LAST_LINE-50
if !TAIL_SKIP_LINES! LSS !FAILED_SERVICE_LOG_START_LINE! set /a TAIL_SKIP_LINES=FAILED_SERVICE_LOG_START_LINE
if !TAIL_SKIP_LINES! LSS 1 (
    find /v "" < "%FAILED_SERVICE_LOG%"
) else (
    more +!TAIL_SKIP_LINES! < "%FAILED_SERVICE_LOG%" | find /v ""
)
exit /b 0

:count_log_lines
:: Record the last readable line so later diagnostics exclude older launches.
set "COUNT_FILE=%~1"
set "COUNT_VARIABLE=%~2"
set "COUNT_LAST_LINE=0"
if exist "%COUNT_FILE%" for /f %%a in ('find /v /c "" ^< "%COUNT_FILE%"') do set "COUNT_LAST_LINE=%%a"
set "%COUNT_VARIABLE%=%COUNT_LAST_LINE%"
exit /b 0

:check_port_free
set "CHECK_PORT=%~1"
set "CHECK_NAME=%~2"
set "CHECK_OWNER_PID="
set "CHECK_OWNER_NAME=unknown"
for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr /r /c:":%CHECK_PORT% .*LISTENING"') do if not defined CHECK_OWNER_PID set "CHECK_OWNER_PID=%%a"
if not defined CHECK_OWNER_PID exit /b 0
for /f "tokens=1 delims=," %%a in ('tasklist /FI "PID eq %CHECK_OWNER_PID%" /FO CSV /NH 2^>nul') do set "CHECK_OWNER_NAME=%%~a"

echo [ERROR] Port %CHECK_PORT% required by %CHECK_NAME% is already in use.
echo [ERROR] Owning process: %CHECK_OWNER_NAME% (PID: %CHECK_OWNER_PID%)
echo [INFO] Stop it manually, then rerun this launcher: taskkill /PID %CHECK_OWNER_PID% /T /F
exit /b 1

:extract_port
set "URL_VALUE=%~1"
set "EXTRACTED_PORT="
set "URL_VALUE=%URL_VALUE:*://=%"
for /f "tokens=1 delims=/" %%a in ("%URL_VALUE%") do set "HOST_PORT=%%a"
for /f "tokens=1,2 delims=:" %%a in ("%HOST_PORT%") do (
    if not "%%b"=="" set "EXTRACTED_PORT=%%b"
)
exit /b 0

:stop_service
set "STOP_NAME=%~1"
set "STOP_PID=%~2"
set "STOP_URL=%~3"
set /a STOP_TIMEOUT=%~4
set "STOP_EXIT_FILE=%~5"

if not defined STOP_PID exit /b 0

if defined KEEP_OPEN if exist "%STOP_EXIT_FILE%" (
    echo        %STOP_NAME% command has exited. Its window remains open for inspection.
    exit /b 0
)

:: Normal windows exit with their wrapper. Retained windows report command exit through a marker.
if defined STOP_URL (
    echo        Requesting graceful shutdown via %STOP_URL%
    curl -s -X POST "%STOP_URL%" >nul 2>&1
    if defined KEEP_OPEN (
        call :wait_for_file "%STOP_EXIT_FILE%" !STOP_TIMEOUT!
    ) else (
        call :wait_for_exit "%STOP_PID%" !STOP_TIMEOUT!
    )
    if not errorlevel 1 (
        echo        %STOP_NAME% stopped gracefully.
        if defined KEEP_OPEN echo        Its command window remains open for inspection.
        exit /b 0
    )
    echo        %STOP_NAME% did not stop gracefully within !STOP_TIMEOUT!s.
) else (
    echo        No shutdown URL published for %STOP_NAME%.
)

echo        Force-killing %STOP_NAME% (PID: %STOP_PID%)...
taskkill /PID %STOP_PID% /T /F >nul 2>&1
call :wait_for_exit "%STOP_PID%" 5 >nul 2>&1
exit /b 0

:wait_for_file
:: Wait for a retained service window to report that its npm command has exited.
set "WAIT_FILE=%~1"
set /a WAIT_LIMIT=%~2
set /a WAIT_COUNT=0
:wait_for_file_loop
if exist "%WAIT_FILE%" exit /b 0
if !WAIT_COUNT! GEQ !WAIT_LIMIT! exit /b 1
timeout /t 1 /nobreak >nul
set /a WAIT_COUNT+=1
goto :wait_for_file_loop

:wait_for_exit
set "WAIT_PID=%~1"
set /a EXIT_LIMIT=%~2
set /a EXIT_COUNT=0
:wait_for_exit_loop
call :is_pid_running "%WAIT_PID%"
if errorlevel 1 exit /b 0
if !EXIT_COUNT! GEQ !EXIT_LIMIT! exit /b 1
timeout /t 1 /nobreak >nul
set /a EXIT_COUNT+=1
goto :wait_for_exit_loop

:is_pid_running
for /f "tokens=2 delims=," %%a in ('tasklist /FI "PID eq %~1" /FO CSV /NH 2^>nul') do (
    if "%%~a"=="%~1" exit /b 0
)
exit /b 1

:cleanup_temp_files
del "%BRIDGE_PID_FILE%" 2>nul
del "%MCP_PID_FILE%" 2>nul
del "%VOX_PID_FILE%" 2>nul
del "%BRIDGE_URL_FILE%" 2>nul
del "%MCP_URL_FILE%" 2>nul
del "%VOX_URL_FILE%" 2>nul
del "%BRIDGE_EXIT_FILE%" 2>nul
del "%MCP_EXIT_FILE%" 2>nul
del "%VOX_EXIT_FILE%" 2>nul
exit /b 0

:find_civ_pid
set "CIV_PID="
for /f "usebackq skip=1 tokens=1,2 delims=," %%a in (`tasklist /FI "IMAGENAME eq CivilizationV.exe" /FO CSV 2^>nul`) do (
    set "CIV_IMAGE=%%~a"
    set "CIV_PID=%%~b"
    goto :find_civ_pid_done
)
:find_civ_pid_done
exit /b 0

:startup_failed
echo [ERROR] Failed to start all services cleanly. Cleaning up...
if defined KEEP_OPEN (
    if defined VOX_PID call :stop_service "Vox Agents" "%VOX_PID%" "%VOX_SHUTDOWN_URL%" %GRACEFUL_STOP_TIMEOUT% "%VOX_EXIT_FILE%"
    if defined MCP_PID call :stop_service "MCP Server" "%MCP_PID%" "%MCP_SHUTDOWN_URL%" %GRACEFUL_STOP_TIMEOUT% "%MCP_EXIT_FILE%"
    if defined BRIDGE_PID call :stop_service "Bridge Service" "%BRIDGE_PID%" "%BRIDGE_SHUTDOWN_URL%" %GRACEFUL_STOP_TIMEOUT% "%BRIDGE_EXIT_FILE%"
) else (
    if defined VOX_PID taskkill /PID %VOX_PID% /T /F >nul 2>&1
    if defined MCP_PID taskkill /PID %MCP_PID% /T /F >nul 2>&1
    if defined BRIDGE_PID taskkill /PID %BRIDGE_PID% /T /F >nul 2>&1
)
call :cleanup_temp_files
endlocal
exit /b 1
