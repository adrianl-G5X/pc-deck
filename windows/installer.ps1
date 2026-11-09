# Installe l'appli PC Deck sur un AUTRE PC Windows (pour piloter le PC principal).
# Crée une appli dans sa propre fenêtre (Microsoft Edge en mode application),
# avec son icône sur le Bureau et dans le menu Démarrer.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$defaultIp = '192.168.1.24'

Write-Host ''
Write-Host '=== Installation de PC Deck (contrôle du PC principal) ===' -ForegroundColor Cyan
$ip = Read-Host "Adresse du PC principal (Entrée = $defaultIp)"
if ([string]::IsNullOrWhiteSpace($ip)) { $ip = $defaultIp }
$ip = $ip.Trim()
if ($ip -notmatch ':') { $ip = "${ip}:8787" }
$url = "http://$ip/"

# Le PC principal répond-il ?
try {
  Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 4 | Out-Null
  Write-Host "PC principal trouvé : $url" -ForegroundColor Green
} catch {
  Write-Host "Attention : $url ne répond pas pour l'instant (PC éteint, autre réseau ?). L'installation continue." -ForegroundColor Yellow
}

# Microsoft Edge (présent sur tous les Windows 10/11)
$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge introuvable.' }

# Dossier de l'appli + icône (.ico fabriquée à partir de l'image PNG)
$dest = Join-Path $env:LOCALAPPDATA 'PC Deck'
New-Item -ItemType Directory -Force $dest | Out-Null
$png = [IO.File]::ReadAllBytes((Join-Path $here 'pcdeck.png'))
$ico = New-Object IO.MemoryStream
$w = New-Object IO.BinaryWriter $ico
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)          # en-tête : 1 image
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0) # 256x256 max, PNG
$w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$png.Length); $w.Write([uint32]22)
$w.Write($png); $w.Flush()
[IO.File]::WriteAllBytes((Join-Path $dest 'pcdeck.ico'), $ico.ToArray())

# Profil séparé : l'appli a sa propre fenêtre et son icône dans la barre des tâches
$profileDir = Join-Path $dest 'profil'
$edgeArgs = "--app=$url --user-data-dir=`"$profileDir`" --no-first-run --window-size=1400,860"

$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) {
  $lnk = $shell.CreateShortcut((Join-Path $folder 'PC Deck.lnk'))
  $lnk.TargetPath = $edge
  $lnk.Arguments = $edgeArgs
  $lnk.IconLocation = (Join-Path $dest 'pcdeck.ico')
  $lnk.Description = 'PC Deck - piloter le PC principal'
  $lnk.Save()
}

Write-Host ''
Write-Host 'Installé ! Icône « PC Deck » sur le Bureau et dans le menu Démarrer.' -ForegroundColor Green
Write-Host "Au premier lancement, tape le code d'appairage affiché sur le PC principal."
Start-Process $edge $edgeArgs
