// Serveur PC Deck : sert l'interface, envoie les infos système en temps réel
// et exécute les actions des boutons, via une connexion WebSocket.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { startStats, getStats } = require('./stats');
const { loadConfig, parseConfig, watchConfig, CONFIG_PATH } = require('./config');
const { runAction, doubleActionFor } = require('./actions');
const { explain } = require('./errors');
const { startWorker, stopWorker, changeSystemVolume, changeAppVolume, changeMic, audioDevices, setAudioDevice, listMixer, setVolume, pressKeys, parseKeys, mouse, typeText, getClipboard, setClipboard } = require('./keys');
const auth = require('./auth');
const { startUsb } = require('./usb');
const { startNetmon } = require('./netmon');
const { attachExtension } = require('./ext');
const screen = require('./screen');
const { DATA_DIR, APP_DIR } = require('./paths');
const { startDiscovery } = require('./discovery');
const updates = require('./update');

// Appli Android fournie par ce PC : même numéro que PC Deck (1.2.3 -> 10203).
// MIN_APP : plus ancienne appli tablette encore compatible avec ce PC.
const MIN_APP_VERSION_CODE = 300;
// Numéro de l'APK réellement fourni (écrit par android\build.ps1 à côté du fichier) ;
// sans lui, on ne propose pas de mise à jour (évite d'annoncer une version qu'on n'a pas).
function apkInfo() {
  const apk = apkPath();
  if (!apk) return null;
  try {
    const info = JSON.parse(fs.readFileSync(apk + '.json', 'utf8').replace(/^\uFEFF/, ''));
    return Number.isInteger(info.versionCode) ? { versionCode: info.versionCode, versionName: String(info.versionName) } : null;
  } catch {
    return null;
  }
}
const { VERSION, PROTOCOL } = require('./version');

const CLIENT_DIR = path.join(__dirname, '..', 'client');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`⚠ ${err.message}`);
  process.exit(1);
}
require('./obs').configure(config.obs);
const { host: HOST, port: PORT } = config.server;

// ---------- Réseau local uniquement ----------
const { cleanIp, isLoopback, isLocalNetwork } = require('./network');

// La page doit venir de ce serveur (même port, adresse locale) : empêche un
// site web quelconque ouvert sur la tablette de piloter le PC.
function isAllowedOrigin(origin) {
  if (!origin) return true; // pas un navigateur
  try {
    const u = new URL(origin);
    // Appli Android PC Deck : son interface est servie sous cette adresse interne
    if (origin === 'http://pcdeck.localhost') return true;
    const port = Number(u.port || 80);
    const hostname = u.hostname.replace(/^\[|\]$/g, '');
    return port === PORT && (hostname === 'localhost' || isLocalNetwork(hostname));
  } catch {
    return false;
  }
}

// ---------- Pages et fichiers ----------
function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const file = path.join(CLIENT_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(CLIENT_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  sendFile(res, file);
}

function sendFile(res, file, headers = {}) {
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Introuvable');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...headers,
    });
    res.end(content);
  });
}

// Pages réservées à CE PC : connexion locale ET nom "localhost" (bloque le "DNS rebinding",
// où un site web malveillant se ferait passer pour localhost).
function isThisPc(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  const origin = req.headers.origin;
  return isLoopback(req.socket.remoteAddress) && ['localhost', '127.0.0.1', '[::1]'].includes(host) &&
    (!origin || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin));
}

// L'appli Android fournie avec l'installeur (tablet\), ou celle du dossier de développement
function apkPath() {
  return [path.join(APP_DIR, 'tablet', 'PC-Deck.apk'), path.join(APP_DIR, 'android', 'PC-Deck.apk')].find((f) => fs.existsSync(f));
}

// Page « Connecter un appareil », code d'appairage, APK, QR codes
function serveConnect(req, res, pathname) {
  if (pathname === '/download/PC-Deck.apk') {
    const apk = apkPath();
    if (!apk) return res.writeHead(404).end();
    return sendFile(res, apk, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="PC-Deck.apk"',
    });
  }
  if (pathname === '/vendor/qrcode.js') return sendFile(res, require.resolve('qrcode-generator'));
  if (!isThisPc(req)) return res.writeHead(403).end();
  if (pathname === '/connect') return sendFile(res, path.join(CLIENT_DIR, 'connect.html'));
  const status = req.method === 'POST' ? auth.newPairingCode() : auth.pairingStatus();
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({
    ...status,
    name: require('os').hostname(),
    port: PORT,
    hosts: HOST === '0.0.0.0' ? lanAddresses().map((a) => a.address) : [],
    apk: !!apkPath(),
    // Adresse Tailscale de ce PC (100.64.0.0/10) quand Tailscale est connecté, sinon null
    tailscale: lanAddresses().map((a) => a.address).find((ip) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) || null,
  }));
}

const server = http.createServer((req, res) => {
  if (!isLocalNetwork(req.socket.remoteAddress)) {
    req.socket.destroy();
    return;
  }
  // Infos brutes, pour vérifier depuis le PC seulement
  if (req.url === '/api/stats') {
    if (!isLoopback(req.socket.remoteAddress)) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(getStats()));
    return;
  }
  const { pathname } = new URL(req.url, 'http://x');
  // Vidéo convertie à la volée par ffmpeg (lien temporaire de la visionneuse ; t = départ en secondes)
  if (pathname === '/api/video') {
    const q = new URL(req.url, 'http://x').searchParams;
    const t = fileTickets.get(q.get('k') || '');
    if (!t || t.until < Date.now() || !config.remote.control || !require('./video').ffmpegPath()) return res.writeHead(403).end();
    datause.meter(res, t.device);
    return require('./video').stream(t.file, Number(q.get('t')) || 0, req, res);
  }
  // Télécharger un fichier du PC sur l'appareil (dossiers personnels seulement, pilotage autorisé)
  if (pathname === '/api/file') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.writeHead(204, { 'Access-Control-Allow-Headers': 'X-PCDeck-Token, Range', 'Access-Control-Allow-Methods': 'GET' }).end();
    const q = new URL(req.url, 'http://x').searchParams;
    // Laissez-passer de l'appareil (en-tête), ou lien temporaire ?k= pour un seul fichier (visionneuse, lecteur vidéo)
    for (const [k, t] of fileTickets) if (t.until < Date.now()) fileTickets.delete(k);
    const ticket = q.get('k') ? fileTickets.get(q.get('k')) : null;
    if (!config.remote.control || !(ticket || auth.isValidToken(String(req.headers['x-pcdeck-token'] || '')))) return res.writeHead(403).end();
    const file = ticket ? ticket.file : tools.safePath(q.get('path'), config.uploadDir);
    datause.meter(res, ticket ? ticket.device : auth.deviceId(String(req.headers['x-pcdeck-token'])));
    let st;
    try { st = file && fs.statSync(file); } catch {}
    if (!st || st.isDirectory()) return res.writeHead(404).end();
    const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic',
      mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', pdf: 'application/pdf' };
    const type = q.get('dl') ? 'application/octet-stream' : TYPES[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Disposition': `${q.get('dl') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(path.basename(file))}` };
    // Vidéo : le lecteur demande des morceaux (avance rapide, reprise)
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) return res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end();
      res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}` });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (q.get('dl')) console.log(`Fichier envoyé à un appareil : ${file}`);
    return fs.createReadStream(file).pipe(res);
  }
  // Photo ou fichier envoyé par un appareil appairé (son laissez-passer dans l'en-tête)
  if (pathname === '/api/upload') {
    res.setHeader('Access-Control-Allow-Origin', '*'); // l'appli Android vient d'une autre adresse
    if (req.method === 'OPTIONS') return res.writeHead(204, { 'Access-Control-Allow-Headers': 'X-PCDeck-Token', 'Access-Control-Allow-Methods': 'POST' }).end();
    if (req.method !== 'POST' || !auth.isValidToken(String(req.headers['x-pcdeck-token'] || ''))) return res.writeHead(403).end();
    return receiveUpload(req, res, new URL(req.url, 'http://x').searchParams.get('name'));
  }
  if (pathname === '/settings' || /^\/api\/(settings|devices|update)/.test(pathname)) {
    serveSettings(req, res, pathname);
    return;
  }
  // Fond d'écran choisi sur le PC (image ou vidéo), pour toutes les tablettes et tous les téléphones
  if (pathname === '/wallpaper/info' || pathname === '/wallpaper') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const m = wallMeta();
    if (pathname === '/wallpaper/info') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(m ? { kind: m.kind, v: m.v } : { kind: null }));
    }
    if (!m) return res.writeHead(404).end();
    const headers = { 'Content-Type': m.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000' }; // l'adresse change avec ?v= à chaque nouveau fond
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (r && (r[1] || r[2])) { // Safari (iPhone, iPad) lit les vidéos par morceaux
      const start = r[1] ? Number(r[1]) : Math.max(0, m.size - Number(r[2]));
      const end = r[1] && r[2] ? Math.min(Number(r[2]), m.size - 1) : m.size - 1;
      if (start >= m.size || start > end) return res.writeHead(416, { 'Content-Range': `bytes */${m.size}` }).end();
      res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${m.size}` });
      return fs.createReadStream(WALL + '.bin', { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': m.size });
    return fs.createReadStream(WALL + '.bin').pipe(res);
  }
  if (['/connect', '/api/pairing', '/download/PC-Deck.apk', '/vendor/qrcode.js'].includes(pathname)) {
    serveConnect(req, res, pathname);
    return;
  }
  serveStatic(req, res);
});

