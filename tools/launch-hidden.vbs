' Lance PC Deck en arriere-plan, sans aucune fenetre (icone dans la zone de notification).
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & folder & "\tray.ps1""", 0, False
