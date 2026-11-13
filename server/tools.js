// Outils de la tablette réservés au pilotage (Paramètres → Avancé → « … et le piloter ») :
// fenêtres ouvertes, fermer un programme, lancer un programme installé, fichiers du PC, capture d'écran,
// historique du presse-papiers. Et le temps d'écran par programme (limites des Paramètres).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { listWindows, windowAct, getClipboard } = require('./keys');
const { DATA_DIR } = require('./paths');

// ---------- Fermer un programme ----------
// Jamais Windows lui-même ni PC Deck (la tablette perdrait la main)
const PROTECTED = /^(system|idle|registry|smss|csrss|wininit|winlogon|services|lsass|svchost|dwm|explorer|fontdrvhost|sihost|ctfmon|node|powershell|pcdeck-.*|pc deck|memory compression|secure system|librehardwaremonitor)$/i;
function killProgram(name) {
  name = String(name || '').replace(/\.exe$/i, '');
  if (!/^[\w .()-]{1,64}$/.test(name)) return Promise.reject(new Error('nom de programme invalide'));
  if (PROTECTED.test(name)) return Promise.reject(new Error(`${name} fait partie de Windows ou de PC Deck : il ne peut pas être fermé d'ici`));
  return new Promise((resolve, reject) => execFile('taskkill.exe', ['/IM', `${name}.exe`, '/F', '/T'], { windowsHide: true }, (err) =>
    (err ? reject(new Error(`${name} n'a pas pu être fermé (déjà fermé ?)`)) : resolve(`${name} fermé`))));
}

// ---------- Fenêtres ouvertes ----------
async function windows() {
  return (await listWindows()).filter((w) => !/^(PC Deck|Paramètres · PC Deck)$/.test(w.title));
}

// ---------- Fichiers du PC (dossiers personnels seulement) ----------
let roots = null; // [{ name, path }] : Bureau, Documents, Téléchargements, Images, Vidéos, Musique
function getRoots(uploadDir) {
  if (!roots) {
    roots = [];
    const ps = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; " +
      "@('Desktop','MyDocuments','MyPictures','MyVideos','MyMusic') | ForEach-Object { [Environment]::GetFolderPath($_) }";
    try {
      const out = require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 15000 }).toString().split(/\r?\n/);
      ['Bureau', 'Documents', 'Images', 'Vidéos', 'Musique'].forEach((name, i) => out[i] && roots.push({ name, path: out[i].trim() }));
    } catch {}
    roots.splice(2, 0, { name: 'Téléchargements', path: path.join(os.homedir(), 'Downloads') });
  }
  const list = roots.filter((r) => fs.existsSync(r.path));
  if (uploadDir && fs.existsSync(uploadDir) && !list.some((r) => r.path === uploadDir)) list.push({ name: 'Fichiers reçus', path: uploadDir });
  return list;
}
// Chemin demandé par la tablette -> chemin réel, seulement s'il est DANS un des dossiers personnels
function safePath(p, uploadDir) {
  let real;
  try { real = fs.realpathSync(String(p || '')); } catch { return null; }
  const ok = getRoots(uploadDir).some((r) => {
    let base;
    try { base = fs.realpathSync(r.path); } catch { return false; }
    const rel = path.relative(base, real);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
  return ok ? real : null;
}
function listFolder(p, uploadDir) {
  if (!p) return { dir: null, parent: null, items: getRoots(uploadDir).map((r) => ({ name: r.name, path: r.path, dir: true })) };
  const dir = safePath(p, uploadDir);
  if (!dir) throw new Error('dossier non autorisé');
  const items = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || /^(desktop\.ini|thumbs\.db)$/i.test(e.name)) continue;
    const full = path.join(dir, e.name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    items.push({ name: e.name, path: full, dir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, time: st.mtimeMs });
  }
  items.sort((a, b) => b.dir - a.dir || b.time - a.time);
  const isRoot = getRoots(uploadDir).some((r) => path.resolve(r.path) === path.resolve(dir));
  return { dir, parent: isRoot ? '' : path.dirname(dir), items: items.slice(0, 300) };
}

// ---------- Historique du presse-papiers (10 derniers textes copiés sur le PC) ----------
const clipHistory = [];
let clipTimer = null;
function watchClipboard(on) {
  if (!on) { clearInterval(clipTimer); clipTimer = null; clipHistory.length = 0; return; }
  if (clipTimer) return;
  clipTimer = setInterval(async () => {
    try {
      const t = (await getClipboard()).slice(0, 5000);
      if (t.trim() && t !== clipHistory[0]) {
        const i = clipHistory.indexOf(t);
        if (i >= 0) clipHistory.splice(i, 1);
        clipHistory.unshift(t);
        clipHistory.length = Math.min(clipHistory.length, 10);
      }
    } catch {}
  }, 2000);
}

// ---------- Temps d'écran (programme au premier plan, compté toutes les 10 s) ----------
const ST_FILE = path.join(DATA_DIR, 'temps-ecran.json');
let usage = {}; // { "2026-11-13": { "fortnite": 3600 } } en secondes, 7 derniers jours
try { usage = JSON.parse(fs.readFileSync(ST_FILE, 'utf8')); } catch {}
const today = () => new Date().toLocaleDateString('sv-SE');
const warned = new Set(); // "jour|programme|warn" / "|stop" : une seule alerte par jour
let dirty = false;
function startScreenTime(getForeground, getLimits, notify, kill) {
  setInterval(() => {
    const fg = String(getForeground() || '').toLowerCase();
    if (!fg || /^(lockapp|explorer|searchhost|shellexperiencehost)$/.test(fg)) return;
    const d = today();
    usage[d] = usage[d] || {};
    usage[d][fg] = (usage[d][fg] || 0) + 10;
    dirty = true;
    for (const lim of getLimits()) {
      if (lim.process !== fg) continue;
      const left = lim.minutes * 60 - usage[d][fg];
      if (left <= 0 && !warned.has(`${d}|${fg}|stop`)) {
        warned.add(`${d}|${fg}|stop`);
        notify('PC Deck - Temps d\'écran', `Temps écoulé pour ${fg} aujourd'hui (${lim.minutes} min) : le programme se ferme.`);
        kill(fg);
      } else if (left > 0 && left <= 300 && !warned.has(`${d}|${fg}|warn`)) {
        warned.add(`${d}|${fg}|warn`);
        notify('PC Deck - Temps d\'écran', `Encore ${Math.ceil(left / 60)} min pour ${fg} aujourd'hui.`);
      }
    }
  }, 10000);
  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    for (const k of Object.keys(usage).sort().slice(0, -7)) delete usage[k];
    try { fs.writeFileSync(ST_FILE, JSON.stringify(usage)); } catch {}
  }, 60000);
}
// Aujourd'hui et les 7 jours : [{ name, today, week }] (secondes), du plus utilisé au moins utilisé
function screenTime() {
  const d = today(), all = {};
  for (const day of Object.values(usage)) for (const [n, s] of Object.entries(day)) all[n] = (all[n] || 0) + s;
  return Object.entries(all).map(([name, week]) => ({ name, today: usage[d]?.[name] || 0, week })).sort((a, b) => b.today - a.today || b.week - a.week).slice(0, 15);
}

module.exports = { killProgram, windows, windowAct, listFolder, safePath, getRoots, watchClipboard, clipHistory, startScreenTime, screenTime };
