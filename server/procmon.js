// Processeur et mémoire par application : lance procmon.ps1 et garde sa dernière mesure.

const { spawnHelper } = require('./helper');
const path = require('path');

let latest = { cpu: [], mem: [], time: 0 };
let child = null;

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
        latest = { cpu: msg.cpu || [], mem: msg.mem || [], time: Date.now() };
      } catch {}
    }
  });
  child.on('exit', () => {
    child = null;
    setTimeout(start, 10000); // relance si le programme s'arrête
  });
}

function startProcmon() {
  start();
  process.on('exit', () => child?.kill());
}

// { cpu: [{ name, percent }], mem: [{ name, bytes }] } — du plus gros au plus petit ; null si pas de mesure récente
function getProcesses() {
  if (Date.now() - latest.time > 6000) return null;
  return { cpu: latest.cpu, mem: latest.mem };
}

module.exports = { startProcmon, getProcesses };