// ---------- Fond d'écran commun (choisi dans les Paramètres du PC) ----------
const WALL = path.join(DATA_DIR, 'fond-ecran'); // fond-ecran.bin (le fichier) + fond-ecran.json (son type)
const MAX_WALL = 300 * 1024 * 1024;
function wallMeta() {
  try {
    const m = JSON.parse(fs.readFileSync(WALL + '.json', 'utf8'));
    const st = fs.statSync(WALL + '.bin');
    return { kind: m.kind, type: m.type, v: Math.round(st.mtimeMs), size: st.size };
  } catch { return null; }
}
function receiveWallpaper(req, res) {
  const kind = new URL(req.url, 'http://x').searchParams.get('kind');
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!['image', 'video'].includes(kind) || !type.startsWith(kind + '/')) return json(res, 400, { error: 'Choisis une image ou une vidéo' });
  if (Number(req.headers['content-length']) > MAX_WALL) return json(res, 413, { error: 'Fichier trop gros (300 Mo au plus)' });
  const tmp = WALL + '.tmp';
  const out = fs.createWriteStream(tmp);
  let size = 0, dead = false;
  const fail = () => { dead = true; out.destroy(); fs.rm(tmp, { force: true }, () => {}); };
  req.on('data', (c) => { if ((size += c.length) > MAX_WALL && !dead) { fail(); if (!res.headersSent) json(res, 413, { error: 'Fichier trop gros (300 Mo au plus)' }); req.destroy(); } });
  req.on('aborted', fail);
  out.on('error', () => { fail(); if (!res.headersSent) json(res, 500, { error: "Impossible d'enregistrer le fichier" }); });
  out.on('finish', () => {
    if (dead) return;
    fs.renameSync(tmp, WALL + '.bin');
    fs.writeFileSync(WALL + '.json', JSON.stringify({ kind, type }));
    console.log(`Fond d'écran : ${kind} (${Math.round(size / 1024)} Ko)`);
    json(res, 200, { ok: true, kind });
  });
  req.pipe(out);
}

// ---------- Page Paramètres (seulement sur ce PC) ----------
// Écrit config.json (déjà vérifiée) en gardant la version précédente, puis l'applique
// Sauvegarde automatique : une copie de config.json par jour (les 7 dernières), dans le dossier de données
const BACKUP_DIR = path.join(DATA_DIR, 'sauvegardes');
function backupConfig(suffix = '') {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const day = new Date().toLocaleDateString('sv-SE'); // 2026-11-13
    const file = path.join(BACKUP_DIR, `config-${day}${suffix}.json`);
    if (!suffix && fs.existsSync(file)) return; // déjà sauvegardé aujourd'hui
    fs.copyFileSync(CONFIG_PATH, file);
    const daily = fs.readdirSync(BACKUP_DIR).filter((f) => /^config-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const old of daily.slice(0, -7)) fs.rmSync(path.join(BACKUP_DIR, old), { force: true });
  } catch (err) { console.error(`Sauvegarde : ${err.message}`); }
}

