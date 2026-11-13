// Liaison avec Windows : raccourcis clavier et volume par application.
// Les ordres sont envoyés à un petit programme PowerShell resté ouvert
// (keys.ps1), pour que la réaction soit instantanée.

const { spawnHelper } = require('./helper');
const path = require('path');

// Noms de touches utilisables dans config.json
const KEY_CODES = {
  ctrl: 0x11, shift: 0x10, alt: 0x12, win: 0x5b,
  enter: 0x0d, esc: 0x1b, tab: 0x09, space: 0x20, backspace: 0x08,
  insert: 0x2d, delete: 0x2e, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27, printscreen: 0x2c,
  volumemute: 0xad, volumedown: 0xae, volumeup: 0xaf,
  medianext: 0xb0, mediaprev: 0xb1, mediastop: 0xb2, mediaplaypause: 0xb3,
};
for (let i = 0; i < 26; i++) KEY_CODES[String.fromCharCode(97 + i)] = 0x41 + i; // a..z
for (let i = 0; i < 10; i++) KEY_CODES[String(i)] = 0x30 + i; // 0..9
for (let i = 1; i <= 24; i++) KEY_CODES[`f${i}`] = 0x6f + i; // f1..f24

function parseKeys(text) {
  const names = text.toLowerCase().split('+').map((s) => s.trim());
  return names.map((name) => {
    if (!(name in KEY_CODES)) {
      throw new Error(`touche inconnue "${name}" dans "${text}"`);
    }
    return KEY_CODES[name];
  });
}

// ---------- Programme PowerShell ----------
let worker = null;
let pending = []; // réponses attendues, dans l'ordre

function startWorker() {
  worker = spawnHelper('keys');
  let buffer = '';
  worker.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (/^(ok|notfound|error)/.test(line)) pending.shift()?.(line);
    }
  });
  worker.stderr.on('data', (d) => console.error(`[keys.ps1] ${d.toString().trim()}`));
  worker.on('exit', () => {
    worker = null;
    pending.splice(0).forEach((done) => done('error programme Windows arrêté'));
  });
}

function command(line) {
  if (!worker) startWorker();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Windows ne répond pas')), 8000);
    pending.push((reply) => {
      clearTimeout(timer);
      if (reply.startsWith('error')) reject(new Error(reply.slice(6) || 'échec'));
      else resolve(reply);
    });
    worker.stdin.write(Buffer.from(line + '\n', 'utf8')); // UTF-8 : accents (ex. "Système")
  });
}

function pressKeys(codes) {
  return command(`keys ${codes.join(',')}`);
}

function parseVolume(reply) {
  if (reply === 'notfound') return null;
  const [, volume, muted] = reply.split(':');
  return { volume: Number(volume), muted: muted === '1' };
}

// op : "up" | "down" | "mute" ; step : en % (le volume tombe toujours sur un multiple de step)
// Renvoie { volume: 0-100, muted } ou null si l'application ne joue pas de son.
async function changeAppVolume(processes, op, step) {
  return parseVolume(await command(`appvol ${op} ${step} ${processes.join('|')}`));
}

// Même chose pour le volume général de Windows
async function changeSystemVolume(op, step) {
  return parseVolume(await command(`sysvol ${op} ${step}`));
}

// Micro par défaut de Windows : op "get" | "mute" (bascule). Renvoie { volume, muted }
async function changeMic(op) {
  return parseVolume(await command(`micvol ${op}`));
}

// Pavé tactile de la tablette : op "move" (dx, dy en pixels) | "btn" ("l"/"r", "down"/"up") | "wheel" (delta)
function mouse(...args) {
  return command(`mouse ${args.join(' ')}`);
}

// Presse-papiers du PC (texte seulement)
async function getClipboard() {
  return Buffer.from(String(await command('clipget')).replace(/^ok:/, ''), 'base64').toString('utf8');
}
function setClipboard(text) {
  return command(`clipset ${Buffer.from(String(text), 'utf8').toString('base64')}`);
}

