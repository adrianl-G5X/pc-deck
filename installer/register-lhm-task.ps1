# Appele par l'installeur (administrateur) : cree la tache qui lance LibreHardwareMonitor a chaque
# ouverture de session, avec les droits eleves, sans demande a chaque fois. Puis la demarre.
# Methode 1 : fichier XML (tous les utilisateurs du PC). Methode 2 (secours) : l'utilisateur qui installe.
param([string]$App, [string]$User)
$name = 'PC Deck - LibreHardwareMonitor'
$lhmDir = Join-Path $App 'lhm'
try {
  $xml = (Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'lhm-task.xml')).Replace('@APP@', $App)
  Register-ScheduledTask -TaskName $name -Xml $xml -Force -ErrorAction Stop | Out-Null
} catch {
  $action = New-ScheduledTaskAction -Execute (Join-Path $lhmDir 'LibreHardwareMonitor.exe') -WorkingDirectory $lhmDir
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$User" -LogonType Interactive -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
}
Start-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
