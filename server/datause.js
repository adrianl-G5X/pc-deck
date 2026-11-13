// Données échangées avec chaque appareil (Wi-Fi ou données mobiles), comptées par le PC :
// écran du PC et son, fichiers et vidéos, et le reste (boutons, infos, morceau en cours…).
// Gardées 31 jours dans le dossier de données (donnees.json).

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');

const FILE = path.join(DATA_DIR, 'donnees.json');
let data = {}; // { appareil: { "2026-11-13": { screen, files, other } } } en octets
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
let dirty = false;
const today = () => new Date().toLocaleDateString('sv-SE');

function add(device, kind, bytes) {
  if (!device || !(bytes > 0)) return;
  const day = ((data[device] = data[device] || {})[today()] = data[device][today()] || { screen: 0, files: 0, other: 0 });
  day[kind] += bytes;
  dirty = true;
}

setInterval(() => {
  if (!dirty) return;
  dirty = false;
  const keep = new Date(Date.now() - 31 * 86400000).toLocaleDateString('sv-SE');
  for (const dev of Object.values(data)) for (const d of Object.keys(dev)) if (d < keep) delete dev[d];
  try { fs.writeFileSync(FILE, JSON.stringify(data)); } catch {}
}, 60000).unref();

// Réponse HTTP comptée (fichier, vidéo) : chaque morceau envoyé est ajouté à l'appareil
function meter(res, device) {
  const write = res.write;
  res.write = function (chunk, ...rest) { add(device, 'files', chunk?.length || 0); return write.call(this, chunk, ...rest); };
}

// WebSocket : ce qui est passé depuis la dernière mesure (dans les deux sens)
function countSocket(ws, kind) {
  const s = ws._socket;
  if (!s || !ws.deviceId) return;
  const total = (s.bytesWritten || 0) + (s.bytesRead || 0);
  add(ws.deviceId, kind, total - (ws.lastBytes || 0));
  ws.lastBytes = total;
}

// { today: { screen, files, other }, month: {…} } (30 derniers jours)
function report(device) {
  const days = data[device] || {};
  const zero = () => ({ screen: 0, files: 0, other: 0 });
  const month = zero();
  const from = new Date(Date.now() - 30 * 86400000).toLocaleDateString('sv-SE');
  for (const [d, v] of Object.entries(days)) if (d >= from) for (const k of Object.keys(month)) month[k] += v[k] || 0;
  return { today: { ...zero(), ...(days[today()] || {}) }, month };
}

module.exports = { add, meter, countSocket, report };
