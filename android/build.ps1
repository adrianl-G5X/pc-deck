# Fabrique l'appli Android PC Deck (android\PC-Deck.apk), sans Android Studio.
# Utilisation : clic droit > Exécuter avec PowerShell, ou : powershell -ExecutionPolicy Bypass -File android\build.ps1
# -Install : installe aussi l'appli sur la tablette branchée en USB.
param([switch]$Install)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
# Android SDK : celui de ce PC, ou celui indiqué par ANDROID_HOME (publication automatique sur GitHub)
$sdk  = if ($env:ANDROID_HOME -and (Test-Path "$env:ANDROID_HOME\build-tools\34.0.0")) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
$bt   = "$sdk\build-tools\34.0.0"
$jar  = "$sdk\platforms\android-34\android.jar"
# Java 17 : celui de ce PC, ou JAVA_HOME s'il pointe vers un Java 17
if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\javac.exe") -and ((& "$env:JAVA_HOME\bin\javac.exe" -version 2>&1) -match ' 17\.')) {
  $jdkHome = $env:JAVA_HOME
} else {
  $jdk = Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $jdk) { throw 'Java 17 introuvable (winget install Microsoft.OpenJDK.17)' }
  $jdkHome = $jdk.FullName
}
$env:JAVA_HOME = $jdkHome
$env:Path = "$jdkHome\bin;$env:Path"

$out = Join-Path $here 'build'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force "$out\res", "$out\classes", "$out\dex" | Out-Null

# Icône : celle de l'appli web
$mip = Join-Path $here 'res\mipmap-xxxhdpi'
New-Item -ItemType Directory -Force $mip | Out-Null
Copy-Item (Join-Path $here '..\client\icons\icon-192.png') "$mip\ic_launcher.png" -Force

function Run($exe, [string[]]$argList) {
  & $exe @argList
  if ($LASTEXITCODE -ne 0) { throw "Échec : $exe" }
}

# Version : une seule source, package.json (ex. 1.2.3 -> code 10203, toujours croissant)
$version = (Get-Content (Join-Path $here '..\package.json') -Raw | ConvertFrom-Json).version
$v = $version.Split('-')[0].Split('.')
$versionCode = [int]$v[0] * 10000 + [int]$v[1] * 100 + [int]$v[2]

Write-Host '1/5 Ressources...'
Run "$bt\aapt2.exe" @('compile', '--dir', (Join-Path $here 'res'), '-o', "$out\res.zip")
Run "$bt\aapt2.exe" @('link', '-I', $jar, '--manifest', (Join-Path $here 'AndroidManifest.xml'),
  '-A', (Join-Path $here 'assets'), '--min-sdk-version', '24', '--target-sdk-version', '34',
  '--version-code', "$versionCode", '--version-name', $version, '-o', "$out\base.apk", "$out\res.zip")

Write-Host '2/5 Compilation Java...'
$src = Get-ChildItem (Join-Path $here 'src') -Recurse -Filter *.java | ForEach-Object FullName
Run 'javac' (@('-source', '8', '-target', '8', '-bootclasspath', $jar, '-nowarn', '-Xlint:-options', '-encoding', 'UTF-8', '-d', "$out\classes") + $src)

Write-Host '3/5 Conversion Android (dex)...'
$classes = Get-ChildItem "$out\classes" -Recurse -Filter *.class | ForEach-Object FullName
Run "$bt\d8.bat" (@('--release', '--min-api', '24', '--lib', $jar, '--output', "$out\dex") + $classes)

Write-Host '4/5 Assemblage...'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open("$out\base.apk", 'Update')
[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$out\dex\classes.dex", 'classes.dex') | Out-Null
$zip.Dispose()
Run "$bt\zipalign.exe" @('-f', '-p', '4', "$out\base.apk", "$out\aligned.apk")

Write-Host '5/5 Signature...'
# Clé de signature personnelle, créée une seule fois (à garder : elle permet les mises à jour)
# Cle de signature : celle du PC, ou (publication automatique) PCDECK_KEYSTORE + PCDECK_KEYSTORE_PASSWORD
if ($env:PCDECK_KEYSTORE_BASE64 -and -not $env:PCDECK_KEYSTORE) {
  $env:PCDECK_KEYSTORE = Join-Path $env:TEMP 'pcdeck-ci.keystore'
  [IO.File]::WriteAllBytes($env:PCDECK_KEYSTORE, [Convert]::FromBase64String($env:PCDECK_KEYSTORE_BASE64))
}
$ks = if ($env:PCDECK_KEYSTORE) { $env:PCDECK_KEYSTORE } else { Join-Path $here 'pcdeck.keystore' }
$pwFile = Join-Path $here 'keystore-motdepasse.txt'
if (-not $env:PCDECK_KEYSTORE -and -not (Test-Path $ks)) {
  $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  [IO.File]::WriteAllText($pwFile, $pw)
  Run 'keytool' @('-genkeypair', '-keystore', $ks, '-alias', 'pcdeck', '-keyalg', 'RSA', '-keysize', '2048',
    '-validity', '10000', '-storepass', $pw, '-keypass', $pw, '-dname', 'CN=PC Deck')
}
$pw = if ($env:PCDECK_KEYSTORE_PASSWORD) { $env:PCDECK_KEYSTORE_PASSWORD } else { [IO.File]::ReadAllText($pwFile).Trim() }
$apk = Join-Path $here 'PC-Deck.apk'
Run "$bt\apksigner.bat" @('sign', '--ks', $ks, '--ks-pass', "pass:$pw", '--out', $apk, "$out\aligned.apk")
Write-Host "OK : $apk (version $version, code $versionCode)"

if ($Install) {
  $adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
  if (-not $adb) { throw 'adb introuvable' }
  & $adb install -r $apk
}
