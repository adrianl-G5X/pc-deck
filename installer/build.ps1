# Fabrique l'installeur PC : dist\PCDeck-Setup-<version>.exe
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1
# Options : -SkipApk (garde l'APK deja construit)  -StageOnly (prepare dist\stage sans compiler l'installeur)
#           -Compiled : programmes compilés (.exe) au lieu des scripts PowerShell. À n'utiliser qu'avec une
#           signature de code : sans elle, le « Contrôle intelligent des applications » de Windows 11 les bloque.
# Ce qu'il faut sur la machine qui construit : Node + npm, Inno Setup 6 (winget install JRSoftware.InnoSetup),
# et pour l'APK : Java 17 + Android SDK (voir android\build.ps1).
param([switch]$SkipApk, [switch]$StageOnly, [switch]$Compiled)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- Versions des composants fournis (epinglees : chaque telechargement est verifie par empreinte SHA-256) ----
$NODE_VERSION = '24.22.2'
$NODE_SHA256  = 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2'
$LHM_VERSION  = '0.9.6'
$LHM_SHA256   = '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001'
$PAWNIO_VERSION = '2.2.0'
$PAWNIO_SHA256  = '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032'

$root  = Split-Path $PSScriptRoot -Parent
$dist  = Join-Path $root 'dist'
$cache = Join-Path $dist 'cache'
$stage = Join-Path $dist 'stage'
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Force $cache | Out-Null
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
Write-Host "=== PC Deck $version ===" -ForegroundColor Cyan

function Get-Verified($url, $sha256, $name) {
  $file = Join-Path $cache $name
  if (-not (Test-Path $file) -or (Get-FileHash $file -Algorithm SHA256).Hash -ne $sha256.ToUpper()) {
    Write-Host "  telechargement : $name"
    Invoke-WebRequest $url -OutFile $file -UseBasicParsing
  }
  if ((Get-FileHash $file -Algorithm SHA256).Hash -ne $sha256.ToUpper()) { throw "Empreinte SHA-256 incorrecte : $name" }
  return $file
}
function Copy-Tree($from, $to, [string[]]$excludeFiles = @()) {
  & robocopy $from $to /E /NFL /NDL /NJH /NJS /NP /XF @excludeFiles | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copie impossible : $from" }
  $global:LASTEXITCODE = 0
}

# ---- 1. Le programme ----
Write-Host '1/6 Programme...'
Copy-Tree (Join-Path $root 'server') (Join-Path $stage 'server') @('*.test.js')
Copy-Tree (Join-Path $root 'client') (Join-Path $stage 'client')
Copy-Tree (Join-Path $root 'extension') (Join-Path $stage 'extension')
New-Item -ItemType Directory -Force (Join-Path $stage 'tools') | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'lhm-task.xml'), (Join-Path $PSScriptRoot 'register-lhm-task.ps1'), (Join-Path $PSScriptRoot 'setup-tailscale.ps1'), (Join-Path $PSScriptRoot 'setup-rtss.ps1') (Join-Path $stage 'tools')
if (-not $Compiled) { Copy-Item (Join-Path $root 'tools\tray.ps1'), (Join-Path $root 'tools\launch-hidden.vbs') (Join-Path $stage 'tools') }
Copy-Item (Join-Path $root 'config.default.json'), (Join-Path $root 'templates.json'), (Join-Path $root 'package.json'), (Join-Path $root 'package-lock.json') $stage
Push-Location $stage
try { & npm ci --omit=dev --ignore-scripts --no-audit --no-fund 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'npm ci a echoue' } } finally { Pop-Location }

