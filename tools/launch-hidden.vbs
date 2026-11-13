' Lance PC Deck en arriere-plan, sans aucune fenetre (icone dans la zone de notification).
' Ecrit une ligne dans %LOCALAPPDATA%\PC Deck\demarrage.log pour savoir jusqu'ou le demarrage est alle.
On Error Resume Next
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
data = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\PC Deck"
If Not fso.FolderExists(data) Then fso.CreateFolder data
Set jrn = fso.OpenTextFile(data & "\demarrage.log", 8, True)
jrn.WriteLine Now & " [vbs] lance depuis " & folder
sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & folder & "\tray.ps1""", 0, False
jrn.WriteLine Now & " [vbs] powershell lance, erreur=" & Err.Number & " " & Err.Description
jrn.Close