// Lignes "a<TAB>b<TAB>c" renvoyées en base64 par keys.ps1
const rows = async (line) => Buffer.from(String(await command(line)).replace(/^ok:/, ''), 'base64').toString('utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));

// Fenêtres ouvertes : [{ h, app, title }] ; op sur une fenêtre : "front" | "close" | "other" (autre écran)
async function listWindows() {
  return (await rows('wins')).map(([h, app, title]) => ({ h, app, title }));
}
async function windowAct(h, op) {
  if (!/^\d+$/.test(String(h)) || !['front', 'close', 'other'].includes(op)) throw new Error('demande invalide');
  const r = await command(`win ${h} ${op}`);
  if (r === 'notfound') throw new Error('cette fenêtre est déjà fermée');
}
function screenOff() {
  return command('screenoff');
}

// Sorties (flow 0) ou entrées (flow 1) son : [{ id, name, current }] ; choix de celle par défaut
async function audioDevices(flow) {
  return (await rows(`devices ${flow}`)).map(([id, name, def]) => ({ id, name, current: def === '1' }));
}
function setAudioDevice(id) {
  if (!/^\{[\d.]+\}\.\{[0-9a-f-]+\}$/i.test(String(id))) return Promise.reject(new Error('appareil son inconnu'));
  return command(`setdev ${id}`);
}

// Mélangeur : [{ name: "spotify", volume: 0-100, muted }] des programmes qui ont un son ouvert
async function listMixer() {
  const body = String(await command('mixer')).replace(/^ok:/, '');
  return body ? body.split('|').map((x) => { const [name, volume, muted] = x.split(','); return { name, volume: Number(volume), muted: muted === '1' }; }) : [];
}

// Volume exact (0-100) d'un programme, ou de Windows si name est vide
async function setVolume(name, level) {
  const v = Math.round(Math.min(100, Math.max(0, Number(level) || 0)));
  return parseVolume(await command(name ? `appvol set ${v} ${name}` : `sysvol set ${v}`));
}

// Affiche en grand la fenêtre d'un programme ; where : "same" | "secondary" | "primary".
// title (facultatif) : texte que le titre de la fenêtre doit contenir (ex. "Gmail").
// Renvoie false si aucune fenêtre ne correspond.
async function showWindow(processes, where, title = '') {
  const clean = String(title).replace(/[\r\n]+/g, ' ').trim();
  const reply = await command(`window ${where} ${processes.join('|')}${clean ? ' ' + clean : ''}`);
  return reply === 'ok';
}

// Tape un texte dans la fenêtre au premier plan (accents compris)
function typeText(text) {
  return command(`text ${Buffer.from(String(text), 'utf8').toString('base64')}`);
}

// Programme de la fenêtre au premier plan (ex. "firefox")
async function foregroundProcess() {
  return String(await command('fg')).replace(/^ok:/, '').trim().toLowerCase();
}

// Fenêtre de l'Explorateur déjà ouverte sur ce dossier : mise au premier plan (true), sinon false
async function focusFolder(folder) {
  const clean = String(folder).replace(/[\r\n]+/g, ' ').trim();
  return (await command(`folder ${clean}`)) === 'ok';
}

// Indicateur de volume en bas au milieu de l'écran principal du PC
function showOsd(label, level, muted) {
  const clean = String(label).replace(/[\r\n]+/g, ' ').trim();
  return command(`osd ${Math.round(level)} ${muted ? 1 : 0} ${clean}`);
}

function stopWorker() {
  worker?.kill();
}

module.exports = { listWindows, windowAct, screenOff, audioDevices, setAudioDevice, parseKeys, pressKeys, changeAppVolume, changeSystemVolume, changeMic, mouse, getClipboard, setClipboard, listMixer, setVolume, showWindow, focusFolder, foregroundProcess, typeText, showOsd, startWorker, stopWorker };
