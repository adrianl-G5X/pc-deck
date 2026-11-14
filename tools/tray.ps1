# PC Deck en arrière-plan, avec une icône dans la zone de notification (à côté de l'horloge).
# - lance le serveur sans fenêtre, et le relance tout seul s'il s'arrête
# - clic droit sur l'icône : ouvrir, code d'appairage, journal, redémarrer, quitter
# Lancé par "Lancer PC Deck.bat" (via tools\launch-hidden.vbs) ou au démarrage de Windows.

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$ErrorActionPreference = 'SilentlyContinue'

$root = Split-Path $PSScriptRoot -Parent
$dataDir = if ($env:PCDECK_DATA) { $env:PCDECK_DATA } else { Join-Path $env:LOCALAPPDATA 'PC Deck' }
New-Item -ItemType Directory -Force $dataDir | Out-Null
# Journal de démarrage (diagnostic : voir ce qui a tourné). Mode de langage "ConstrainedLanguage" = Windows restreint les scripts non signés.
$bootLog = Join-Path $dataDir 'demarrage.log'
function Write-Boot($m) { try { "$(Get-Date) [tray] $m" | Add-Content -Path $bootLog -Encoding UTF8 } catch {} }
# Une erreur dans un minuteur ou un clic ne doit jamais afficher la fenetre technique de .NET : notee dans le journal
try { [System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException) } catch {}
[System.Windows.Forms.Application]::add_ThreadException({ param($s, $e) Write-Boot "erreur: $($e.Exception.Message)" })

