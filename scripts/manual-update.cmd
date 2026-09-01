@echo off
setlocal

call cleanup-data

call cleanup-logs

git checkout main --force

git pull

git submodule update

cd scripts

call install %*
exit /b %errorlevel%
