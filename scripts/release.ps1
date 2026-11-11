# Publie une nouvelle version de PC Deck, en un geste :
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 0.5.0
# Ce que fait le script :
#   1. vérifie que tout est prêt (Git propre, nouveautés écrites dans CHANGELOG.md, tests OK) ;
#   2. met le numéro de version partout et range les nouveautés sous ce numéro ;
#   3. enregistre (commit), crée l'étiquette v0.5.0 et envoie sur GitHub.
# GitHub fabrique alors l'installeur et l'APK signés et publie la version (onglet « Actions »).
# Les PC de tes proches la proposent ensuite tout seuls.
param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$utf8 = New-Object Text.UTF8Encoding $false

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Numéro attendu au format 1.2.3' }
$current = (Get-Content package.json -Raw | ConvertFrom-Json).version
if ([version]$Version -le [version]$current) { throw "La version doit être plus grande que l'actuelle ($current)" }
if (git status --porcelain) { throw 'Il reste des changements non enregistrés : fais un commit avant de publier.' }
git remote get-url origin | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Aucun dépôt GitHub relié (git remote add origin ...). Voir GUIDE-PUBLICATION.md' }

# Nouveautés écrites sous « ## Prochaine version » ?
$log = [IO.File]::ReadAllText((Resolve-Path CHANGELOG.md), [Text.Encoding]::UTF8)
$m = [regex]::Match($log, '(?ms)^## Prochaine version[^\n]*\n(.*?)(?=^## )')
if (-not $m.Success -or $m.Groups[1].Value -notmatch '(?m)^\s*-\s+\S') {
  throw 'Écris les nouveautés sous « ## Prochaine version » dans CHANGELOG.md (une ligne par nouveauté, commençant par « - »).'
}

Write-Host "Tests..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { throw 'Les tests ont échoué : rien n''a été publié.' }

# Numéro de version + nouveautés rangées sous ce numéro
$date = Get-Date -Format 'yyyy-MM-dd'
$log = $log.Substring(0, $m.Index) + "## Prochaine version`n`n## $Version — $date`n" + $m.Groups[1].Value + $log.Substring($m.Index + $m.Length)
[IO.File]::WriteAllText((Resolve-Path CHANGELOG.md), $log, $utf8)
npm version $Version --no-git-tag-version | Out-Null

Write-Host "`nVersion $Version :" -ForegroundColor Cyan
Write-Host $m.Groups[1].Value.Trim()
$ok = Read-Host "`nPublier cette version pour tous les utilisateurs ? (o/n)"
if ($ok -notmatch '^[oOyY]') {
  git checkout -- package.json package-lock.json CHANGELOG.md
  Write-Host 'Annulé, rien n''a changé.'
  return
}

git add package.json package-lock.json CHANGELOG.md
git commit -m "$Version"
git tag -a "v$Version" -m "Version $Version"
git push origin HEAD --follow-tags
if ($LASTEXITCODE -ne 0) { throw 'Envoi vers GitHub impossible (connexion, droits ?). La version est prête localement : relance « git push origin HEAD --follow-tags ».' }
Write-Host "`nEnvoyé ! GitHub fabrique la version $Version (onglet « Actions » du dépôt, environ 10 minutes)." -ForegroundColor Green
