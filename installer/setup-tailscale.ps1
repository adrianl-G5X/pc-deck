# Acces hors de chez soi : installe et connecte Tailscale (ASCII uniquement : lu par PowerShell 5.1).
#   -Step status   affiche : missing | login | on:<adresse 100.x>
#   -Step install  telecharge le programme officiel (signature verifiee) et l'installe, sans question (droits admin)
#   -Step login    ouvre la page de connexion Tailscale dans le navigateur et attend (a lancer en tant qu'utilisateur)
# Ne fait jamais echouer l'installeur : en cas de souci (hors ligne...), on sort sans rien casser.
param([ValidateSet('status', 'install', 'login')][string]$Step = 'status')
$ErrorActionPreference = 'Stop'

function Find-Tailscale {
  foreach ($d in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if ($d) { $p = Join-Path $d 'Tailscale\tailscale.exe'; if (Test-Path $p) { return $p } }
  }
}
function Get-State($exe) {
  try { return (& $exe status --json | ConvertFrom-Json) } catch { return $null }
}

$exe = Find-Tailscale
switch ($Step) {
  'status' {
    if (-not $exe) { 'missing'; break }
    $s = Get-State $exe
    if ($s -and $s.BackendState -eq 'Running' -and $s.Self.TailscaleIPs) { 'on:' + ($s.Self.TailscaleIPs | Where-Object { $_ -notmatch ':' } | Select-Object -First 1) } else { 'login' }
  }
  'install' {
    if ($exe) { break }
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
      $msi = Join-Path $env:TEMP "tailscale-setup-$arch.msi"
      Invoke-WebRequest "https://pkgs.tailscale.com/stable/tailscale-setup-latest-$arch.msi" -OutFile $msi -UseBasicParsing -TimeoutSec 300
      $sig = Get-AuthenticodeSignature $msi
      if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Tailscale Inc\.') { Remove-Item $msi -Force; throw 'signature Tailscale invalide' }
      # TS_UNATTENDEDMODE=always : Tailscale tourne meme avant l'ouverture de session Windows
      $p = Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart', 'TS_UNATTENDEDMODE=always' -Wait -PassThru
      Remove-Item $msi -Force -ErrorAction SilentlyContinue
      "msiexec: $($p.ExitCode)"
    } catch { "echec: $($_.Exception.Message)" }
  }
  'login' {
    if (-not $exe) { break }
    $s = Get-State $exe
    if ($s -and $s.BackendState -eq 'Running') { break }
    $log = Join-Path $env:TEMP 'pcdeck-tailscale-up.txt'
    Start-Process $exe -ArgumentList 'up', '--unattended' -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err" | Out-Null
    $opened = $false
    for ($i = 0; $i -lt 300; $i++) {   # jusqu'a 10 minutes
      Start-Sleep 2
      $s = Get-State $exe
      if ($s -and $s.BackendState -eq 'Running') { break }
      if (-not $opened -and $s -and $s.AuthURL) { Start-Process $s.AuthURL; $opened = $true }
      if (-not $opened -and $i -ge 10) {   # pas d'adresse de connexion : on ouvre l'appli Tailscale
        $gui = Join-Path (Split-Path $exe) 'tailscale-ipn.exe'
        if (Test-Path $gui) { Start-Process $gui }
        $opened = $true
      }
    }
  }
}
exit 0
