// Contrôle à distance : filme un écran du PC et rejoue la souris / le clavier.
// - Un programme screen.ps1 reçoit la souris et le clavier (réponse immédiate).
// - D'autres screen.ps1 filment l'écran EN PARALLÈLE (capture par la carte graphique,
//   puis redimension + JPEG : 20 à 45 ms par image). Pour 30 ou 60 images/s il en faut
//   plusieurs qui travaillent en même temps ; leur nombre s'adapte (jusqu'à MAX_WORKERS).
// - Écran immobile : rien n'est envoyé (économie de réseau et d'énergie).
// Tout s'arrête quand plus personne ne regarde.
// Les images partent en binaire (JPEG) sur la WebSocket de chaque spectateur.

const { spawnHelper } = require('./helper');
const path = require('path');

const MAX_WORKERS = 5;
const IDLE_STOP_MS = 15000;
const FPS_CHOICES = [15, 30, 60];

// ---------- Programmes screen.ps1 ----------
function makeWorker() {
  const w = { child: null, buffer: '', waiting: null, busy: false };
  w.child = spawnHelper('screen');
  w.child.stdout.on('data', (chunk) => {
    w.buffer += chunk.toString('latin1');
    let i;
    while ((i = w.buffer.indexOf('\n')) >= 0) {
      const line = w.buffer.slice(0, i).trim();
      w.buffer = w.buffer.slice(i + 1);
      if (!line || !w.waiting) continue;
      const done = w.waiting;
      w.waiting = null;
      done(line);
    }
  });
  w.child.on('exit', () => {
    w.child = null;
    if (w.waiting) { w.waiting(null); w.waiting = null; }
  });
  w.write = (line) => w.child?.stdin.write(line + '\n');
  // Commande avec réponse (une à la fois par programme)
  w.ask = (line) => new Promise((resolve) => {
    if (!w.child || w.waiting) return resolve(null);
    w.waiting = resolve;
    w.write(line);
  });
  return w;
}

let control = null; // souris, clavier, liste des écrans
let capturers = [];
let monitors = [];
let stopTimer = null;
let avgMs = 40; // durée moyenne d'une capture (mesurée en continu)

function ensureControl() {
  clearTimeout(stopTimer);
  if (!control?.child) control = makeWorker();
}

function killAll() {
  control?.child?.kill();
  control = null;
  for (const w of capturers) w.child?.kill();
  capturers = [];
}
process.on('exit', killAll);

// Un programme libre pour filmer ; en lance un de plus si besoin
function idleCapturer() {
  capturers = capturers.filter((w) => w.child);
  const free = capturers.find((w) => !w.busy);
  if (free) return free;
  const fps = Math.max(0, ...[...viewers.values()].map((v) => v.fps));
  const needed = Math.min(MAX_WORKERS, Math.ceil((fps * avgMs) / 1000) + 1);
  if (capturers.length < needed) {
    const w = makeWorker();
    capturers.push(w);
    return w;
  }
  return null;
}

async function getMonitors() {
  ensureControl();
  const line = await control.ask('mon');
  if (line?.startsWith('J ')) {
    try { monitors = JSON.parse(line.slice(2)).monitors; } catch {}
  }
  return monitors;
}

// ---------- Spectateurs ----------
const viewers = new Map(); // ws -> { mon, maxW, quality, fps, seq, lastSent, timer, nextAt }