# ---- 2. Node.js ----
Write-Host '2/6 Node.js...'
$nodeZip = Get-Verified "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip" $NODE_SHA256 "node-v$NODE_VERSION-win-x64.zip"
$nodeTmp = Join-Path $cache "node-$NODE_VERSION"
if (-not (Test-Path $nodeTmp)) { Expand-Archive $nodeZip $nodeTmp -Force }
$nodeDir = Join-Path $nodeTmp "node-v$NODE_VERSION-win-x64"
New-Item -ItemType Directory -Force (Join-Path $stage 'runtime') | Out-Null
Copy-Item (Join-Path $nodeDir 'node.exe'), (Join-Path $nodeDir 'LICENSE') (Join-Path $stage 'runtime')

# ---- 3. LibreHardwareMonitor (temperatures, consommation) ----
Write-Host '3/6 LibreHardwareMonitor...'
$lhmZip = Get-Verified "https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v$LHM_VERSION/LibreHardwareMonitor.zip" $LHM_SHA256 "LibreHardwareMonitor-$LHM_VERSION.zip"
$lhmDir = Join-Path $stage 'lhm'
Expand-Archive $lhmZip $lhmDir -Force
# Reglages : demarre reduit, serveur web active. (LHM 0.9.6 ignore listenerIp et ecoute sur tout : c'est le
# pare-feu (regle ajoutee par l'installeur) qui ferme le port 8085 au reseau.)
@'
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <appSettings>
    <add key="startMinMenuItem" value="true" />
    <add key="minTrayMenuItem" value="true" />
    <add key="minCloseMenuItem" value="true" />
    <add key="runWebServerMenuItem" value="true" />
    <add key="listenerPort" value="8085" />
    <add key="authenticationEnabled" value="false" />
  </appSettings>
</configuration>
'@ | Set-Content -Encoding UTF8 (Join-Path $lhmDir 'LibreHardwareMonitor.config')

# ---- 4. Pilote PawnIO (necessaire a LibreHardwareMonitor pour lire les capteurs du processeur) ----
Write-Host '4/6 Pilote PawnIO...'
$pawn = Get-Verified "https://github.com/namazso/PawnIO.Setup/releases/download/$PAWNIO_VERSION/PawnIO_setup.exe" $PAWNIO_SHA256 "PawnIO_setup-$PAWNIO_VERSION.exe"
New-Item -ItemType Directory -Force (Join-Path $stage 'pawnio') | Out-Null
Copy-Item $pawn (Join-Path $stage 'pawnio\PawnIO_setup.exe')

# ---- 5. Application Android (distribuee par le PC, voir etape 2) ----
Write-Host '5/6 Application Android...'
if (-not $SkipApk) { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'android\build.ps1'); if ($LASTEXITCODE -ne 0) { throw 'Construction de l''APK echouee' } }
$apk = Join-Path $root 'android\PC-Deck.apk'
if (-not (Test-Path $apk)) { throw "APK introuvable : $apk (retire -SkipApk)" }
New-Item -ItemType Directory -Force (Join-Path $stage 'tablet') | Out-Null
Copy-Item $apk (Join-Path $stage 'tablet\PC-Deck.apk')
if (-not (Test-Path "$apk.json")) { throw "Numéro de version de l'APK introuvable : reconstruis-le (retire -SkipApk)" }
Copy-Item "$apk.json" (Join-Path $stage 'tablet\PC-Deck.apk.json')

# ---- Licences ----
@"
PC Deck $version - composants tiers fournis avec l'installeur

Node.js $NODE_VERSION (runtime\)         Licence MIT        https://github.com/nodejs/node  (texte : runtime\LICENSE)
ws (node_modules\ws)                    Licence MIT        https://github.com/websockets/ws
LibreHardwareMonitor $LHM_VERSION (lhm\)  Licence MPL-2.0     https://github.com/LibreHardwareMonitor/LibreHardwareMonitor
PawnIO $PAWNIO_VERSION (pawnio\)         Licence GPL-2.0    https://github.com/namazso/PawnIO.Setup  (code source disponible a cette adresse)
"@ | Set-Content -Encoding UTF8 (Join-Path $stage 'LICENSES.txt')

