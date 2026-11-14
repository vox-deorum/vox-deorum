@echo off
setlocal

set "CLEAR_CACHE=0"
set "INSTALL_ARGS="

:: Consume update options and keep the installer options in their original order.
:parse_arguments
if "%~1"=="" goto :arguments_parsed
if /i "%~1"=="--clear-cache" (
    set "CLEAR_CACHE=1"
    shift
    goto :parse_arguments
)
if /i "%~1"=="--debug" (
    set "INSTALL_ARGS=%INSTALL_ARGS% --debug"
    shift
    goto :parse_arguments
)
if /i "%~1"=="--line" goto :parse_line
goto :usage

:parse_line
set "LINE_VALUE=%~2"
if not defined LINE_VALUE goto :usage
if "%LINE_VALUE:~0,2%"=="--" goto :usage
set "INSTALL_ARGS=%INSTALL_ARGS% --line "%LINE_VALUE%""
shift
shift
goto :parse_arguments

:arguments_parsed
if "%CLEAR_CACHE%"=="1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0maintenance\clear-ai-cache.ps1"
    if errorlevel 1 exit /b 1
)

call cleanup-data

call cleanup-logs

set "VD_PROJECT_ROOT=%~dp0.."
set "PATH=%VD_PROJECT_ROOT%\node;%PATH%"

:: Checkout and pull can rewrite this file, so cmd must parse every remaining step first.
(
    git checkout main --force

    git pull

    git submodule update

    cd scripts

    rem Use the same runtime as the launcher and enforce the updated checkout's minimum.
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "try {" ^
    "  $root = (Resolve-Path -LiteralPath $env:VD_PROJECT_ROOT).Path;" ^
    "  $requirement = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).engines.node;" ^
    "  if ($requirement -notmatch '^>=(\d+\.\d+\.\d+)$') { throw 'Unsupported Node.js minimum in package.json.' };" ^
    "  $minimum = [version]$Matches[1];" ^
    "  $node = Get-Command node.exe -ErrorAction SilentlyContinue;" ^
    "  $current = if ($node) { & $node.Source --version 2>$null };" ^
    "  if ($current -match '^v(\d+\.\d+\.\d+)$' -and [version]$Matches[1] -ge $minimum) {" ^
    "    Write-Host ('[OK] Node.js ' + $current + ' meets the minimum ' + $minimum); exit 0;" ^
    "  };" ^
    "  Write-Host ('Installing portable Node.js ' + $minimum + ' (current: ' + $current + ')...');" ^
    "  $tempDir = Join-Path ([IO.Path]::GetTempPath()) ('VoxDeorumNode-' + [guid]::NewGuid());" ^
    "  New-Item -ItemType Directory -Path $tempDir | Out-Null;" ^
    "  try {" ^
    "    $archive = Join-Path $tempDir 'node.zip';" ^
    "    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;" ^
    "    Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/v' + $minimum + '/node-v' + $minimum + '-win-x64.zip') -OutFile $archive;" ^
    "    Expand-Archive -LiteralPath $archive -DestinationPath $tempDir;" ^
    "    $source = Join-Path $tempDir ('node-v' + $minimum + '-win-x64');" ^
    "    $downloaded = & (Join-Path $source 'node.exe') --version;" ^
    "    if ($LASTEXITCODE -ne 0 -or $downloaded -ne ('v' + $minimum)) { throw 'Downloaded Node.js failed verification.' };" ^
    "    $destination = Join-Path $root 'node';" ^
    "    New-Item -ItemType Directory -Path $destination -Force | Out-Null;" ^
    "    Get-ChildItem -LiteralPath $source | Copy-Item -Destination $destination -Recurse -Force;" ^
    "    $installed = & (Join-Path $destination 'node.exe') --version;" ^
    "    if ($LASTEXITCODE -ne 0 -or $installed -ne ('v' + $minimum)) { throw 'Installed Node.js failed verification.' };" ^
    "    Write-Host ('[OK] Portable Node.js ' + $installed + ' installed.');" ^
    "  } finally { Remove-Item -LiteralPath $tempDir -Recurse -Force };" ^
    "} catch { Write-Host ('Error: ' + $_.Exception.Message); exit 1 }"
    if errorlevel 1 exit /b 1

    call install %INSTALL_ARGS%
    if errorlevel 1 exit /b 1
    exit /b 0
)

:usage
echo Usage: manual-update.cmd [--clear-cache] [--line X.Y] [--debug]
exit /b 1
