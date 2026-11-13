# Morceau en cours pour PC Deck (Apple Music, Spotify, navigateur...) : les "controles multimedias"
# de Windows (ceux du volume Windows / de l'ecran de verrouillage).
# Ecrit une ligne JSON a chaque changement (verifie chaque seconde) :
#   {"title":"...","artist":"...","app":"AppleInc.AppleMusicWin_...","playing":true,
#    "position":12.3,"duration":215.0,"at":1731340000000,"art":"data:image/jpeg;base64,..."}
#   position/duration en secondes, "at" = moment (ms) de la position ; "art" seulement s'il change.
#   {} quand rien ne joue.
param([int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false # UTF-8 sans BOM : accents et caractères spéciaux des titres
Add-Type -AssemblyName System.Runtime.WindowsRuntime, System.Drawing

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(3000)) { throw 'delai depasse' }
  $task.Result
}

$Mgr = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$Props = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$StreamT = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$InStream = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
# Appel par réflexion : PowerShell ne trouve pas seul la bonne surcharge pour un flux WinRT
$asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [type[]]@($InStream))
$manager = Await ($Mgr::RequestAsync()) $Mgr

# Pochette reduite a 200 px (JPEG), en data URL
function Get-Art($ref) {
  if (-not $ref) { return '' }
  try {
    $s = Await ($ref.OpenReadAsync()) $StreamT
    $net = $asStream.Invoke($null, @($s))
    $buf = New-Object System.IO.MemoryStream # GDI+ veut un flux qu'on peut relire
    $net.CopyTo($buf)
    $img = [System.Drawing.Image]::FromStream($buf)
    $k = [Math]::Min(1.0, 640.0 / [Math]::Max($img.Width, $img.Height)) # 1.0 : sinon Min(int, int) arrondit à 0
    $bmp = New-Object System.Drawing.Bitmap ([int]($img.Width * $k)), ([int]($img.Height * $k))
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic # réduction nette
    $g.DrawImage($img, 0, 0, $bmp.Width, $bmp.Height)
    $g.Dispose()
    $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $prm = New-Object System.Drawing.Imaging.EncoderParameters 1
    $prm.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 90L
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, $enc, $prm)
    $bmp.Dispose(); $img.Dispose(); $net.Dispose()
    return 'data:image/jpeg;base64,' + [Convert]::ToBase64String($ms.ToArray())
  } catch { [Console]::Error.WriteLine("pochette : $($_.Exception.Message)"); return '' }
}

$last = ''
$lastArtKey = $null
$art = ''
while ($true) {
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  $out = @{}
  try {
    $s = $manager.GetCurrentSession()
    if ($s) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) $Props
      $tl = $s.GetTimelineProperties()
      $playing = [int]$s.GetPlaybackInfo().PlaybackStatus -eq 4
      $artKey = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
      if ($artKey -ne $lastArtKey) { $art = Get-Art $p.Thumbnail; $lastArtKey = $artKey; $artChanged = $true } else { $artChanged = $false }
      # Position au moment de la derniere mise a jour par l'appli ; la tablette avance l'aiguille elle-meme
      $pos = $tl.Position.TotalSeconds
      $at = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
      if ($at -le 0) { $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
      $out = [ordered]@{
        title = [string]$p.Title; artist = [string]$p.Artist; app = [string]$s.SourceAppUserModelId; playing = $playing
        position = [Math]::Round($pos, 1); duration = [Math]::Round(($tl.EndTime - $tl.StartTime).TotalSeconds, 1); at = $at
      }
      if ($artChanged) { $out.art = $art }
    }
  } catch { $out = @{} }
  $line = ConvertTo-Json $out -Compress
  # Sans la pochette : on n'ecrit que si quelque chose a change
  $cmp = [ordered]@{}
  foreach ($k in @($out.Keys)) { if ($k -ne 'art') { $cmp[$k] = $out[$k] } }
  $key = ConvertTo-Json $cmp -Compress
  if ($key -ne $last -or $out.Contains('art')) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $key }
  Start-Sleep -Milliseconds 1000
}