function writeConfig(raw, parsed) {
  backupConfig();
  fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak'); // version précédente, au cas où
  fs.writeFileSync(CONFIG_PATH + '.tmp', JSON.stringify(raw, null, 2));
  fs.renameSync(CONFIG_PATH + '.tmp', CONFIG_PATH);
  applyConfig(parsed);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Fichier trop gros')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Fichier reçu : rangé dans le dossier choisi dans les Paramètres (par défaut Téléchargements\PC Deck),
// sans jamais écraser un fichier du même nom
// shortcut: dossier Téléchargements supposé dans le profil (C:\Users\<nom>\Downloads), même s'il a été déplacé ailleurs
const MAX_UPLOAD = 1024 * 1024 * 1024; // 1 Go
function receiveUpload(req, res, name) {
  const device = auth.deviceId(String(req.headers['x-pcdeck-token'] || ''));
  req.on('data', (c) => datause.add(device, 'files', c.length)); // photo envoyée : comptée pour cet appareil
  if (Number(req.headers['content-length']) > MAX_UPLOAD) return json(res, 413, { error: 'Fichier trop gros (1 Go au plus)' });
  const dir = config.uploadDir || path.join(require('os').homedir(), 'Downloads', 'PC Deck');
  const clean = path.basename(String(name || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 120) || 'fichier';
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return json(res, 500, { error: `Dossier de réception introuvable sur le PC (${dir}) : choisis-en un autre dans les Paramètres` }); }
  const { name: base, ext } = path.parse(clean);
  let file = path.join(dir, clean);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base} (${n})${ext}`);
  const out = fs.createWriteStream(file, { flags: 'wx' });
  let size = 0;
  const fail = () => { out.destroy(); fs.rm(file, { force: true }, () => {}); };
  req.on('data', (c) => { if ((size += c.length) > MAX_UPLOAD) { req.destroy(); fail(); } });
  req.on('aborted', fail);
  out.on('error', () => { fail(); if (!res.headersSent) json(res, 500, { error: 'Impossible d\'écrire le fichier sur le PC' }); });
  out.on('finish', () => {
    console.log(`Fichier reçu : ${file} (${Math.round(size / 1024)} Ko)`);
    json(res, 200, { ok: true, name: path.basename(file), dir: path.basename(dir) });
  });
  req.pipe(out);
}

// Diagnostic : [{ ok: true | false | null (info), title, detail, fix }]
function diagnose() {
  const ps = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; " +
    "$p = @(Get-NetConnectionProfile | Select-Object InterfaceAlias, @{n='Cat';e={[string]$_.NetworkCategory}}); " +
    "$fw = [bool](netsh advfirewall firewall show rule name='PC Deck Server' | Select-String 'Enabled:\\s+Yes|Activ.*:\\s+Oui'); " +
    "$lhm = [bool](Get-Process LibreHardwareMonitor -ErrorAction SilentlyContinue); " +
    "@{ profiles = $p; firewall = $fw; lhm = $lhm } | ConvertTo-Json -Depth 3 -Compress";
  return new Promise((resolve) => require('child_process').execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 20000 }, (err, out) => {
    let sys = {};
    try { sys = JSON.parse(String(out)); } catch {}
    const lan = lanAddresses();
    const devices = auth.listDevices();
    const online = [...wss.clients].filter((w) => w.authed).length;
    const pub = [].concat(sys.profiles || []).filter((p) => p.Cat === 'Public' && lan.some((a) => a.name === p.InterfaceAlias));
    const upd = updates.getState();
    const installed = fs.existsSync(path.join(APP_DIR, 'runtime', 'node.exe'));
    resolve([
      { ok: HOST === '0.0.0.0', title: 'Accès depuis les autres appareils', detail: HOST === '0.0.0.0' ? 'Autorisé' : 'Réservé à ce PC',
        fix: 'Dans config.json, "server.host" doit valoir "0.0.0.0", puis redémarre PC Deck.' },
      { ok: lan.length > 0, title: 'PC connecté au réseau', detail: lan.map((a) => `${a.name} : ${a.address}`).join(' · ') || 'Aucun réseau',
        fix: 'Branche le câble ou connecte le PC au Wi-Fi de la maison.' },
      { ok: lan.length > 0 && !pub.length, title: 'Réseau de la maison en « Privé »', detail: pub.length ? `${pub.map((p) => p.InterfaceAlias).join(', ')} est en « Public »` : 'OK',
        fix: 'Windows bloque les appareils sur un réseau « Public ». Paramètres Windows → Réseau et Internet → ta connexion → Type de profil réseau : « Privé ».' },
      { ok: installed ? sys.firewall === true : null, title: 'Pare-feu de Windows', detail: !installed ? 'Version de développement : non vérifié' : sys.firewall ? 'PC Deck est autorisé' : 'Règle « PC Deck Server » absente ou désactivée',
        fix: 'Réinstalle PC Deck (l\'installeur recrée la règle du pare-feu).' },
      { ok: devices.length > 0, title: 'Appareils connectés', detail: `${devices.length} enregistré${devices.length > 1 ? 's' : ''}, ${online} en ligne maintenant`,
        fix: 'Clique sur « Connecter un appareil » en haut, puis scanne le QR code avec la tablette.' },
      { ok: upd.available ? false : true, title: 'Version de PC Deck', detail: upd.available ? `${upd.latest} disponible (tu as la ${upd.current})` : `${upd.current}, à jour`,
        fix: 'Clique sur « Installer » dans le bandeau de mise à jour.' },
      { ok: installed ? sys.lhm === true : null, title: 'Températures (LibreHardwareMonitor)', detail: sys.lhm ? 'Lancé' : 'Arrêté',
        fix: 'Clic droit sur l\'icône PC Deck près de l\'horloge → « Températures : réparer… ».' },
    ]);
  }));
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveSettings(req, res, pathname) {
  if (!isThisPc(req)) return res.writeHead(403).end();
  try {
    if (pathname === '/settings') return sendFile(res, path.join(CLIENT_DIR, 'settings.html'));

    if (pathname === '/api/settings/wallpaper' && req.method === 'POST') return receiveWallpaper(req, res);
    if (pathname === '/api/settings/wallpaper' && req.method === 'DELETE') {
      for (const ext of ['.bin', '.json']) fs.rmSync(WALL + ext, { force: true });
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/settings/wallpaper' && req.method === 'GET') return json(res, 200, wallMeta() ? { kind: wallMeta().kind } : { kind: null });

    // Sauvegardes automatiques (une par jour) : liste, et « Revenir à cette version »
    if (pathname === '/api/settings/backups' && req.method === 'GET') {
      let list = [];
      try { list = fs.readdirSync(BACKUP_DIR).filter((f) => /^config-[\w-]+\.json$/.test(f)).sort().reverse(); } catch {}
      return json(res, 200, { backups: list.map((name) => ({ name, date: name.slice(7, 17), before: name.includes('avant') })) });
    }
    if (pathname === '/api/settings/restore' && req.method === 'POST') {
      const name = new URL(req.url, 'http://x').searchParams.get('name') || '';
      if (!/^config-[\w-]+\.json$/.test(name)) return json(res, 400, { error: 'Sauvegarde inconnue' });
      const raw = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, name), 'utf8').replace(/^\uFEFF/, ''));
      const parsed = parseConfig(raw);
      backupConfig('-avant-retour');
      writeConfig(raw, parsed);
      console.log(`Configuration : retour à ${name}`);
      return json(res, 200, { ok: true });
    }
    // « Tout remettre à zéro » : boutons, affichage, son… d'origine ; garde le port, les connexions, le démarrage
    if (pathname === '/api/settings/reset' && req.method === 'POST') {
      const cur = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));
      const raw = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'config.default.json'), 'utf8'));
      for (const k of ['server', 'usb', 'remoteControl', 'autostart', 'uploadDir']) if (cur[k] !== undefined) raw[k] = cur[k];
      raw.welcomeDone = true;
      const parsed = parseConfig(raw);
      backupConfig('-avant-remise-a-zero');
      writeConfig(raw, parsed);
      console.log('Configuration : remise à zéro (copie gardée dans les sauvegardes)');
      return json(res, 200, { ok: true });
    }
    // « Pourquoi ça ne marche pas ? » : vérifie ce qui empêche le plus souvent la tablette de se connecter
    if (pathname === '/api/settings/diagnose' && req.method === 'GET') return json(res, 200, { checks: await diagnose() });

    // Applis installées (menu Démarrer), pour choisir un logo par son nom
    if (pathname === '/api/settings/apps' && req.method === 'GET') {
      const apps = await require('./logo').listApps();
      return json(res, 200, { apps: [...new Set(apps.map((a) => a.Name))].sort((a, b) => a.localeCompare(b)) });
    }

    // Programmes ouverts en ce moment (ajout d'un bouton en 1 clic)
    // « Parcourir… » : fenêtre de Windows pour choisir un dossier (la page Paramètres ne s'ouvre que sur le PC)
    if (pathname === '/api/settings/pick-folder' && req.method === 'POST') {
      const ps = "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
        "$d.Description = 'Dossier où ranger les fichiers envoyés depuis la tablette ou le téléphone'; " +
        "$f = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; " +
        "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; if ($d.ShowDialog($f) -eq 'OK') { $d.SelectedPath }";
      require('child_process').execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true, timeout: 600000 }, (err, out) =>
        json(res, 200, { path: err ? '' : String(out).trim() }));
      return;
    }
    // FPS en jeu : RivaTuner installé ? (GET) ; l'installer et le lancer à chaque session (POST, Windows demande l'autorisation)
    if (pathname === '/api/settings/ffmpeg') {
      const v = require('./video');
      if (req.method === 'POST') { const r = await v.install(); return json(res, 200, { status: v.status(), result: r }); }
      return json(res, 200, { status: v.status() });
    }
    if (pathname === '/api/settings/rtss') {
      const script = [path.join(APP_DIR, 'tools', 'setup-rtss.ps1'), path.join(APP_DIR, 'installer', 'setup-rtss.ps1')].find((f) => fs.existsSync(f));
      const run = (step, cb) => require('child_process').execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Step', step],
        { windowsHide: true, timeout: 30000 }, (err, out) => cb(String(out || '').trim()));
      if (req.method === 'GET') return run('status', (status) => json(res, 200, { status }));
      if (req.method !== 'POST') return json(res, 405, {});
      return run('status', (status) => {
        if (status === 'off') return run('start', () => setTimeout(() => run('status', (s) => json(res, 200, { status: s })), 3000));
        // Installation : PowerShell en administrateur (fenêtre d'autorisation de Windows), résultat dans un fichier
        const out = path.join(require('os').tmpdir(), 'pcdeck-rtss.txt');
        fs.rmSync(out, { force: true });
        const q = (s) => String(s).replace(/'/g, "''");
        const user = require('os').userInfo().username.replace(/["'`$]/g, '');
        const ps = `$a = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${q(script)}" -Step install -User "${user}" -Out "${q(out)}"'; ` +
          "try { Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList $a; 'fait' } catch { 'refuse' }";
        require('child_process').execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 600000 }, (err, said) => {
          let result = '';
          try { result = fs.readFileSync(out, 'utf8').trim(); } catch {}
          if (String(said).trim() === 'refuse') result = 'echec: autorisation refusée';
          run('status', (s) => json(res, 200, { status: s, result }));
        });
      });
    }
    if (pathname === '/api/settings/open-apps' && req.method === 'GET') {
      return json(res, 200, { apps: await require('./logo').listOpenApps() });
    }
    // Programmes installés avec leur chemin (suggestions quand on tape un nom de programme)
    if (pathname === '/api/settings/programs' && req.method === 'GET') {
      return json(res, 200, { programs: await require('./logo').listPrograms() });
    }

    if (pathname === '/api/settings' && req.method === 'GET') {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));
      const templates = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'templates.json'), 'utf8')).templates;
      return json(res, 200, { config: raw, templates, devices: auth.listDevices(), version: VERSION, configPath: CONFIG_PATH, logos: Object.fromEntries(logos),
        usage: usageCounts, screenTime: tools.screenTime() });
    }

    // Enregistrer : la configuration est vérifiée AVANT d'être écrite (sinon rien ne change)
    // « Tester » dans la fenêtre d'un bouton : l'action est vérifiée comme dans config.json, puis lancée sur ce PC
    if (pathname === '/api/settings/test' && req.method === 'POST') {
      let action;
      try {
        action = parseConfig({ buttons: [{ id: 'test', action: JSON.parse(await readBody(req)).action }] }).buttons[0].action;
      } catch (err) {
        return json(res, 400, { error: err.message.replace(/^config\.json, [^:]*: /, '') });
      }
      if (['page', 'timer'].includes(action.type)) return json(res, 400, { error: 'cette action se lance depuis la tablette' });
      try {
        const out = await runAction(action, { audioMode: audioState().mode, audioApp: selectedApp(), bigStep: state.bigStep && config.bigStepEnabled });
        console.log(`Test depuis les Paramètres : ${action.type}`);
        return json(res, 200, { message: typeof out === 'string' ? out : out?.message || null });
      } catch (err) {
        return json(res, 400, { error: explain(err, { label: 'Ce bouton' }).message });
      }
    }

    if (pathname === '/api/settings' && req.method === 'PUT') {
      const raw = JSON.parse(await readBody(req));
      let parsed;
      try {
        parsed = parseConfig(raw);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
      const portChanged = parsed.server.port !== PORT || parsed.server.host !== HOST;
      writeConfig(raw, parsed);
      json(res, 200, { ok: true, restart: portChanged });
      // Nouveau port : le serveur s'arrête, l'icône PC Deck le relance tout seul sur le nouveau port
      if (portChanged) setTimeout(() => process.exit(0), 800);
      return;
    }

    // Mises à jour : état, vérification, installation
    if (pathname === '/api/update' && req.method === 'GET') return json(res, 200, updates.getState());
    if (pathname === '/api/update/check' && req.method === 'POST') return json(res, 200, await updates.check());
    if (pathname === '/api/update/install' && req.method === 'POST') {
      try {
        await updates.install();
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }

    // Retirer un appareil : il est déconnecté tout de suite
    const m = /^\/api\/devices\/([0-9a-f]{12})$/.exec(pathname);
    if (m && req.method === 'DELETE') {
      if (!auth.removeDevice(m[1])) return json(res, 404, { error: 'Appareil introuvable' });
      for (const ws of wss.clients) if (ws.deviceId === m[1]) ws.close();
      return json(res, 200, { ok: true, devices: auth.listDevices() });
    }
    json(res, 404, { error: 'Introuvable' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 }); // assez pour un texte copié (presse-papiers)

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  // Extension de navigateur : seulement depuis ce PC, et seulement une extension
  if (url.pathname === '/ext') {
    const origin = req.headers.origin || '';
    if (!isLoopback(req.socket.remoteAddress) || !/^(chrome|moz)-extension:\/\//.test(origin)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attachExtension(ws));
    return;
  }
  if (
    url.pathname !== '/ws' ||
    !isLocalNetwork(req.socket.remoteAddress) ||
    !isAllowedOrigin(req.headers.origin)
  ) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});


function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

// ---------- Logos des boutons ----------
// Cherchés en arrière-plan ; dès qu'un logo change ou arrive, tous les appareils reçoivent les boutons à jour.
const { getLogo } = require('./logo');
const logos = new Map(); // id du bouton -> "data:image/png;base64,..."
async function refreshLogos() {
  let changed = false;
  const wanted = config.buttons.filter((b) => b.logo && !b.logoImage && !b.draft);
  for (const b of wanted) {
    const logo = await getLogo(b).catch(() => null);
    if (logo && logos.get(b.id) !== logo) { logos.set(b.id, logo); changed = true; }
    if (!logo && logos.delete(b.id)) changed = true;
  }
  for (const id of [...logos.keys()]) if (!wanted.some((b) => b.id === id)) { logos.delete(id); changed = true; }
  if (changed) broadcast({ type: 'buttons', buttons: publicButtons() });
}

function publicButtons() {
  // On n'envoie jamais le détail des actions à la tablette.
  return config.buttons.filter((b) => !b.draft).map((button) => {
    const { id, label, icon, color, action } = button;
    return {
    id,
    label,
    icon,
    color,
    page: button.page,
    timer: action.type === 'timer' ? { seconds: action.seconds } : null,
    goto: action.type === 'page' ? action.page : null, // bouton « dossier » : géré par la tablette
    // image perso d'abord, sinon vrai logo (PNG) du programme ou du site trouvé par le PC
    logo: button.logoImage || (button.logo ? logos.get(id) || null : null),
    value: button.value, // valeur affichée sous le nom (cpu, cpuTemp, volume, clock…)
    cycle: action.type === 'cycle' ? action.steps.map((st) => st.label) : null, // noms des états
    confirm: button.confirm === true || action.type === 'power', // la tablette demande « Tu es sûr ? » avant d'envoyer
    // La tablette n'attend un éventuel 2e appui (300 ms) que pour ces boutons
    double: !!doubleActionFor(button),
    // Pour les boutons de son : "up" / "down" / "mute" et leurs deux pas
    volume: action.type === 'volume' ? { op: action.op, step: action.step, bigStep: action.bigStep } : null,
    };
  });
}

// ---------- Réglages des boutons de son ----------
// audioMode : "system" (Windows) ou "app" (Apple Music) ; bigStep : case "de 10 en 10".
// Mémorisés dans state.json (dossier de données) pour survivre à un redémarrage.
const STATE_FILE = path.join(DATA_DIR, 'state.json');
// toggles : position de chaque interrupteur, ex. { "discord-micro": true } = micro coupé.
// audioApp : nom affiché de l'appli choisie (plusieurs possibles dans config.audioApps)
const state = { audioMode: 'system', audioApp: null, bigStep: false, toggles: {} };
try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8').replace(/^﻿/, ''));
  if (saved.audioMode === 'app') state.audioMode = 'app';
  if (typeof saved.audioApp === 'string') state.audioApp = saved.audioApp;
  if (saved.bigStep === true) state.bigStep = true;
  for (const [id, on] of Object.entries(saved.toggles || {})) state.toggles[id] = on === true;
} catch {}

