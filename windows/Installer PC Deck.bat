@echo off
rem Double-clic pour installer PC Deck sur cet ordinateur (pour piloter le PC principal).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer.ps1"
pause
