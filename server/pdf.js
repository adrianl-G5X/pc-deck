// Pages d'un PDF en images, pour la visionneuse de la tablette (le navigateur des tablettes Android
// n'affiche pas les PDF). Dessinées par le moteur PDF de Windows (Windows.Data.Pdf), une page à la fois.

const { execFile } = require('child_process');

const PS = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$m = [System.WindowsRuntimeSystemExtensions].GetMethods()
$opT = $m | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
$actT = $m | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Op($op, [type]$t) { $k = $opT.MakeGenericMethod($t).Invoke($null, @($op)); [void]$k.Wait(20000); $k.Result }
function Act($a) { $k = $actT.Invoke($null, @($a)); [void]$k.Wait(20000) }
$SF = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$PD = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$file = Op ($SF::GetFileFromPathAsync($env:PCDECK_PDF)) $SF
$doc = Op ($PD::LoadFromFileAsync($file)) $PD
$n = [Math]::Min([int]$env:PCDECK_PAGE, [int]$doc.PageCount - 1)
$page = $doc.GetPage([uint32]$n)
$ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
$opt = New-Object Windows.Data.Pdf.PdfPageRenderOptions
$opt.DestinationWidth = 1400
Act ($page.RenderToStreamAsync($ras, $opt))
$in = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [type[]]@([Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]))
$net = $in.Invoke($null, @($ras.GetInputStreamAt(0)))
$ms = New-Object System.IO.MemoryStream
$net.CopyTo($ms)
"$($doc.PageCount)|$n|" + [Convert]::ToBase64String($ms.ToArray())`;

// { pages, page, data: "data:image/png;base64,…" } ou erreur
function renderPage(file, page = 0) {
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-Command', PS],
    { windowsHide: true, timeout: 30000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PCDECK_PDF: file, PCDECK_PAGE: String(Math.max(0, page | 0)) } },
    (err, out) => {
      const m = /^(\d+)\|(\d+)\|([A-Za-z0-9+/=]+)\s*$/m.exec(String(out || ''));
      if (!m) return reject(new Error('ce PDF ne peut pas être affiché (protégé ou abîmé ?)'));
      resolve({ pages: Number(m[1]), page: Number(m[2]), data: 'data:image/png;base64,' + m[3] });
    }));
}

module.exports = { renderPage };