function publicToggles() {
  return config.toggles.filter((t) => !t.draft).map(({ id, label, style }) => ({ id, label, style, active: !!state.toggles[id] }));
}

// Appli choisie pour les boutons de son (la première si son nom a disparu de la config)
function selectedApp() {
  return config.audioApps.find((a) => a.label === state.audioApp) || config.audioApps[0] || null;
}

function audioState() {
  const app = selectedApp();
  const mode = state.audioMode === 'app' && app ? 'app' : 'system';
  return { mode, appLabel: app?.label || null, apps: config.audioApps.map((a) => a.label), bigStep: state.bigStep && config.bigStepEnabled, bigStepEnabled: config.bigStepEnabled };
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error(`Impossible d'enregistrer ${STATE_FILE} : ${err.message}`);
  }
}

function updateState(changes) {
  Object.assign(state, changes);
  saveState();
  broadcast({ type: 'audio', audio: audioState() });
}

function setToggle(id, active) {
  state.toggles[id] = active;
  saveState();
  broadcast({ type: 'toggles', toggles: publicToggles() });
}

function broadcast(message) {
  for (const ws of wss.clients) if (ws.authed) send(ws, message);
}

wss.on('connection', (ws, req) => {
  const ip = cleanIp(req.socket.remoteAddress);
  ws.authed = false;
  ws.on('close', () => { datause.countSocket(ws, screen.isViewing(ws) ? 'screen' : 'other'); screen.stopViewing(ws); require('./audio').listen(ws, false); });

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type === 'pair') {
      try {
        const token = auth.pair(String(msg.code || ''), ip, msg.device);
        ws.authed = true;
        ws.deviceId = auth.deviceId(token);
        console.log(`Nouvel appareil appairé : ${ip}`);
        send(ws, { type: 'paired', token });
        send(ws, hello());
      } catch (err) {
        send(ws, { type: 'pair-error', error: err.message });
      }
      return;
    }

    if (msg.type === 'auth') {
      if (auth.isValidToken(msg.token)) {
        ws.authed = true;
        ws.deviceId = auth.deviceId(msg.token);
        send(ws, hello());
      } else {
        send(ws, { type: 'auth-error' });
      }
      return;
    }

    // Tout le reste exige d'être appairé
    if (!ws.authed) {
      send(ws, { type: 'auth-error' });
      return;
    }

    if (msg.type === 'set-audio-mode') {
      // "system", ou "app" avec le nom affiché d'une appli de la config (la première par défaut)
      if (msg.mode === 'system') updateState({ audioMode: 'system' });
      else if (msg.mode === 'app' && config.audioApps.length) {
        const wanted = config.audioApps.find((a) => a.label === msg.app) || config.audioApps[0];
        updateState({ audioMode: 'app', audioApp: wanted.label });
      } else send(ws, { type: 'audio', audio: audioState() });
      refreshLevels();
      return;
    }

    // Contrôle à distance (seulement si activé dans config.json)
    if (msg.type === 'screen-start') {
      if (!screen.isViewing(ws)) datause.countSocket(ws, 'other'); // ce qui est passé avant : « le reste »
      if (!config.remote.view) {
        send(ws, { type: 'screen', ok: false, error: 'Contrôle à distance désactivé dans config.json' });
        return;
      }
      const info = await screen.startViewing(ws, msg);
      if (info) send(ws, { type: 'screen', ok: true, control: config.remote.control, ...info });
      return;
    }
    // Son du PC sur l'appareil qui regarde l'écran (bouton « Son »)
    if (msg.type === 'screen-audio') {
      require('./audio').listen(ws, msg.on === true && config.remote.view);
      return;
    }
    if (msg.type === 'screen-stop') {
      datause.countSocket(ws, 'screen'); // les dernières images : « écran du PC »
      screen.stopViewing(ws);
      require('./audio').listen(ws, false);
      return;
    }
    if (msg.type === 'input') {
      screen.input(ws, msg, config.remote.control);
      return;
    }

    // ---------- Sorties son (mélangeur de la tablette) ----------
    if (msg.type === 'audio-devices') {
      const real = (d) => !/steam streaming/i.test(d.name);
      try { send(ws, { type: 'audio-devices', outputs: (await audioDevices(0)).filter(real), inputs: (await audioDevices(1)).filter(real) }); }
      catch (err) { send(ws, { type: 'audio-devices', error: explain(err).message }); }
      return;
    }
    if (msg.type === 'audio-set') {
      try { await setAudioDevice(String(msg.id)); send(ws, { type: 'result', id: '', ok: true, message: 'Son changé' }); }
      catch (err) { send(ws, { type: 'result', id: '', ok: false, error: explain(err).message }); }
      return;
    }
    // Vidéo ou musique : aller à un moment (barre du lecteur, ±10 s)
    if (msg.type === 'media-seek') {
      const m = getMedia();
      if (!m) return;
      const now = m.position + (m.playing ? (Date.now() - m.at) / 1000 : 0);
      const to = msg.to != null ? Number(msg.to) : now + Number(msg.delta || 0);
      if (Number.isFinite(to)) await require('./media').seek(Math.max(0, m.duration ? Math.min(to, m.duration - 1) : to));
      return;
    }
    // ---------- Outils réservés au pilotage : fenêtres, programmes, fichiers, capture, presse-papiers ----------
    if (['windows', 'window-act', 'kill', 'programs', 'launch', 'files', 'thumb', 'file-ticket', 'pdf-page', 'video-info', 'ffmpeg-install', 'snapshot', 'cliphist'].includes(msg.type)) {
      if (!config.remote.control) { send(ws, { type: 'result', id: '', ok: false, error: PILOT_OFF }); return; }
      try { await tabletTool(ws, msg); }
      catch (err) { send(ws, { type: 'result', id: '', ok: false, error: explain(err).message }); }
      return;
    }

    // Données utilisées par cet appareil (aujourd'hui, 30 jours)
    if (msg.type === 'data-usage') {
      datause.countSocket(ws, screen.isViewing(ws) ? 'screen' : 'other');
      send(ws, { type: 'data-usage', ...datause.report(ws.deviceId) });
      return;
    }
    // Réponse d'un appareil au « Tu es sûr ? » d'une action programmée
    if (msg.type === 'ask-reply') {
      asks.get(String(msg.id))?.(msg.yes === true);
      return;
    }

    // Pavé tactile, texte tapé et presse-papiers : réservés au pilotage
    // (Paramètres → Avancé → « Contrôle à distance… et le piloter »)
    if (['pad', 'clip-get', 'clip-set'].includes(msg.type)) {
      if (!config.remote.control) {
        send(ws, { type: 'result', id: '', ok: false, error: PILOT_OFF });
        return;
      }
      const int = (v, lim) => Math.max(-lim, Math.min(lim, Math.round(Number(v) || 0)));
      try {
        if (msg.type === 'clip-get') send(ws, { type: 'clip', text: (await getClipboard()).slice(0, 100000) });
        else if (msg.type === 'clip-set') {
          await setClipboard(String(msg.text || '').slice(0, 100000));
          send(ws, { type: 'result', id: '', ok: true, message: 'Copié dans le presse-papiers du PC' });
        } else if (msg.action === 'move') await mouse('move', int(msg.dx, 500), int(msg.dy, 500));
        else if (msg.action === 'button' && ['l', 'r'].includes(msg.button) && ['down', 'up'].includes(msg.state)) await mouse('btn', msg.button, msg.state);
        else if (msg.action === 'wheel') await mouse('wheel', int(msg.delta, 1200));
        else if (msg.action === 'text' && msg.text) await typeText(String(msg.text).slice(0, 2000));
        else if (msg.action === 'key' && ['enter', 'backspace', 'tab', 'esc'].includes(msg.key)) await pressKeys(parseKeys(msg.key));
      } catch (err) {
        send(ws, { type: 'result', id: '', ok: false, error: explain(err).message });
      }
      return;
    }

    // Appui long sur un bouton de la tablette : renommer, déplacer, changer de page, mettre de côté.
    // Rien d'autre (ce que le bouton lance ne se change que sur le PC, dans les Paramètres).
    // « Modifier » du menu Outils sur la tablette : ordre et noms, gardés sur le PC (les mêmes partout)
    if (msg.type === 'tools-layout') {
      try {
        if (config.display.lockLayout) throw new Error('Disposition verrouillée (Paramètres du PC → Affichage)');
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));
        raw.display = { ...(raw.display || {}), tools: { order: Array.isArray(msg.order) ? msg.order.slice(0, 20) : [], names: msg.names && typeof msg.names === 'object' ? msg.names : {} } };
        writeConfig(raw, parseConfig(raw));
      } catch (err) {
        send(ws, { type: 'result', id: '', ok: false, error: err.message });
      }
      return;
    }
    if (msg.type === 'edit-button') {
      try {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, ''));
        const list = raw.buttons || [];
        const i = list.findIndex((b) => b.id === msg.id && b.draft !== true);
        if (i < 0) throw new Error('Bouton introuvable');
        if (config.display.lockLayout) throw new Error('Disposition verrouillée (Paramètres du PC → Affichage)');
        const b = list[i];
        let message;
        if (msg.op === 'rename') {
          const label = String(msg.label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
          if (!label) throw new Error('Nom vide');
          b.label = label; message = `Renommé : ${label}`;
        } else if (msg.op === 'move') {
          // Voisin sur la même page (les boutons mis de côté ne comptent pas)
          const same = (x) => x.draft !== true && (x.page || '').trim() === (b.page || '').trim();
          const step = msg.dir < 0 ? -1 : 1;
          let j = i + step;
          while (j >= 0 && j < list.length && !same(list[j])) j += step;
          if (j < 0 || j >= list.length) throw new Error(step < 0 ? 'Déjà le premier' : 'Déjà le dernier');
          [list[i], list[j]] = [list[j], list[i]];
          message = 'Bouton déplacé';
        } else if (msg.op === 'page') {
          const page = String(msg.page || '').trim().slice(0, 30);
          if (page) b.page = page; else delete b.page;
          message = `Rangé sur la page « ${page || 'Principal'} »`;
        } else if (msg.op === 'draft') {
          b.draft = true; message = `« ${b.label} » mis de côté (le remettre : Paramètres sur le PC, Brouillon)`;
        } else throw new Error('Modification inconnue');
        writeConfig(raw, parseConfig(raw));
        console.log(`Tablette : ${message}`);
        send(ws, { type: 'result', id: b.id, ok: true, message });
      } catch (err) {
        send(ws, { type: 'result', id: String(msg.id).slice(0, 60), ok: false, error: err.message });
      }
      return;
    }

    // Lecteur plein écran : précédent / lecture-pause / suivant (touches multimédia, comme le clavier) et paroles
    if (msg.type === 'media-control') {
      const key = { prev: 'mediaprev', toggle: 'mediaplaypause', next: 'medianext' }[msg.op];
      if (key) pressKeys(parseKeys(key)).catch(() => {});
      return;
    }
    if (msg.type === 'lyrics') {
      const m = getMedia();
      if (!config.display.lyrics || !m) { send(ws, { type: 'lyrics', key: msg.key, none: true }); return; }
      const res = await require('./lyrics').getLyrics(m);
      send(ws, { type: 'lyrics', key: msg.key, ...res });
      return;
    }

    // Mélangeur de volume : un curseur pour Windows et pour chaque programme qui a un son ouvert
    if (msg.type === 'mixer') {
      try {
        const [system, apps] = await Promise.all([changeSystemVolume('get', 0), listMixer()]);
        send(ws, { type: 'mixer', system, apps: apps.map((a) => ({ ...a, label: mixerLabel(a.name) })) });
      } catch (err) {
        send(ws, { type: 'mixer', error: err.message });
      }
      return;
    }
    if (msg.type === 'mixer-mute') {
      const name = String(msg.name || '');
      if (name && !/^[\w.-]{1,60}$/.test(name)) return;
      (name ? changeAppVolume([name.toLowerCase()], 'mute', 0) : changeSystemVolume('mute', 0)).then(() => refreshLevels()).catch(() => {});
      return;
    }
    if (msg.type === 'mixer-set') {
      const name = String(msg.name || '');
      if (name && !/^[\w.-]{1,60}$/.test(name)) return;
      setVolume(name, msg.volume).then(() => refreshLevels()).catch(() => {});
      return;
    }

    if (msg.type === 'set-volume-step') {
      updateState({ bigStep: msg.big === true });
      return;
    }

    // Bascule d'un interrupteur : lance son action puis inverse sa position
    if (msg.type === 'toggle' || msg.type === 'toggle-sync') {
      const toggle = config.toggles.find((t) => t.id === msg.id && !t.draft);
      if (!toggle) {
        send(ws, { type: 'result', id: String(msg.id).slice(0, 60), ok: false, error: 'Interrupteur inconnu' });
        return;
      }
      const next = !state.toggles[toggle.id];
      if (msg.type === 'toggle-sync') {
        // Corrige seulement l'affichage, sans rien envoyer à l'application
        setToggle(toggle.id, next);
        return;
      }
      try {
        await runAction(toggle.action, {});
        setToggle(toggle.id, next);
        console.log(`Interrupteur : ${toggle.label} -> ${next ? 'activé' : 'désactivé'}`);
      } catch (err) {
        const e = explain(err, toggle);
        console.error(`Échec de "${toggle.label}" : ${e.technical}`);
        send(ws, { type: 'result', id: toggle.id, ok: false, error: e.message });
      }
      return;
    }

    if (msg.type === 'run') {
      const button = config.buttons.find((b) => b.id === msg.id && !b.draft);
      if (!button) {
        send(ws, { type: 'result', id: String(msg.id).slice(0, 60), ok: false, error: 'Bouton inconnu' });
        return;
      }
      if (button.action.type === 'timer') { toggleTimer(button); return; }
      // Simple ou double appui : la tablette a déjà fait la différence et n'envoie qu'UNE commande
      const dbl = msg.press === 'double' ? doubleActionFor(button) : null;
      countUse(button.id);
      let act = dbl || button.action, stepLabel = null;
      if (button.action.type === 'cycle') { // plusieurs états : l'étape suivante à chaque appui
        const n = button.action.steps.length;
        cycles[button.id] = ((cycles[button.id] ?? -1) + 1) % n;
        act = button.action.steps[cycles[button.id]].action;
        stepLabel = button.action.steps[cycles[button.id]].label;
        broadcast({ type: 'cycles', cycles });
      }
      try {
        const context = { audioMode: audioState().mode, audioApp: selectedApp(), bigStep: state.bigStep && config.bigStepEnabled, repeat: !!dbl };
        const out = await runAction(act, context);
        const message = (typeof out === 'string' ? out : out?.message || null) || stepLabel;
        console.log(`Action : ${button.label}${message ? ` (${message})` : ''}`);
        send(ws, { type: 'result', id: button.id, ok: true, message, volume: out?.volume || null });
        refreshLevels(); // volume et état des boutons (micro, OBS…) tout de suite à jour
      } catch (err) {
        const e = explain(err, button);
        console.error(`Échec de "${button.label}" : ${e.technical}`); // détail technique : dans le journal
        send(ws, { type: 'result', id: button.id, ok: false, error: e.message });
      }
    }
  });
});