function tick(ws) {
  const v = viewers.get(ws);
  if (!v) return;
  if (ws.readyState !== ws.OPEN) { stopViewing(ws); return; }

  // Cadence régulière, calée sur une horloge fixe
  const interval = 1000 / v.fps;
  v.nextAt += interval;
  const now = Date.now();
  if (v.nextAt < now - interval) v.nextAt = now; // retard trop grand : on repart d'ici
  v.timer = setTimeout(() => tick(ws), Math.max(0, v.nextAt - now));

  if (ws.bufferedAmount > 1_500_000) return; // réseau saturé : on saute cette image
  const w = idleCapturer();
  if (!w) return; // tous occupés : on saute cette image

  const seq = ++v.seq;
  w.busy = true;
  const started = Date.now();
  // "force" : renvoie l'image même si l'écran n'a pas bougé (première image,
  // puis une par seconde pour rester à jour). Sinon, écran immobile = rien à envoyer.
  const force = !v.lastSentAt || started - v.lastSentAt > 1000;
  w.ask(`cap ${v.mon} ${v.maxW} ${v.quality}${force ? ' force' : ''}`).then((line) => {
    w.busy = false;
    if (!line?.startsWith('F ')) return;
    avgMs = avgMs * 0.9 + (Date.now() - started) * 0.1;
    // Les images arrivent parfois dans le désordre : on ignore les plus anciennes
    if (seq <= v.lastSent || viewers.get(ws) !== v || ws.readyState !== ws.OPEN) return;
    v.lastSent = seq;
    v.lastSentAt = Date.now();
    ws.send(Buffer.from(line.slice(2), 'base64'), { binary: true });
  });
}

function clampInt(v, lo, hi, def) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}

async function startViewing(ws, opts = {}) {
  ensureControl();
  // Deux demandes rapprochées (ex. ouverture puis choix de la cadence) : seule la dernière compte
  const req = (ws.screenReq = (ws.screenReq || 0) + 1);
  const list = monitors.length ? monitors : await getMonitors();
  if (ws.screenReq !== req) return null;
  const fps = FPS_CHOICES.includes(Number(opts.fps)) ? Number(opts.fps) : 30;
  const old = viewers.get(ws);
  if (old) clearTimeout(old.timer);
  else console.log(`Contrôle à distance : un appareil regarde l'écran (${fps} img/s)`);
  const v = {
    mon: clampInt(opts.monitor, 0, Math.max(0, list.length - 1), 0),
    maxW: clampInt(opts.maxWidth, 640, 2560, 1600),
    quality: clampInt(opts.quality, 30, 90, 60),
    fps,
    seq: old?.seq || 0,
    lastSent: old?.lastSent || 0,
    lastSentAt: 0, // nouvelle demande (autre écran, autre cadence) : image complète tout de suite
    nextAt: Date.now(),
  };
  viewers.set(ws, v);
  tick(ws);
  return { monitors: list, monitor: v.mon, fps };
}

function stopViewing(ws) {
  const v = viewers.get(ws);
  if (!v) return;
  clearTimeout(v.timer);
  viewers.delete(ws);
  console.log('Contrôle à distance : fin');
  if (!viewers.size) {
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => { if (!viewers.size) killAll(); }, IDLE_STOP_MS);
  }
}

// Souris / clavier : seulement pour un spectateur en cours (il voit ce qu'il fait)
function input(ws, msg, allowControl) {
  const v = viewers.get(ws);
  if (!v || !allowControl || !control?.child) return;
  const num = (x) => Math.min(1, Math.max(0, Number(x) || 0)).toFixed(5);
  switch (msg.action) {
    case 'move':
      control.write(`move ${v.mon} ${num(msg.x)} ${num(msg.y)}`);
      break;
    case 'button':
      if (['l', 'r', 'm'].includes(msg.button) && ['down', 'up'].includes(msg.state)) control.write(`btn ${msg.button} ${msg.state}`);
      break;
    case 'wheel':
      control.write(`wheel ${clampInt(msg.delta, -1200, 1200, 0)}`);
      break;
    case 'key':
      if (['down', 'up'].includes(msg.state)) control.write(`key ${clampInt(msg.vk, 1, 254, 0)} ${msg.state}`);
      break;
    case 'text': {
      const text = String(msg.text || '').slice(0, 500);
      if (text) control.write(`text ${Buffer.from(text, 'utf8').toString('base64')}`);
      break;
    }
  }
}

module.exports = { startViewing, stopViewing, input };
