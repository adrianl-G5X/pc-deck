// Processeur et mémoire par application : lance procmon.ps1 et garde sa dernière mesure.

const { spawnHelper } = require('./helper');
const path = require('path');

let latest = { cpu: [], mem: [], fps: null, time: 0 };
let child = null;
let foreground = ''; // programme de la fenêtre au premier plan (sans .exe, en minuscules)
let onForeground = null;

function start() {
  child = spawnHelper('procmon', process.pid);
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try {
        const msg = JSON.parse(line);
        latest = { cpu: msg.cpu || [], mem: msg.mem || [], fps: Number.isInteger(msg.fps) ? msg.fps : null, time: Date.now() };
        const fg = String(msg.fg || '').toLowerCase();
        if (fg !== foreground) { foreground = fg; onForeground?.(fg); }
      } catch {}
    }
  });
  child.on('exit', () => {
    child = null;
    setTimeout(start, 10000); // relance si le programme s'arrête
  });
}

// fn(nom) est appelée quand la fenêtre au premier plan change de programme
function startProcmon(fn) {
  onForeground = fn;
  start();
  process.on('exit', () => child?.kill());
}

// { cpu: [{ name, percent }], mem: [{ name, bytes }] } — du plus gros au plus petit ; null si pas de mesure récente
function getProcesses() {
  if (Date.now() - latest.time > 6000) return null;
  return { cpu: latest.cpu, mem: latest.mem };
}

// Images par seconde du jeu au premier plan (RivaTuner / MSI Afterburner), ou null
const getFps = () => (Date.now() - latest.time > 6000 ? null : latest.fps);

module.exports = { startProcmon, getProcesses, getFps, getForeground: () => (Date.now() - latest.time > 6000 ? '' : foreground) };
