@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-new-release.ps1" %*
exit /b %ERRORLEVEL%