// ---------- Minuteurs et chronomètres ----------
// timers[id] = { start, end } (ms) ; end = null pour un chronomètre. Partagés par tous les appareils.
// Un appui lance, un nouvel appui arrête. À la fin d'un minuteur : alerte sur le PC.
const timers = {};
const timerDone = {};
function toggleTimer(button) {
  if (timers[button.id]) {
    clearTimeout(timerDone[button.id]);
    delete timers[button.id];
    console.log(`Minuteur : ${button.label} arrêté`);
  } else {
    const s = button.action.seconds;
    timers[button.id] = { start: Date.now(), end: s ? Date.now() + s * 1000 : null };
    if (s) timerDone[button.id] = setTimeout(() => finishTimer(button), s * 1000);
    console.log(`Minuteur : ${button.label} lancé${s ? ` (${s} s)` : ' (chronomètre)'}`);
  }
  broadcast({ type: 'timers', timers });
}
function finishTimer(button) {
  delete timers[button.id];
  broadcast({ type: 'timers', timers });
  broadcast({ type: 'result', id: button.id, ok: true, message: `⏰ ${button.label} : terminé !` });
  notifyPc('PC Deck - Minuteur', `${button.label} : temps écoulé !`);
  console.log(`Minuteur : ${button.label} terminé`);
}

