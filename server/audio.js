// Son du PC pour les appareils qui regardent l'écran (bouton « Son » du contrôle à distance).
// Un seul programme de capture (audio.ps1) pour tous les auditeurs ; arrêté quand plus personne n'écoute.
// Envoi en binaire sur la WebSocket : "A" + fréquence (4 octets) + PCM 16 bits stéréo.

const { spawnHelper } = require('./helper');

const listeners = new Set();
let child = null, rate = 48000, restartTimer = null;

function start() {
  child = spawnHelper('audio', process.pid);
  let buf = Buffer.alloc(0);
  child.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4) {
      const len = buf.readInt32LE(0);
      if (buf.length < 4 + len) break;
      const p = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);
      if (p[0] === 0x52 && len < 16) { rate = Number(p.subarray(1).toString()) || 48000; continue; } // "R48000"
      const head = Buffer.alloc(5);
      head[0] = 0x41; // "A" : son (les images de l'écran commencent par 0xFF)
      head.writeUInt32LE(rate, 1);
      const packet = Buffer.concat([head, p]);
      for (const ws of listeners) {
        if (ws.readyState !== ws.OPEN) { listeners.delete(ws); continue; }
        if (ws.bufferedAmount < 400_000) ws.send(packet, { binary: true }); // réseau saturé : on saute ce morceau
      }
    }
  });
  child.stderr.on('data', (d) => console.error(`[audio.ps1] ${d.toString().trim()}`));
  child.on('exit', () => {
    child = null;
    // Sortie son changée (casque branché...) ou erreur : relancé tant que quelqu'un écoute
    if (listeners.size) restartTimer = setTimeout(() => listeners.size && !child && start(), 2000);
  });
}

function listen(ws, on) {
  if (on) listeners.add(ws); else listeners.delete(ws);
  if (listeners.size && !child) start();
  if (!listeners.size && child) { clearTimeout(restartTimer); child.kill(); child = null; }
}

module.exports = { listen, isListening: (ws) => listeners.has(ws) };
