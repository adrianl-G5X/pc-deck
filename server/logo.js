// Logos des boutons : le vrai logo d'un programme, d'un dossier, d'une appli du Store ou d'un site.
// Image PNG en base64 ("data:image/png;base64,...") : envoyée avec le bouton, donc la même sur tous les appareils.
// Gardés dans le dossier de données (logos\). Un programme mis à jour change de date : son logo est relu.
// Un site est revérifié au bout de 7 jours.
//
// Où on cherche, dans l'ordre (le premier qui donne une image gagne) :
//   1. l'appli choisie à la main (logoApp, une des applis installées) ;
//   2. ce que le bouton ouvre : programme, fichier, dossier, appli du Store, site (favicon) ;
//   3. le programme déjà ouvert (bouton « fenêtre ») ;
//   4. une appli installée dont le nom ressemble à celui du bouton ou du programme
//      (ex. « Gestionnaire des tâches », « Apple Music »).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { DATA_DIR } = require('./paths');

const DIR = path.join(DATA_DIR, 'logos');
const WEB_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_BYTES = 300 * 1024;

// Lit PCDECK_SRC. Modes : file (programme, fichier, dossier), shell (appli du Store, emplacement Windows),
// proc (programme ouvert), ico (image de site convertie en PNG). Affiche le PNG en base64.
const PS = `
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class PcDeckIco {
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern uint PrivateExtractIconsW(string f,int i,int w,int h,IntPtr[] hs,int[] ids,uint n,uint fl);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr h);
  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h,int c,ref BM bm);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  [DllImport("shell32.dll",CharSet=CharSet.Unicode,PreserveSig=false)] static extern void SHCreateItemFromParsingName(string p,IntPtr pbc,ref Guid riid,out IShellItemImageFactory f);
  [ComImport,Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItemImageFactory { [PreserveSig] int GetImage(SZ size,int flags,out IntPtr h); }
  [StructLayout(LayoutKind.Sequential)] public struct SZ { public int cx,cy; }
  [StructLayout(LayoutKind.Sequential)] struct BM { public int t,w,h,wb; public short pl,bpp; public IntPtr bits; }
  public static string Shell(string name,int size){
    Guid iid=new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"); IShellItemImageFactory f;
    SHCreateItemFromParsingName(name,IntPtr.Zero,ref iid,out f);
    IntPtr hb; SZ s; s.cx=size; s.cy=size;
    if(f.GetImage(s,0x4,out hb)!=0||hb==IntPtr.Zero) return null;
    try{
      BM bm=new BM(); GetObject(hb,Marshal.SizeOf(bm),ref bm);
      using(Bitmap raw=new Bitmap(bm.w,bm.h,bm.wb,PixelFormat.Format32bppPArgb,bm.bits))
      using(Bitmap flat=new Bitmap(bm.w,bm.h,PixelFormat.Format32bppArgb)){
        using(Graphics g=Graphics.FromImage(flat)){ g.DrawImage(raw,0,0,bm.w,bm.h); }
        if(bm.h>0) flat.RotateFlip(RotateFlipType.RotateNoneFlipY);
        using(System.IO.MemoryStream ms=new System.IO.MemoryStream()){ flat.Save(ms,ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); }
      }
    } finally { DeleteObject(hb); }
  }
}
'@
function Out-Png($b){ $ms=New-Object IO.MemoryStream; $b.Save($ms,[Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray()) }
function From-File($p){
  if(Test-Path -LiteralPath $p -PathType Leaf){
    $hs=New-Object IntPtr[] 1; $ids=New-Object int[] 1
    $n=[PcDeckIco]::PrivateExtractIconsW($p,0,128,128,$hs,$ids,1,0)
    if($n -ge 1 -and $hs[0] -ne [IntPtr]::Zero){ $ic=[Drawing.Icon]::FromHandle($hs[0]); $r=Out-Png $ic.ToBitmap(); [void][PcDeckIco]::DestroyIcon($hs[0]); return $r }
  }
  [PcDeckIco]::Shell($p,128)
}
$p=$env:PCDECK_SRC
try {
  switch($env:PCDECK_MODE){
    'file'  { From-File $p }
    'shell' { [PcDeckIco]::Shell($p,128) }
    'proc'  { $x=(Get-Process -Name $p -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1).Path; if($x){ From-File $x } }
    default {
      $bytes=[IO.File]::ReadAllBytes($p); $ms=New-Object IO.MemoryStream(,$bytes)
      try { $ic=New-Object Drawing.Icon($ms,(New-Object Drawing.Size(64,64))); Out-Png $ic.ToBitmap() }
      catch { $ms.Position=0; Out-Png (New-Object Drawing.Bitmap($ms)) }
    }
  }
} catch {}`;

function run(script, env, timeout = 15000) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...env },
    }, (err, out) => resolve(err ? '' : String(out || '')));
  });
}

async function toPng(mode, src) {
  const b64 = (await run(PS, { PCDECK_MODE: mode, PCDECK_SRC: src })).trim().split(/\s+/).pop();
  return /^[A-Za-z0-9+/=]{100,}$/.test(b64) ? Buffer.from(b64, 'base64') : null;
}