# Ouvre une page dans le navigateur, sans jamais planter (association http cassee, navigateur desinstalle...)
function Open-Url($url) {
  try { Start-Process $url -ErrorAction Stop; return } catch { Write-Boot "ouverture ($url): $($_.Exception.Message)" }
  try { Start-Process explorer.exe -ArgumentList "`"$url`"" -ErrorAction Stop; return } catch {}
  try { $tray.ShowBalloonTip(10000, 'PC Deck', "Le navigateur ne s'ouvre pas. Ouvre toi-meme : $url", 'Warning') } catch {}
}
Write-Boot "demarre, langage=$($ExecutionContext.SessionState.LanguageMode), dossier=$root"
trap { Write-Boot "ERREUR: $($_.Exception.Message)"; continue }
$serverJs = Join-Path $root 'server\server.js'
$logOut = Join-Path $dataDir 'server.log'
$logErr = Join-Path $dataDir 'server-erreurs.log'

# ---------- Une seule instance : arrête l'ancien serveur et l'ancienne icône ----------
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains("$PSScriptRoot\tray.ps1") -and $_.ProcessId -ne $PID } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
function Stop-Server {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($serverJs) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}
Stop-Server

# ---------- Serveur ----------
$script:server = $null
$script:quitting = $false
# Installe : Node.js fourni (runtime\node.exe). Dossier de developpement : celui de la machine.
$bundledNode = Join-Path $root 'runtime\node.exe'
$node = if (Test-Path $bundledNode) { $bundledNode } else { (Get-Command node).Source }

function Start-Server {
  if (-not (Test-Path $bundledNode) -and -not (Test-Path (Join-Path $root 'node_modules\ws'))) {
    Start-Process -FilePath 'npm.cmd' -ArgumentList 'install' -WorkingDirectory $root -WindowStyle Hidden -Wait
  }
  # Aucune console du tout (CreateNoWindow) : sous Windows 11 avec Windows Terminal, -WindowStyle Hidden laisse parfois apparaitre une fenetre
  $psi = New-Object System.Diagnostics.ProcessStartInfo 'cmd.exe', ('/c ""{0}" "{1}" >"{2}" 2>"{3}""' -f $node, $serverJs, $logOut, $logErr)
  $psi.WorkingDirectory = $root; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $script:server = [System.Diagnostics.Process]::Start($psi)
  Write-Boot "serveur lance: $node (pid $($script:server.Id))"
}

# Réseaux en "Public" (hors Tailscale) : Windows y bloque PC Deck
function Get-PublicNetworks {
  try {
    Get-NetConnectionProfile -ErrorAction Stop |
      Where-Object { $_.NetworkCategory -eq 'Public' -and $_.InterfaceAlias -notmatch 'Tailscale' } |
      ForEach-Object { $_.InterfaceAlias }
  } catch {}
}

# Port du serveur (config.json), 8787 par défaut
function Get-Port {
  try { $p = (Get-Content (Join-Path $dataDir 'config.json') -Raw | ConvertFrom-Json).server.port; if ($p) { return $p } } catch {}
  return 8787
}
# Page « Connecter un appareil » : QR codes et code d'appairage à usage unique
function Open-Connect { Open-Url ("http://localhost:{0}/connect" -f (Get-Port)) }

# ---------- Icône ----------
$bmp = New-Object System.Drawing.Bitmap (Join-Path $root 'client\icons\icon-192.png')
$small = New-Object System.Drawing.Bitmap $bmp, 32, 32
$icon = [System.Drawing.Icon]::FromHandle($small.GetHicon())

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icon
$tray.Text = 'PC Deck - en marche'
$tray.Visible = $true
Write-Boot 'icone creee'

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$version = try { (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version } catch { '?' }
$itemVersion = $menu.Items.Add("PC Deck $version")
$itemVersion.Enabled = $false
$itemConnect = $menu.Items.Add('Connecter une tablette ou un téléphone...')
$itemConnect.Font = New-Object System.Drawing.Font($itemConnect.Font, [System.Drawing.FontStyle]::Bold)
$itemNet = $menu.Items.Add('Réseau « Public » : autoriser la tablette...')
$itemNet.Visible = $false
$itemUpdate = $menu.Items.Add('Installer la mise à jour')
$itemUpdate.Visible = $false
$itemRemote = $menu.Items.Add('Accès hors de chez toi...')
$itemLhm = $menu.Items.Add('Températures : réparer...')
$itemLhm.Visible = $false
[void]$menu.Items.Add('-')
$itemSettings = $menu.Items.Add('Paramètres...')
$itemOpen = $menu.Items.Add('Ouvrir PC Deck')
$itemLog = $menu.Items.Add('Voir le journal')
$itemRestart = $menu.Items.Add('Redémarrer le serveur')
[void]$menu.Items.Add('-')
$itemQuit = $menu.Items.Add('Quitter PC Deck')
$tray.ContextMenuStrip = $menu

# ---------- Accès hors de chez soi (Tailscale) ----------
# Le script est dans tools\ (installé) ou installer\ (dossier de développement)
$tsScript = @((Join-Path $root 'tools\setup-tailscale.ps1'), (Join-Path $root 'installer\setup-tailscale.ps1')) | Where-Object { Test-Path $_ } | Select-Object -First 1
function Get-RemoteState {
  if (-not $tsScript) { return 'none' }
  try { return ((& powershell -NoProfile -ExecutionPolicy Bypass -File $tsScript -Step status) | Select-Object -First 1) } catch { return 'none' }
}
$script:remoteState = 'none'
$menu.add_Opening({
  $itemNet.Visible = (@(Get-PublicNetworks).Count -gt 0)
  $script:remoteState = Get-RemoteState
  $itemRemote.Visible = $script:remoteState -ne 'none'
  if ($script:remoteState -like 'on:*') { $itemRemote.Text = "Accès hors de chez toi : activé ($($script:remoteState.Substring(3)))"; $itemRemote.Enabled = $false }
  elseif ($script:remoteState -eq 'login') { $itemRemote.Text = 'Accès hors de chez toi : se connecter à Tailscale...'; $itemRemote.Enabled = $true }
  else { $itemRemote.Text = 'Accès hors de chez toi : installer Tailscale...'; $itemRemote.Enabled = $true }
})
$itemRemote.add_Click({
  if ($script:remoteState -eq 'missing') {
    $a = [System.Windows.Forms.MessageBox]::Show("Installer Tailscale (gratuit) pour utiliser PC Deck hors de chez toi ?`n`nTailscale est un réseau privé chiffré entre TES appareils. Windows va demander l'autorisation.", 'PC Deck', 'YesNo', 'Question')
    if ($a -ne 'Yes') { return }
    $tray.ShowBalloonTip(5000, 'PC Deck', 'Installation de Tailscale...', 'Info')
    try { Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$tsScript`"", '-Step', 'install' } catch { return }
  }
  # Page de connexion Tailscale (en arrière-plan : le script attend que tu aies fini)
  Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$tsScript`"", '-Step', 'login'
  Open-Url ("http://localhost:{0}/connect#remote" -f (Get-Port))
})
# Passe en "Privé" les réseaux en "Public" (demande l'autorisation administrateur de Windows)
$itemNet.add_Click({
  $names = @(Get-PublicNetworks)
  if (-not $names.Count) { return }
  $answer = [System.Windows.Forms.MessageBox]::Show(
    "Votre réseau est de type « Public » : $($names -join ', ').`n`nWindows y bloque PC Deck, la tablette ne peut pas se connecter.`n`nS'il s'agit du réseau de votre maison, le passer en « Privé » ?`nRépondez Non sur un Wi-Fi public (café, gare, hôtel...).",
    'PC Deck', 'YesNo', 'Question')
  if ($answer -ne 'Yes') { return }
  $list = ($names | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ','
  try {
    Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile', '-Command', "Set-NetConnectionProfile -InterfaceAlias $list -NetworkCategory Private"
  } catch { return } # autorisation refusée
  if (-not @(Get-PublicNetworks).Count) { $tray.ShowBalloonTip(3000, 'PC Deck', 'Réseau passé en Privé : la tablette peut se connecter.', 'Info') }
})
$itemConnect.add_Click({ Open-Connect })

