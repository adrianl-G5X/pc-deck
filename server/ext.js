// Liaison avec l'extension de navigateur PC Deck (dossier "extension/").
// L'extension se connecte depuis ce PC sur ws://127.0.0.1:<port>/ext.
// Le serveur lui demande de retrouver un onglet ou d'en ouvrir un nouveau.
// Plusieurs connexions peuvent coexister (ex. extension présente dans 2 profils) :
// on les garde toutes et on s'adresse à la plus récente.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Version de l'extension présente dans le dossier "extension/"
function folderVersion() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'extension', 'manifest.json'), 'utf8').replace(/^﻿/, '');
    return JSON.parse(raw).version;
  } catch {
    return null;
  }
}

const sockets = []; // connexions ouvertes, la plus récente en dernier
const pending = new Map(); // id de requête -> fonction de réponse

function attachExtension(ws) {
  sockets.push(ws);
  if (sockets.length === 1) console.log('Extension navigateur connectée (onglets).');
  const ping = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
  }, 20000); // garde l'extension éveillée

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'hello') {
      const wanted = folderVersion();
      if (msg.version && msg.version === wanted) {
        console.log(`Extension navigateur à jour (version ${msg.version}).`);
      } else if (!msg.version) {
        console.log('Extension navigateur ancienne : clique « Recharger » sur PC Deck – onglets dans opera://extensions.');
      } else if (wanted && msg.version !== wanted) {
        console.log(`Extension navigateur ${msg.version} -> ${wanted} : rechargement automatique.`);
        ws.send(JSON.stringify({ id: crypto.randomUUID(), cmd: 'reload' }));
      }
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  ws.on('close', () => {
    clearInterval(ping);
    const i = sockets.indexOf(ws);
    if (i >= 0) sockets.splice(i, 1);
    if (sockets.length === 0) console.log('Extension navigateur déconnectée.');
  });
}

function current() {
  for (let i = sockets.length - 1; i >= 0; i--) if (sockets[i].readyState === sockets[i].OPEN) return sockets[i];
  return null;
}

function isConnected() {
  return !!current();
}

// Cherche l'onglet dans toutes les extensions connectées (la plus récente d'abord)
async function focus(match) {
  for (const socket of [...sockets].reverse()) {
    if (socket.readyState !== socket.OPEN) continue;
    try {
      const reply = await request({ cmd: 'focus', match }, 4000, socket);
      if (reply.found) return reply;
    } catch {}
  }
  return { ok: true, found: false };
}

// Envoie une commande ; renvoie la réponse { ok, found, title } ou lève une erreur.
function request(message, timeoutMs = 4000, socket = current()) {
  if (!socket) return Promise.reject(new Error('extension non connectée'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("l'extension ne répond pas"));
    }, timeoutMs);
    pending.set(id, (reply) => {
      clearTimeout(timer);
      if (reply.ok) resolve(reply);
      else reject(new Error(reply.error || 'échec'));
    });
    socket.send(JSON.stringify({ id, ...message }));
  });
}

module.exports = { attachExtension, isConnected, request, focus, count: () => sockets.length };