// Notification Windows (en bas à droite, avec son) plutôt qu'une fenêtre qui surgit.
// Texte passé par des variables d'environnement : jamais collé dans la commande (il vient parfois de la tablette).
function notifyPc(title, text) {
  const ps = "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; " +
    "$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); " +
    "$t = $x.GetElementsByTagName('text'); $t.Item(0).AppendChild($x.CreateTextNode($env:PCDECK_TITLE)) | Out-Null; " +
    "$t.Item(1).AppendChild($x.CreateTextNode($env:PCDECK_TEXT)) | Out-Null; " +
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))";
  const child = require('child_process').spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps],
    { windowsHide: true, detached: true, stdio: 'ignore', env: { ...process.env, PCDECK_TITLE: title, PCDECK_TEXT: text } });
  child.on('error', () => {});
  child.unref();
}

// ---------- Actions programmées ----------
// À l'heure dite, le bouton choisi est lancé comme si on l'avait touché (une fois par minute au plus).
let lastMinute = '';
setInterval(async () => {
  const d = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (hm === lastMinute) return;
  lastMinute = hm;
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  for (const s of config.schedules) {
    if (s.time !== hm || (s.days === 'week' && weekend) || (s.days === 'weekend' && !weekend)) continue;
    const button = config.buttons.find((b) => b.id === s.button);
    if (!button) continue;
    console.log(`Action programmée (${hm}) : ${button.label}`);
    if (s.confirm && !(await askEveryone(`« ${button.label} » est programmé à ${hm}. Le lancer maintenant ?`))) {
      console.log(`Action programmée (${hm}) : ${button.label} annulée`);
      broadcast({ type: 'result', id: button.id, ok: true, message: `${button.label} (programmé à ${hm}) : annulé` });
      continue;
    }
    if (button.action.type === 'timer') { toggleTimer(button); continue; }
    if (button.action.type === 'page') { broadcast({ type: 'page', page: button.action.page }); continue; }
    try {
      await runAction(button.action, { audioMode: audioState().mode, audioApp: selectedApp(), bigStep: false });
      broadcast({ type: 'result', id: button.id, ok: true, message: `⏰ ${button.label} (programmé à ${hm})` });
    } catch (err) {
      const e = explain(err, button);
      console.error(`Échec de l'action programmée "${button.label}" : ${e.technical}`);
      broadcast({ type: 'result', id: button.id, ok: false, error: e.message });
    }
  }
}, 10000);

// ---------- Données échangées avec chaque appareil (Outils → Cet appareil) ----------
const datause = require('./datause');
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.authed) datause.countSocket(ws, screen.isViewing(ws) || require('./audio').isListening(ws) ? 'screen' : 'other');
  }
}, 10000).unref();