# ---------- Mises à jour (vérifiées par le serveur sur GitHub, signées) ----------
$script:notified = ''
function Check-Update {
  try {
    $u = Invoke-RestMethod ("http://localhost:{0}/api/update" -f (Get-Port)) -TimeoutSec 5
    if ($u.available) {
      $itemUpdate.Text = "Installer la mise à jour $($u.latest)"
      $itemUpdate.Visible = $true
      if ($script:notified -ne $u.latest) {
        $script:notified = $u.latest
        $tray.ShowBalloonTip(10000, 'PC Deck', "Nouvelle version $($u.latest) disponible. Clic droit sur l'icône PC Deck pour l'installer.", 'Info')
      }
    } else { $itemUpdate.Visible = $false }
  } catch {}
}
$itemUpdate.add_Click({
  $answer = [System.Windows.Forms.MessageBox]::Show(
    "Installer la nouvelle version de PC Deck ?`n`nTes réglages et tes appareils sont gardés. Windows va demander l'autorisation, puis PC Deck redémarrera tout seul.",
    'PC Deck', 'YesNo', 'Question')
  if ($answer -ne 'Yes') { return }
  $tray.ShowBalloonTip(5000, 'PC Deck', 'Téléchargement de la mise à jour...', 'Info')
  try { Invoke-RestMethod -Method Post ("http://localhost:{0}/api/update/install" -f (Get-Port)) -TimeoutSec 900 | Out-Null }
  catch { [System.Windows.Forms.MessageBox]::Show("La mise à jour n'a pas pu être installée :`n$($_.ErrorDetails.Message)", 'PC Deck') | Out-Null }
})
$itemSettings.add_Click({ Open-Url ("http://localhost:{0}/settings" -f (Get-Port)) })
$itemOpen.add_Click({ Open-Url ("http://localhost:{0}" -f (Get-Port)) })
$tray.add_DoubleClick({ Open-Url ("http://localhost:{0}" -f (Get-Port)) })
$itemLog.add_Click({ try { Start-Process notepad.exe -ArgumentList "`"$logOut`"" } catch {} })
$itemRestart.add_Click({
  Stop-Server
  Start-Sleep -Milliseconds 500
  Start-Server
  $tray.ShowBalloonTip(2000, 'PC Deck', 'Serveur redémarré.', 'Info')
})
$itemQuit.add_Click({
  $script:quitting = $true
  Stop-Server
  $tray.Visible = $false
  $tray.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

# ---------- Surveillance : relance si le serveur s'arrête tout seul ----------
$watch = New-Object System.Windows.Forms.Timer
$watch.Interval = 3000
$watch.add_Tick({
  if (-not $script:quitting -and ($null -eq $script:server -or $script:server.HasExited)) {
    $tray.Text = 'PC Deck - redémarrage...'
    Start-Server
    $tray.Text = 'PC Deck - en marche'
  }
})

# ---------- Demarrage avec Windows ----------
# Reglage "autostart" de config.json : true = lance PC Deck a l'ouverture de session de cet utilisateur,
# false = ne le fait plus. Absent = on ne touche a rien.
try {
  $cfgFile = Join-Path $dataDir 'config.json'
  if (-not (Test-Path $cfgFile)) { $cfgFile = Join-Path $root 'config.default.json' }
  $auto = (Get-Content $cfgFile -Raw | ConvertFrom-Json).autostart
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  if ($auto -eq $true) { Set-ItemProperty $runKey -Name 'PCDeck' -Value "wscript.exe `"$PSScriptRoot\launch-hidden.vbs`"" }
  elseif ($auto -eq $false) { Remove-ItemProperty $runKey -Name 'PCDeck' -ErrorAction SilentlyContinue }
} catch {}

Start-Server
$watch.Start()

# Vérifie les mises à jour 2 minutes après le démarrage, puis toutes les heures
$updTimer = New-Object System.Windows.Forms.Timer
$updTimer.Interval = 2 * 60 * 1000
$updTimer.add_Tick({ $updTimer.Interval = 60 * 60 * 1000; Check-Update })
$updTimer.Start()

# ---------- LibreHardwareMonitor (températures) : relancé s'il ne tourne pas ----------
# Installé : lancé par la tâche planifiée « PC Deck - LibreHardwareMonitor » (droits élevés, sans demande).
# S'il manque, on relance la tâche ; si la tâche est absente ou ne marche pas, le menu propose
# « Températures : réparer... » qui la recrée (Windows demande l'autorisation une fois).
$lhmExe = Join-Path $root 'lhm\LibreHardwareMonitor.exe'
$lhmTask = 'PC Deck - LibreHardwareMonitor'
$script:lhmTries = 0
function Ensure-Lhm {
  if (-not (Test-Path $lhmExe)) { return }                     # dossier de développement : LHM lancé à la main
  if (Get-Process LibreHardwareMonitor -ErrorAction SilentlyContinue) { $itemLhm.Visible = $false; $script:lhmTries = 0; return }
  $script:lhmTries++
  try { Start-ScheduledTask -TaskName $lhmTask -ErrorAction Stop } catch { $script:lhmTries = 99 }
  if ($script:lhmTries -ge 3 -and -not $itemLhm.Visible) {
    $itemLhm.Visible = $true
    $tray.ShowBalloonTip(10000, 'PC Deck', "Les températures ne démarrent pas. Clic droit sur l'icône PC Deck : « Températures : réparer... ».", 'Warning')
  }
}
$itemLhm.add_Click({
  $script_ = Join-Path $root 'tools\register-lhm-task.ps1'
  try {
    Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$script_`"", '-App', "`"$root`"", '-User', $env:USERNAME
  } catch { return } # autorisation refusée
  Start-Sleep 5
  $script:lhmTries = 0
  if (Get-Process LibreHardwareMonitor -ErrorAction SilentlyContinue) {
    $itemLhm.Visible = $false
    $tray.ShowBalloonTip(4000, 'PC Deck', 'Températures réparées.', 'Info')
  } else {
    [System.Windows.Forms.MessageBox]::Show("LibreHardwareMonitor ne démarre toujours pas.`n`nEssaie de le lancer à la main :`n$lhmExe`net note le message qui s'affiche.", 'PC Deck') | Out-Null
  }
})
$lhmTimer = New-Object System.Windows.Forms.Timer
$lhmTimer.Interval = 60 * 1000
$lhmTimer.add_Tick({ Ensure-Lhm })
$lhmTimer.Start()
Ensure-Lhm

# Aucun appareil encore connecté (juste après l'installation) : assistant de premier lancement
$devices = @()
try { $devices = @(Get-Content (Join-Path $dataDir 'devices.json') -Raw | ConvertFrom-Json) } catch {}
if (-not $devices.Count) {
  $first = New-Object System.Windows.Forms.Timer
  $first.Interval = 5000
  $first.add_Tick({ $first.Stop(); Open-Url ("http://localhost:{0}/settings#bienvenue" -f (Get-Port)) }) # assistant : tablette, boutons, theme
  $first.Start()
}

if (@(Get-PublicNetworks).Count) {
  $tray.ShowBalloonTip(8000, 'PC Deck',
    "Réseau de type « Public » : la tablette ne peut pas se connecter. Clic droit sur l'icône PC Deck pour corriger.", 'Warning')
} elseif (-not (Get-Process LibreHardwareMonitor)) {
  $tray.ShowBalloonTip(5000, 'PC Deck',
    "LibreHardwareMonitor n'est pas lancé : températures et consommation indisponibles.", 'Warning')
} else {
  $tray.ShowBalloonTip(2500, 'PC Deck', 'PC Deck tourne en arrière-plan (icône près de l''horloge).', 'Info')
}

[System.Windows.Forms.Application]::Run()
