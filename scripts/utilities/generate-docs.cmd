@echo off
REM Generate TypeDoc documentation for all TypeScript modules

echo Generating documentation for bridge-service...
cd /d "%~dp0\..\..\bridge-service"
call npm run docs
if %errorlevel% neq 0 (
    echo Failed to generate bridge-service docs
    exit /b %errorlevel%
)

echo.
echo Generating documentation for mcp-server...
cd /d "%~dp0\..\..\mcp-server"
call npm run docs
if %errorlevel% neq 0 (
    echo Failed to generate mcp-server docs
    exit /b %errorlevel%
)

echo.
echo Generating documentation for vox-agents...
cd /d "%~dp0\..\..\vox-agents"
call npm run docs
if %errorlevel% neq 0 (
    echo Failed to generate vox-agents docs
    exit /b %errorlevel%
)

echo.
echo Documentation generation complete!
cd /d "%~dp0\..\.."
