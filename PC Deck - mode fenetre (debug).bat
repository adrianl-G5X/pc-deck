@echo off
rem ============================================================
rem  PC Deck en MODE FENETRE (pour voir les messages / depanner).
rem  Arrete PC Deck en arriere-plan (icone) s'il tourne, puis lance
rem  le serveur dans cette fenetre. Fermer la fenetre = arreter.
rem  Pour l'usage normal, utilise plutot "Lancer PC Deck.bat".
rem ============================================================
chcp 65001 >nul
title PC Deck - serveur (debug)
cd /d "%~dp0"

echo Arret de PC Deck en arriere-plan (s'il tourne)...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*tools\tray.ps1*') -or ($_.Name -eq 'node.exe' -and ($_.CommandLine -like '*server/server.js*' -or $_.CommandLine -like '*server\server.js*')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('  arrete : ' + $_.Name + ' (PID ' + $_.ProcessId + ')') }"

powershell -NoProfile -Command "if (-not (Get-Process LibreHardwareMonitor -ErrorAction SilentlyContinue)) { Write-Host ''; Write-Host '  ATTENTION : LibreHardwareMonitor n''est pas lance.' -ForegroundColor Yellow }"

if not exist "node_modules\ws" (
  echo.
  echo Premiere installation des dependances...
  call npm.cmd install
)

echo.
call npm.cmd start

echo.
echo Le serveur s'est arrete. Appuie sur une touche pour fermer cette fenetre.
pause >nul