// ---------- Outils de la tablette (pilotage) ----------
const tools = require('./tools');
const PILOT_OFF = "Pilotage désactivé : sur le PC, Paramètres → Avancé (mode avancé) → coche « Voir l'écran du PC » et « … et le piloter ».";
let programList = []; // dernière liste envoyée (la tablette lance par numéro, jamais par chemin)
async function tabletTool(ws, msg) {
  switch (msg.type) {
    case 'windows': return sendWindows(ws);
    case 'window-act':
      await tools.windowAct(msg.h, msg.op);
      await new Promise((r) => setTimeout(r, msg.op === 'close' ? 600 : 200));
      return sendWindows(ws);
    case 'file-ticket': { // lien valable 2 h pour ce fichier seulement (pas le laissez-passer de l'appareil)
      const file = tools.safePath(msg.path, config.uploadDir);
      if (!file) throw new Error('fichier non autorisé');
      const k = require('crypto').randomBytes(16).toString('hex');
      fileTickets.set(k, { file, until: Date.now() + 2 * 3600 * 1000, device: ws.deviceId });
      return send(ws, { type: 'file-ticket', path: msg.path, k });
    }
    case 'thumb': { // miniature d'une photo ou d'une vidéo (dossiers personnels seulement) ; big : aperçu en grand
      const file = tools.safePath(msg.path, config.uploadDir);
      return send(ws, { type: 'thumb', path: msg.path, big: !!msg.big, data: file ? await require('./logo').thumbnail(file, !!msg.big) : null });
    }
    case 'video-info': { // durée, format, et si le PC sait convertir (ffmpeg)
      const t = fileTickets.get(String(msg.k));
      if (!t) throw new Error('lien expiré : rouvre le fichier');
      const v = require('./video');
      const info = v.ffmpegPath() ? await v.probe(t.file) : {};
      return send(ws, { type: 'video-info', k: msg.k, ffmpeg: v.status(), ...info });
    }
    case 'ffmpeg-install': { // depuis la tablette : installe le convertisseur sur le PC (sans droits admin)
      send(ws, { type: 'result', id: '', ok: true, message: 'Installation du convertisseur vidéo sur le PC… (1 à 2 min)' });
      const r = await require('./video').install();
      return send(ws, { type: 'ffmpeg', status: require('./video').status(), message: r });
    }
    case 'pdf-page': { // une page d'un PDF en image (lien temporaire de la visionneuse)
      const t = fileTickets.get(String(msg.k));
      if (!t) throw new Error('lien expiré : rouvre le fichier');
      return send(ws, { type: 'pdf-page', k: msg.k, ...(await require('./pdf').renderPage(t.file, Number(msg.page) || 0)) });
    }
    case 'kill': {
      const m = await tools.killProgram(msg.name);
      console.log(`Tablette : ${m}`);
      return send(ws, { type: 'result', id: '', ok: true, message: m });
    }
    case 'programs':
      programList = await require('./logo').listPrograms();
      return send(ws, { type: 'programs', programs: programList.map((p, i) => ({ i, name: p.name })) });
    case 'launch': {
      const p = programList[Number(msg.i)];
      if (!p) throw new Error('programme introuvable : rouvre la liste');
      await runAction(p.appId ? { type: 'app', appId: p.appId } : { type: 'app', path: p.path });
      return send(ws, { type: 'result', id: '', ok: true, message: `${p.name} lancé` });
    }
    case 'files': return send(ws, { type: 'files', ...tools.listFolder(msg.path || '', config.uploadDir) });
    case 'snapshot': {
      const data = await screen.snapshot(Number(msg.monitor) || 0);
      if (!data) throw new Error('capture impossible, réessaie');
      return send(ws, { type: 'snapshot', data });
    }
    case 'cliphist': return send(ws, { type: 'cliphist', items: tools.clipHistory });
  }
}

const fileTickets = new Map(); // lien temporaire -> { file, until }

// Fenêtres ouvertes : nom du programme (celui du menu Démarrer si connu) et son logo
async function sendWindows(ws) {
  const list = await tools.windows();
  const installed = await require('./logo').listPrograms().catch(() => []);
  const seen = {};
  const out = await Promise.all(list.map(async (w) => {
    const hit = installed.find((p) => (p.process || '').toLowerCase() === w.app.toLowerCase());
    let name = hit?.name || mixerLabel(w.app.toLowerCase());
    seen[name] = (seen[name] || 0) + 1;
    if (seen[name] > 1) name += ` (${seen[name]})`; // 2e fenêtre du même programme
    return { h: w.h, name, logo: await require('./logo').procLogo(w.app) };
  }));
  send(ws, { type: 'windows', windows: out });
}