// ---------- Applis installées (menu Démarrer, Store compris) ----------
let startApps = null;
let startAt = 0;
async function listApps() {
  if (startApps && Date.now() - startAt < 10 * 60 * 1000) return startApps;
  const out = await run('[Console]::OutputEncoding=[Text.Encoding]::UTF8; ConvertTo-Json -Compress -InputObject @(Get-StartApps | Select-Object Name, AppID)', {}, 20000);
  try { startApps = JSON.parse(out).filter((a) => a.Name && a.AppID); startAt = Date.now(); } catch { startApps = startApps || []; }
  return startApps;
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
// Nom identique d'abord ; sinon un nom qui contient le texte (le plus court, 6 lettres minimum)
function findApp(apps, name, loose) {
  const n = norm(name);
  if (n.length < 3) return null;
  const exact = apps.find((a) => norm(a.Name) === n);
  if (exact || !loose || n.length < 6) return exact || null;
  return apps.filter((a) => norm(a.Name).includes(n)).sort((a, b) => a.Name.length - b.Name.length)[0] || null;
}

// ---------- D'où vient le logo ----------
const clean = (p) => String(p || '').trim().replace(/^"+|"+$/g, '').replace(/%([^%]+)%/g, (m, v) => process.env[v] || m);
const web = (u) => { try { return /^https?:$/.test(new URL(u).protocol) ? { kind: 'web', url: new URL(u).origin } : null; } catch { return null; } };

const WINDIR = process.env.windir || 'C:\\Windows';
const EXPLORER = { kind: 'file', path: path.join(WINDIR, 'explorer.exe') };
const isFolder = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// Ce que l'action ouvre (sans chercher d'appli par son nom)
function sourceOf(action) {
  if (!action) return null;
  switch (action.type) {
    // Ctrl + Maj + Échap = le Gestionnaire des tâches, quelle que soit la langue de Windows
    case 'keys': return /^ctrl\+shift\+esc(ape)?$/i.test(String(action.keys).replace(/\s/g, '')) ? { kind: 'file', path: path.join(WINDIR, 'System32', 'Taskmgr.exe') } : null;
    case 'app': return action.path ? { kind: 'file', path: clean(action.path) } : action.appId ? { kind: 'shell', id: `shell:AppsFolder\\${action.appId}` } : null;
    case 'newtab': return action.path ? { kind: 'file', path: clean(action.path) } : null;
    case 'tab': return web(action.url);
    case 'window': return sourceOf(action.ifNotRunning);
    case 'open': {
      const t = clean(action.target);
      if (/^https?:\/\//i.test(t)) return web(t);
      // Dossier, « Accueil », emplacement Windows : le logo de l'Explorateur de fichiers
      if (/^(accueil|home)$/i.test(t) || /^shell:/i.test(t) || isFolder(t)) return EXPLORER;
      return /[\\/]|^[a-z]:/i.test(t) ? { kind: 'file', path: t } : null;
    }
    default: return null;
  }
}

async function candidates(button) {
  const out = [];
  const apps = await listApps();
  const asShell = (a) => a && { kind: 'shell', id: `shell:AppsFolder\\${a.AppID}` };
  if (button.logoApp) out.push(asShell(findApp(apps, button.logoApp, false)));
  out.push(sourceOf(button.action));
  const procs = button.action?.type === 'window' ? button.action.processes || [] : [];
  for (const p of procs) out.push(asShell(findApp(apps, p, false)));
  for (const p of procs) out.push({ kind: 'proc', name: p });
  out.push(asShell(findApp(apps, button.label, true)));
  return out.filter(Boolean);
}

async function fetchBytes(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 PC-Deck' } });
  if (!r.ok) return null;
  const b = Buffer.from(await r.arrayBuffer());
  return b.length > 100 && b.length <= MAX_BYTES ? b : null;
}
const looksLikeHtml = (b) => b.slice(0, 5).toString().toLowerCase().startsWith('<');

// Logo d'un site : /favicon.ico, sinon l'icône annoncée dans la page d'accueil
async function webIcon(origin) {
  let bytes = await fetchBytes(origin + '/favicon.ico').catch(() => null);
  if (!bytes || looksLikeHtml(bytes)) {
    bytes = null;
    try {
      const html = (await fetchBytes(origin + '/'))?.toString('utf8') || '';
      const tags = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi) || [];
      for (const tag of tags) {
        const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
        if (!href) continue;
        bytes = await fetchBytes(new URL(href, origin + '/').href).catch(() => null);
        if (bytes && !looksLikeHtml(bytes)) break;
        bytes = null;
      }
    } catch {}
  }
  if (!bytes) return null;
  if (bytes.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return bytes; // déjà un PNG
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = path.join(DIR, `tmp-${crypto.randomUUID()}.bin`);
  fs.writeFileSync(tmp, bytes);
  try { return await toPng('ico', tmp); } finally { fs.rmSync(tmp, { force: true }); }
}

async function fromSource(src) {
  if (src.kind === 'proc') return toPng('proc', src.name);
  let key;
  if (src.kind === 'file') {
    let st;
    try { st = fs.statSync(src.path); } catch { return null; }
    key = `file:${src.path}:${st.mtimeMs}`;
  } else key = src.kind === 'web' ? `web:${src.url}` : `shell:${src.id}`;
  const cache = path.join(DIR, crypto.createHash('sha1').update(key).digest('hex') + '.png');
  try {
    const st = fs.statSync(cache);
    if (src.kind !== 'web' || Date.now() - st.mtimeMs < WEB_TTL_MS) return fs.readFileSync(cache);
  } catch {}
  const png = src.kind === 'web' ? await webIcon(src.url) : await toPng(src.kind, src.kind === 'file' ? src.path : src.id);
  if (png) fs.writeFileSync(cache, png);
  return png;
}

// Renvoie "data:image/png;base64,..." ou null (pas de logo trouvé)
async function getLogo(button) {
  fs.mkdirSync(DIR, { recursive: true });
  for (const src of await candidates(button)) {
    const png = await fromSource(src).catch(() => null);
    if (png) return 'data:image/png;base64,' + png.toString('base64');
  }
  return null;
}

module.exports = { getLogo, listApps, sourceOf };
