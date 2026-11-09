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

module.exports = { parseKeys, pressKeys, changeAppVolume, changeSystemVolume, showWindow, focusFolder, foregroundProcess, typeText, showOsd, startWorker, stopWorker };
