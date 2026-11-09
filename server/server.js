// Serveur PC Deck : sert l'interface, envoie les infos système en temps réel
// et exécute les actions des boutons, via une connexion WebSocket.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { startStats, getStats } = require('./stats');
const { loadConfig, parseConfig, watchConfig, CONFIG_PATH } = require('./config');
const { runAction } = require('./actions');
const { startWorker, stopWorker, changeSystemVolume, changeAppVolume } = require('./keys');
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
const appVersionCode = () => { const [a, b, c] = VERSION.split('-')[0].split('.').map(Number); return a * 10000 + b * 100 + c; };
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
  if (pathname === '/settings' || /^\/api\/(settings|devices|update)/.test(pathname)) {
    serveSettings(req, res, pathname);
    return;
  }
  if (['/connect', '/api/pairing', '/download/PC-Deck.apk', '/vendor/qrcode.js'].includes(pathname)) {
    serveConnect(req, res, pathname);
    return;
  }
  serveStatic(req, res);
});

// ---------- Page Paramètres (seulement sur ce PC) ----------
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

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveSettings(req, res, pathname) {
  if (!isThisPc(req)) return res.writeHead(403).end();
  try {
    if (pathname === '/settings') return sendFile(res, path.join(CLIENT_DIR, 'settings.html'));

    if (pathname === '/api/settings' && req.method === 'GET') {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));
      const templates = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'templates.json'), 'utf8')).templates;
      return json(res, 200, { config: raw, templates, devices: auth.listDevices(), version: VERSION, configPath: CONFIG_PATH });
    }

    // Enregistrer : la configuration est vérifiée AVANT d'être écrite (sinon rien ne change)
    if (pathname === '/api/settings' && req.method === 'PUT') {
      const raw = JSON.parse(await readBody(req));
      let parsed;
      try {
        parsed = parseConfig(raw);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
      const portChanged = parsed.server.port !== PORT || parsed.server.host !== HOST;
      fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak'); // version précédente, au cas où
      fs.writeFileSync(CONFIG_PATH + '.tmp', JSON.stringify(raw, null, 2));
      fs.renameSync(CONFIG_PATH + '.tmp', CONFIG_PATH);
      applyConfig(parsed);
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
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  // Extension de navigateur : seulement depuis ce PC, et seulement une extension
  if (url.pathname === '/ext') {
    const origin = req.headers.origin || '';
    if (!isLoopback(req.socket.remoteAddress) || !/^chrome-extension:\/\//.test(origin)) {
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

const SECOND_CLICK_MS = 5000;
const lastPress = new Map(); // id du bouton -> heure du dernier appui

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function publicButtons() {
  // On n'envoie jamais le détail des actions à la tablette.
  return config.buttons.map(({ id, label, icon, color, action }) => ({
    id,
    label,
    icon,
    color,
    // Pour les boutons de son : "up" / "down" / "mute" et leurs deux pas
    volume: action.type === 'volume' ? { op: action.op, step: action.step, bigStep: action.bigStep } : null,
  }));
}

// ---------- Réglages des boutons de son ----------
// audioMode : "system" (Windows) ou "app" (Apple Music) ; bigStep : case "de 10 en 10".
// Mémorisés dans state.json (dossier de données) pour survivre à un redémarrage.
const STATE_FILE = path.join(DATA_DIR, 'state.json');
// toggles : position de chaque interrupteur, ex. { "discord-micro": true } = micro coupé.
const state = { audioMode: 'system', bigStep: false, toggles: {} };
try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8').replace(/^﻿/, ''));
  if (saved.audioMode === 'app') state.audioMode = 'app';
  if (saved.bigStep === true) state.bigStep = true;
  for (const [id, on] of Object.entries(saved.toggles || {})) state.toggles[id] = on === true;
} catch {}

function publicToggles() {
  return config.toggles.map(({ id, label, style }) => ({ id, label, style, active: !!state.toggles[id] }));
}

function audioState() {
  const mode = state.audioMode === 'app' && config.audioApp ? 'app' : 'system';
  return { mode, appLabel: config.audioApp?.label || null, bigStep: state.bigStep };
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
  ws.on('close', () => screen.stopViewing(ws));

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
      // Seulement deux valeurs possibles ; "app" seulement si audioApp est configuré
      if (msg.mode === 'system' || (msg.mode === 'app' && config.audioApp)) updateState({ audioMode: msg.mode });
      else send(ws, { type: 'audio', audio: audioState() });
      return;
    }

    // Contrôle à distance (seulement si activé dans config.json)
    if (msg.type === 'screen-start') {
      if (!config.remote.view) {
        send(ws, { type: 'screen', ok: false, error: 'Contrôle à distance désactivé dans config.json' });
        return;
      }
      const info = await screen.startViewing(ws, msg);
      if (info) send(ws, { type: 'screen', ok: true, control: config.remote.control, ...info });
      return;
    }
    if (msg.type === 'screen-stop') {
      screen.stopViewing(ws);
      return;
    }
    if (msg.type === 'input') {
      screen.input(ws, msg, config.remote.control);
      return;
    }

    if (msg.type === 'set-volume-step') {
      updateState({ bigStep: msg.big === true });
      return;
    }

    // Bascule d'un interrupteur : lance son action puis inverse sa position
    if (msg.type === 'toggle' || msg.type === 'toggle-sync') {
      const toggle = config.toggles.find((t) => t.id === msg.id);
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
        console.error(`Échec de "${toggle.label}" : ${err.message}`);
        send(ws, { type: 'result', id: toggle.id, ok: false, error: err.message });
      }
      return;
    }

    if (msg.type === 'run') {
      const button = config.buttons.find((b) => b.id === msg.id);
      if (!button) {
        send(ws, { type: 'result', id: String(msg.id).slice(0, 60), ok: false, error: 'Bouton inconnu' });
        return;
      }
      // Deuxième appui sur le même bouton en moins de 5 s ? (utilisé par "secondClick")
      const now = Date.now();
      const repeat = now - (lastPress.get(button.id) || 0) < SECOND_CLICK_MS;
      lastPress.set(button.id, repeat ? 0 : now); // un 3e appui recommence le cycle
      try {
        const context = { audioMode: audioState().mode, audioApp: config.audioApp, bigStep: state.bigStep, repeat };
        const out = await runAction(button.action, context);
        const message = typeof out === 'string' ? out : out?.message || null;
        console.log(`Action : ${button.label}${message ? ` (${message})` : ''}`);
        send(ws, { type: 'result', id: button.id, ok: true, message, volume: out?.volume || null });
        if (out?.volume) refreshLevels();
      } catch (err) {
        console.error(`Échec de "${button.label}" : ${err.message}`);
        send(ws, { type: 'result', id: button.id, ok: false, error: err.message });
      }
    }
  });
});