# ---- Icone de l'installeur : PNG 256 px dans un .ico ----
Add-Type -AssemblyName System.Drawing
$src = [Drawing.Image]::FromFile((Join-Path $root 'client\icons\icon-512.png'))
$bmp = New-Object Drawing.Bitmap 256, 256
$g = [Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($src, 0, 0, 256, 256); $g.Dispose(); $src.Dispose()
$ms = New-Object IO.MemoryStream; $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $png = $ms.ToArray()
$ico = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $ico
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0)
$w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$png.Length); $w.Write([uint32]22); $w.Write($png); $w.Flush()
[IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'pcdeck.ico'), $ico.ToArray())

# ---- Programmes compilés (étape 1 bis) : plus de PowerShell ni de compilation au démarrage ----
# Le C# vient des scripts server\*.ps1 (même code), plus un point d'entrée par programme.
if ($Compiled) {
Write-Host '5b/6 Programmes compilés...'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "Compilateur C# de Windows introuvable : $csc" }
$hdir = Join-Path $stage 'helpers'
$hsrc = Join-Path $dist 'helpers-src'
New-Item -ItemType Directory -Force $hdir, $hsrc | Out-Null
$mains = Join-Path $PSScriptRoot 'helpers\HelperMains.cs'
$helpers = @(
  @{ Name = 'keys';    Define = 'KEYS';    Refs = @('System.Windows.Forms.dll', 'System.Drawing.dll') },
  @{ Name = 'screen';  Define = 'SCREEN';  Refs = @('System.Windows.Forms.dll', 'System.Drawing.dll') },
  @{ Name = 'netmon';  Define = 'NETMON';  Refs = @() },
  @{ Name = 'procmon'; Define = 'PROCMON'; Refs = @() },
  @{ Name = 'audio';   Define = 'AUDIO';   Refs = @() }
)
foreach ($h in $helpers) {
  $text = [IO.File]::ReadAllText((Join-Path $root "server\$($h.Name).ps1"))
  $m = [regex]::Match($text, "(?s)@'\r?\n(.*?)\r?\n'@")
  if (-not $m.Success) { throw "Code C# introuvable dans server\$($h.Name).ps1" }
  $src = Join-Path $hsrc "$($h.Name).cs"
  [IO.File]::WriteAllText($src, $m.Groups[1].Value, (New-Object Text.UTF8Encoding $true))
  $refs = @($h.Refs | ForEach-Object { "/r:$_" })
  & $csc /nologo /optimize+ /codepage:65001 /target:exe "/define:$($h.Define)" "/out:$hdir\pcdeck-$($h.Name).exe" @refs $src $mains
  if ($LASTEXITCODE -ne 0) { throw "Compilation de pcdeck-$($h.Name).exe échouée" }
}
& $csc /nologo /optimize+ /codepage:65001 /target:winexe "/win32icon:$PSScriptRoot\pcdeck.ico" "/out:$stage\PC Deck.exe" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Management.dll /r:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'helpers\Tray.cs')
if ($LASTEXITCODE -ne 0) { throw 'Compilation de PC Deck.exe échouée' }
}

if ($StageOnly) { Write-Host "Prepare : $stage" -ForegroundColor Green; return }

# ---- 6. L'installeur ----
Write-Host '6/6 Installeur (Inno Setup)...'
$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 introuvable (winget install JRSoftware.InnoSetup)' }
& $iscc "/DAppVersion=$version" "/DStageDir=$stage" "/DOutDir=$dist" "/Q" (Join-Path $PSScriptRoot 'pcdeck.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup a echoue' }
$out = Join-Path $dist "PCDeck-Setup-$version.exe"
$hash = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
"$hash  PCDeck-Setup-$version.exe" | Set-Content -Encoding ASCII "$out.sha256"
Write-Host ("OK : {0} ({1:N0} Mo)`n     SHA-256 : {2}" -f $out, ((Get-Item $out).Length / 1MB), $hash) -ForegroundColor Green
