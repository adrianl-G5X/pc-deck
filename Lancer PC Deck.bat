@echo off
rem ============================================================
rem  PC Deck : (re)lance le serveur EN ARRIERE-PLAN.
rem  Aucune fenetre a garder ouverte : une icone apparait dans la
rem  zone de notification (a cote de l'horloge).
rem  Clic droit sur l'icone : ouvrir, code d'appairage, journal,
rem  redemarrer, quitter.
rem  Pour voir les messages du serveur : "PC Deck - mode fenetre (debug).bat"
rem ============================================================
cd /d "%~dp0"
wscript.exe "%~dp0tools\launch-hidden.vbs"