// ---------- Boutons les plus utilisés (compteur d'appuis, pour les Paramètres) ----------
const USAGE_FILE = path.join(DATA_DIR, 'utilisation.json');
let usageCounts = {};
try { usageCounts = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch {}
let usageTimer = null;
function countUse(id) {
  usageCounts[id] = (usageCounts[id] || 0) + 1;
  clearTimeout(usageTimer);
  usageTimer = setTimeout(() => { try { fs.writeFileSync(USAGE_FILE, JSON.stringify(usageCounts)); } catch {} }, 5000);
}

// ---------- Boutons à plusieurs états : l'état en cours (index) de chacun ----------
const cycles = {};

// ---------- Lumières avec leur état (Home Assistant : { "state": "on" }), relu toutes les 10 s au plus ----------
const haStates = {}, haAt = {};
async function lightState(b) {
  const a = b.action;
  if (Date.now() - (haAt[b.id] || 0) > 10000) {
    haAt[b.id] = Date.now();
    try {
      const r = await fetch(a.stateUrl, { headers: a.token ? { Authorization: `Bearer ${a.token}` } : {}, signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      haStates[b.id] = /^(on|true|open|playing|home)$/i.test(String(j.state ?? j.on ?? j?.state?.on ?? ''));
    } catch { haStates[b.id] = false; }
  }
  return haStates[b.id];
}

// Météo (seulement si une ville est indiquée dans les Paramètres)
const weather = require('./weather');
function sendWeather(w) { broadcast({ type: 'weather', weather: w }); }
// Réglages d'affichage envoyés aux appareils : sans le lien secret de l'agenda
function publicDisplay() { const { calendar: _secret, ...d } = config.display; return d; }
// Prochains rendez-vous (seulement si un lien d'agenda est indiqué dans les Paramètres)
const calendar = require('./calendar');
function sendAgenda(list) { broadcast({ type: 'agenda', agenda: list }); }

// « Tu es sûr ? » d'une action programmée : fenêtre sur le PC et sur tous les appareils connectés.
// La première réponse compte (les autres fenêtres se ferment) ; sans réponse en 2 minutes : non.
const asks = new Map(); // id -> finish(oui ?)
function askEveryone(text) {
  return new Promise((resolve) => {
    const id = require('crypto').randomBytes(6).toString('hex');
    // Texte passé par une variable d'environnement : jamais collé dans la commande PowerShell
    const ps = "Add-Type -AssemblyName System.Windows.Forms; [System.Media.SystemSounds]::Exclamation.Play(); " +
      "$f = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; " +
      "[System.Windows.Forms.MessageBox]::Show($f, $env:PCDECK_TEXT, 'PC Deck - Action programmée', 'YesNo', 'Warning')";
    const child = require('child_process').spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps],
      { windowsHide: true, env: { ...process.env, PCDECK_TEXT: text } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => {});
    child.on('exit', () => finish(/^Yes/m.test(out)));
    const timer = setTimeout(() => finish(false), 120000);
    function finish(yes) {
      if (!asks.has(id)) return;
      asks.delete(id);
      clearTimeout(timer);
      try { child.kill(); } catch {}
      broadcast({ type: 'ask-done', id });
      resolve(yes);
    }
    asks.set(id, finish);
    broadcast({ type: 'ask', id, text });
  });
}

// Nom affiché d'un programme dans le mélangeur : nom donné dans les Paramètres (section Son), sinon nom connu
const MIXER_NAMES = { amplibraryagent: 'Apple Music', applemusic: 'Apple Music', spotify: 'Spotify', discord: 'Discord', msedge: 'Edge',
  chrome: 'Chrome', firefox: 'Firefox', opera: 'Opera', vlc: 'VLC', steam: 'Steam', shellexperiencehost: 'Sons de Windows', explorer: 'Explorateur de fichiers' };
function mixerLabel(name) {
  const app = config.audioApps.find((a) => a.processes.includes(name));
  return app?.label || MIXER_NAMES[name] || name.charAt(0).toUpperCase() + name.slice(1);
}

// ---------- Niveaux de volume en direct (pour l'appli) ----------
// Relus toutes les 2 s : si tu changes le son au clavier, l'appli suit aussi.
let levels = { system: null, app: null };
async function refreshLevels() {
  try {
    const system = await changeSystemVolume('get', 0);
    const sel = selectedApp();
    const app = sel ? await changeAppVolume(sel.processes, 'get', 0) : null;
    const next = { system, app };
    if (JSON.stringify(next) !== JSON.stringify(levels)) {
      levels = next;
      broadcast({ type: 'levels', levels });
    }
  } catch {}
  refreshStates();
}

// ---------- État des boutons (micro coupé, son coupé, OBS qui enregistre…) ----------
// states[id] = true : le bouton s'allume sur la tablette. Relu avec les niveaux de volume (2 s).
let states = {};
async function refreshStates() {
  const next = {};
  let mic;
  for (const b of config.buttons) {
    const a = b.action;
    if (b.draft) continue;
    try {
      if (a.type === 'mic') { mic ??= await changeMic('get'); if (mic?.muted) next[b.id] = true; }
      else if (a.type === 'volume' && a.op === 'mute') { if ((audioState().mode === 'app' ? levels.app : levels.system)?.muted) next[b.id] = true; }
      else if (a.type === 'obs') { if (await require('./obs').obsState(a)) next[b.id] = true; }
      else if (a.type === 'http' && a.stateUrl) { if (await lightState(b)) next[b.id] = true; }
    } catch {}
  }
  if (JSON.stringify(next) !== JSON.stringify(states)) {
    states = next;
    broadcast({ type: 'states', states });
  }
}
setInterval(refreshLevels, 2000);

function hello() {
  return {
    type: 'hello',
    version: VERSION,
    protocol: PROTOCOL,
    levels,
    buttons: publicButtons(),
    toggles: publicToggles(),
    remote: config.remote,
    display: publicDisplay(),
    app: apkInfo() ? { ...apkInfo(), minVersionCode: MIN_APP_VERSION_CODE } : null,
    stats: statsNow(),
    audio: audioState(),
    media: getMedia(),
    weather: weather.getWeather(),
    agenda: calendar.getAgenda(),
    pcUpdate: updates.getState().available ? updates.getState().latest : null, // la tablette prévient (installation sur le PC)
    now: Date.now(), // heure du PC : la tablette en déduit son écart d'horloge (barre de progression et paroles)
    timers,
    states,
    cycles,
    pcName: require('os').hostname(), // la tablette retient ses PC (plusieurs PC)
    // Adresses Wi-Fi du PC : la tablette les retient pour revenir au Wi-Fi
    // quand elle est passée par le câble USB.
    network: {
      port: PORT,
      lan: HOST === '0.0.0.0' ? lanAddresses().map((a) => a.address) : [],
      // Cartes réseau du PC : l'appli Android peut l'allumer à distance (Wake-on-LAN)
      macs: [...new Set(lanAddresses().map((a) => a.mac).filter((m) => m && m !== '00:00:00:00:00:00'))],
    },
  };
}

// Infos système + images par seconde du jeu au premier plan (si RivaTuner tourne)
const statsNow = () => ({ ...getStats(), fps: require('./procmon').getFps() });

// Envoi des infos système à toutes les tablettes appairées, chaque seconde
startStats(1000);
// Rythme d'envoi réglable dans les Paramètres (1, 2 ou 5 s)
let statsTimer = null;
function startStatsBroadcast() {
  clearInterval(statsTimer);
  statsTimer = setInterval(() => broadcast({ type: 'stats', stats: statsNow() }), config.display.refreshMs);
}
startStatsBroadcast();

// Démarrage avec Windows (clé "Run" de l'utilisateur), appliqué tout de suite
function applyAutostart(on) {
  if (on === null || process.platform !== 'win32') return;
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const exe = path.join(APP_DIR, 'PC Deck.exe');
  const command = fs.existsSync(exe) ? `"${exe}"` : `wscript.exe "${path.join(APP_DIR, 'tools', 'launch-hidden.vbs')}"`;
  const args = on
    ? ['add', key, '/v', 'PCDeck', '/t', 'REG_SZ', '/d', command, '/f']
    : ['delete', key, '/v', 'PCDeck', '/f'];
  require('child_process').execFile('reg.exe', args, { windowsHide: true }, () => {});
}

// Nouvelle configuration (fichier modifié à la main ou page Paramètres) : appliquée partout
function applyConfig(newConfig) {
  const old = config;
  config = newConfig;
  require('./obs').configure(newConfig.obs);
  if (newConfig.server.host !== HOST || newConfig.server.port !== PORT) {
    console.log('(changement d\'adresse ou de port : appliqué au prochain démarrage du serveur)');
  }
  if (newConfig.display.refreshMs !== old.display.refreshMs) startStatsBroadcast();
  weather.setCity(newConfig.display.weather, sendWeather);
  tools.watchClipboard(newConfig.remote.control);
  calendar.setCalendar(newConfig.display.calendar, sendAgenda);
  if (newConfig.autostart !== old.autostart) applyAutostart(newConfig.autostart);
  broadcast({ type: 'buttons', buttons: publicButtons() });
  broadcast({ type: 'toggles', toggles: publicToggles() });
  broadcast({ type: 'audio', audio: audioState() });
  broadcast({ type: 'remote', remote: config.remote });
  broadcast({ type: 'display', display: publicDisplay() });
  refreshLogos();
}
watchConfig(applyConfig);
refreshLogos();
setInterval(refreshLogos, 10 * 60 * 1000); // programme mis à jour, site qui change de logo

startWorker();
startNetmon();
weather.setCity(config.display.weather, sendWeather);
tools.watchClipboard(config.remote.control); // historique du presse-papiers : seulement si le pilotage est autorisé
tools.startScreenTime(require('./procmon').getForeground, () => config.limits, notifyPc, (n) => tools.killProgram(n).catch(() => {}));
calendar.setCalendar(config.display.calendar, sendAgenda);
// Morceau en cours (Apple Music, Spotify...) : envoyé à la tablette quand il change
const { startMedia, getMedia } = require('./media');
startMedia((media) => broadcast({ type: 'media', media, now: Date.now() }));

// Profils automatiques : un programme au premier plan (ex. un jeu) affiche sa page sur la tablette ;
// en le quittant, la tablette revient à la page principale.
let autoPage = false;
require('./procmon').startProcmon((fg) => {
  if (!fg) return; // bureau ou fenêtre inconnue : on ne change rien
  // Espaces, tirets et majuscules ignorés : « Apple Music » trouve le programme « AppleMusic »
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const profile = config.profiles.find((p) => norm(p.process) === norm(fg));
  if (profile) { autoPage = true; broadcast({ type: 'page', page: profile.page }); console.log(`Page automatique : ${fg} -> ${profile.page || 'Principal'}`); }
  else if (autoPage) { autoPage = false; broadcast({ type: 'page', page: '' }); console.log(`Page automatique : ${fg} -> Principal`); }
});
process.on('exit', stopWorker);
process.on('SIGINT', () => process.exit(0));

// Adresses du PC sur le réseau local (à taper sur la tablette), Wi-Fi en premier
function lanAddresses() {
  const list = [];
  for (const [name, addrs] of Object.entries(require('os').networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && isLocalNetwork(a.address)) list.push({ name, address: a.address, mac: a.mac });
    }
  }
  const rank = (n) => (/wi-?fi|wlan/i.test(n) ? 0 : /ethernet/i.test(n) ? 1 : 2);
  return list.sort((a, b) => rank(a.name) - rank(b.name));
}

server.listen(PORT, HOST, () => {
  console.log('PC Deck démarré.');
  console.log(`  Sur ce PC : http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    for (const { name, address } of lanAddresses()) {
      console.log(`  Sur la tablette (${name}) : http://${address}:${PORT}`);
    }
  } else {
    console.log('  (accès réseau désactivé : "host" vaut 127.0.0.1 dans config.json)');
  }
  console.log(`  Connecter un appareil : http://localhost:${PORT}/connect`);
  console.log(`  ${config.buttons.length} boutons chargés depuis config.json`);
  startUsb(PORT, config.usb);
  if (HOST === '0.0.0.0') startDiscovery(PORT, VERSION, PROTOCOL);
  updates.startUpdates();
  console.log('(Ctrl+C pour arrêter)');
});
