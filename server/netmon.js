// Trafic réseau par application : lance netmon.ps1 et garde sa dernière mesure.

const { spawnHelper } = require('./helper');
const path = require('path');

const RETRY_ACCESS_MS = 5 * 60 * 1000; // droits manquants : nouvel essai toutes les 5 min
const RETRY_CRASH_MS = 30 * 1000;

let state = { ok: false, error: 'starting', apps: [], time: 0 };
let child = null;

function start() {
  child = spawnHelper('netmon', process.pid);
  let buffer = '';
  let accessDenied = false;
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.error) {
          accessDenied = msg.error === 'access';
          state = { ok: false, error: msg.error, apps: [], time: Date.now() };
        } else {
          state = { ok: true, error: null, apps: msg.apps || [], time: Date.now() };
        }
      } catch {}
    }
  });
  child.on('exit', () => {
    child = null;
    if (state.ok) state = { ok: false, error: 'stopped', apps: [], time: Date.now() };
    setTimeout(start, accessDenied ? RETRY_ACCESS_MS : RETRY_CRASH_MS);
  });
}

function startNetmon() {
  start();
  process.on('exit', () => child?.kill());
}

// { ok, error, apps: [{ name, down, up }] } — débits en octets/s, du plus gros au plus petit
function getNetworkApps() {
  if (state.ok && Date.now() - state.time > 5000) return { ok: false, error: 'stale', apps: [] };
  return { ok: state.ok, error: state.error, apps: state.apps };
}

module.exports = { startNetmon, getNetworkApps };
