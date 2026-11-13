# FPS en jeu : installe RivaTuner Statistics Server (RTSS) et le lance a chaque ouverture de session.
# ASCII uniquement (lu par PowerShell 5.1).
#   -Step status   affiche : missing (pas installe) | off (installe, arrete) | on (tourne)
#   -Step start    lance la tache planifiee (sans droits admin)
#   -Step install  (administrateur) installe RTSS avec winget (empreinte verifiee par winget), cree la tache
#                  "PC Deck - RivaTuner" (ouverture de session de -User, droits eleves, sans demande) et la lance
# RTSS seul suffit : il mesure les images par seconde ; rien ne s'affiche dans les jeux (pas d'Afterburner).
param([ValidateSet('status', 'start', 'install')][string]$Step = 'status', [string]$User = $env:USERNAME, [string]$Out = '')
$ErrorActionPreference = 'Stop'
$task = 'PC Deck - RivaTuner'

function Find-Rtss {
  foreach ($d in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
    if ($d) { $p = Join-Path $d 'RivaTuner Statistics Server\RTSS.exe'; if (Test-Path $p) { return $p } }
  }
}

switch ($Step) {
  'status' {
    if (-not (Find-Rtss)) { 'missing' } elseif (Get-Process RTSS -ErrorAction SilentlyContinue) { 'on' } else { 'off' }
  }
  'start' {
    try { Start-ScheduledTask -TaskName $task; 'ok' } catch { "echec: $($_.Exception.Message)" }
  }
  'install' {
    $res = try {
      if (-not (Find-Rtss)) {
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if (-not $winget) { throw 'winget absent (Microsoft Store : "Programme d''installation d''application")' }
        & $winget.Source install --id Guru3D.RTSS -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Null
        if (-not (Find-Rtss)) { throw "installation de RivaTuner echouee (winget : $LASTEXITCODE)" }
      }
      $exe = Find-Rtss
      $action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory (Split-Path $exe)
      $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:COMPUTERNAME\$User"
      $principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$User" -LogonType Interactive -RunLevel Highest
      $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
      Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
      if (-not (Get-Process RTSS -ErrorAction SilentlyContinue)) { Start-ScheduledTask -TaskName $task }
      'ok'
    } catch { "echec: $($_.Exception.Message)" }
    if ($Out) { Set-Content -Path $Out -Value $res -Encoding ASCII } # lance en administrateur (fenetre a part) : le resultat passe par ce fichier
    $res
  }
}
exit 0