// ---------- Niveaux de volume en direct (pour l'appli) ----------
// Relus toutes les 2 s : si tu changes le son au clavier, l'appli suit aussi.
let levels = { system: null, app: null };
async function refreshLevels() {
  try {
    const system = await changeSystemVolume('get', 0);
    const app = config.audioApp ? await changeAppVolume(config.audioApp.processes, 'get', 0) : null;
    const next = { system, app };
    if (JSON.stringify(next) !== JSON.stringify(levels)) {
      levels = next;
      broadcast({ type: 'levels', levels });
    }
  } catch {}
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
    display: config.display,
    app: apkPath() ? { versionCode: appVersionCode(), versionName: VERSION, minVersionCode: MIN_APP_VERSION_CODE } : null,
    stats: getStats(),
    audio: audioState(),
    // Adresses Wi-Fi du PC : la tablette les retient pour revenir au Wi-Fi
    // quand elle est passée par le câble USB.
    network: {
      port: PORT,
      lan: HOST === '0.0.0.0' ? lanAddresses().map((a) => a.address) : [],
    },
  };
}

// Envoi des infos système à toutes les tablettes appairées, chaque seconde
startStats(1000);
// Rythme d'envoi réglable dans les Paramètres (1, 2 ou 5 s)
let statsTimer = null;
function startStatsBroadcast() {
  clearInterval(statsTimer);
  statsTimer = setInterval(() => broadcast({ type: 'stats', stats: getStats() }), config.display.refreshMs);
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
  if (newConfig.server.host !== HOST || newConfig.server.port !== PORT) {
    console.log('(changement d\'adresse ou de port : appliqué au prochain démarrage du serveur)');
  }
  if (newConfig.display.refreshMs !== old.display.refreshMs) startStatsBroadcast();
  if (newConfig.autostart !== old.autostart) applyAutostart(newConfig.autostart);
  broadcast({ type: 'buttons', buttons: publicButtons() });
  broadcast({ type: 'toggles', toggles: publicToggles() });
  broadcast({ type: 'audio', audio: audioState() });
  broadcast({ type: 'remote', remote: config.remote });
  broadcast({ type: 'display', display: config.display });
}
watchConfig(applyConfig);

startWorker();
startNetmon();
require('./procmon').startProcmon();
process.on('exit', stopWorker);
process.on('SIGINT', () => process.exit(0));

// Adresses du PC sur le réseau local (à taper sur la tablette), Wi-Fi en premier
function lanAddresses() {
  const list = [];
  for (const [name, addrs] of Object.entries(require('os').networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && isLocalNetwork(a.address)) list.push({ name, address: a.address });
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
