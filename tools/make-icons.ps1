# Génère les icônes de l'application (client/icons/*.png).
# Lancer depuis le dossier du projet :  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\client\icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

# $padding : marge autour de la grille (plus grande pour l'icône "maskable" qu'Android découpe en rond)
function New-Icon([int]$size, [float]$padding, [bool]$rounded, [string]$file) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)

    $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#0d0d0d'))
    if ($rounded) { $g.FillPath($bg, (New-RoundRect 0 0 $size $size ($size * 0.22))) }
    else { $g.FillRectangle($bg, 0, 0, $size, $size) }

    # Grille 3 x 2 de "touches", la première en bleu, les autres en gris
    $area = $size - 2 * $padding
    $gap = $area * 0.08
    $cell = ($area - 2 * $gap) / 3
    $top = $padding + ($area - (2 * $cell + $gap)) / 2
    $blue = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#3987e5'))
    $grey = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#383835'))
    $orange = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#d95926'))
    for ($row = 0; $row -lt 2; $row++) {
        for ($col = 0; $col -lt 3; $col++) {
            $brush = $grey
            if ($row -eq 0 -and $col -eq 0) { $brush = $blue }
            if ($row -eq 1 -and $col -eq 2) { $brush = $orange }
            $x = $padding + $col * ($cell + $gap)
            $y = $top + $row * ($cell + $gap)
            $g.FillPath($brush, (New-RoundRect $x $y $cell $cell ($cell * 0.22)))
        }
    }
    $bmp.Save((Join-Path $outDir $file), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "Créé : $file"
}

New-Icon 192 24 $true 'icon-192.png'
New-Icon 512 64 $true 'icon-512.png'
New-Icon 512 112 $false 'icon-maskable-512.png'
New-Icon 180 22 $false 'apple-touch-icon.png'
