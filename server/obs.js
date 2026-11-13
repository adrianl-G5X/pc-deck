// OBS Studio : boutons de scène, enregistrement, direct, micro. Passe par le serveur WebSocket
// intégré à OBS (version 28 et plus : Outils → Paramètres du serveur WebSocket, port 4455).
// Une seule connexion, ouverte au premier appui puis gardée ; rouverte si OBS a été fermé.

const WebSocket = require('ws');
const crypto = require('crypto');

let settings = { port: 4455, password: '' };
let sock = null, ready = null, nextId = 1;
const waiting = new Map(); // requestId -> { resolve, reject, timer }

const sha = (s) => crypto.createHash('sha256').update(s).digest('base64');

function configure(obs) {
  const changed = obs.port !== settings.port || obs.password !== settings.password;
  settings = { port: obs.port, password: obs.password };
  if (changed && sock) sock.terminate(); // nouveau mot de passe : nouvelle connexion au prochain appui
}

function connect() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${settings.port}`);
    sock = ws;
    const fail = (msg) => { reject(new Error(msg)); ws.terminate(); };
    const timer = setTimeout(() => fail('OBS ne répond pas'), 4000);
    ws.on('error', () => {}); // l'erreur est traitée dans "close"
    ws.on('close', (code) => {
      clearTimeout(timer);
      if (sock === ws) { sock = null; ready = null; }
      for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(new Error('Connexion à OBS perdue')); }
      waiting.clear();
      reject(new Error(code === 4009 ? 'Mot de passe OBS refusé : vérifie-le dans les Paramètres de PC Deck (Avancé)'
        : 'OBS n\'est pas ouvert, ou son serveur WebSocket est désactivé (OBS : Outils → Paramètres du serveur WebSocket)'));
    });
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (m.op === 0) { // Hello : on s'identifie (avec le mot de passe si OBS en demande un)
        const auth = m.d.authentication;
        if (auth && !settings.password) return fail('OBS demande un mot de passe : indique-le dans les Paramètres de PC Deck (Avancé)');
        const d = { rpcVersion: 1, eventSubscriptions: 0 };
        if (auth) d.authentication = sha(sha(settings.password + auth.salt) + auth.challenge);
        ws.send(JSON.stringify({ op: 1, d }));
      } else if (m.op === 2) { // Identified
        clearTimeout(timer);
        resolve(ws);
      } else if (m.op === 7) { // réponse à une demande
        const w = waiting.get(m.d.requestId);
        if (!w) return;
        waiting.delete(m.d.requestId);
        clearTimeout(w.timer);
        if (m.d.requestStatus.result) w.resolve(m.d.responseData || {});
        else w.reject(new Error(`OBS : ${m.d.requestStatus.comment || 'demande refusée (code ' + m.d.requestStatus.code + ')'}`));
      }
    });
  });
  ready.catch(() => {});
  return ready;
}

async function request(requestType, requestData) {
  const ws = await connect();
  const requestId = String(nextId++);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(requestId); reject(new Error('OBS ne répond pas')); }, 5000);
    waiting.set(requestId, { resolve, reject, timer });
    ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  });
}

// action : { type: "obs", op: "scene" | "record" | "stream" | "mute", scene?, input? }
async function runObs(a) {
  switch (a.op) {
    case 'scene': await request('SetCurrentProgramScene', { sceneName: a.scene }); return `OBS : scène « ${a.scene} »`;
    case 'record': { const r = await request('ToggleRecord'); return r.outputActive ? 'OBS : enregistrement lancé' : 'OBS : enregistrement arrêté'; }
    case 'stream': { const r = await request('ToggleStream'); return r.outputActive ? 'OBS : direct lancé' : 'OBS : direct arrêté'; }
    case 'mute': { const r = await request('ToggleInputMute', { inputName: a.input }); return `OBS : ${a.input} ${r.inputMuted ? 'coupé' : 'actif'}`; }
  }
}

// État d'un bouton OBS : true = enregistrement / direct en cours, ou source coupée ; null = OBS fermé.
// OBS fermé : on ne réessaie que toutes les 10 s.
let downUntil = 0;
async function obsState(a) {
  if (a.op === 'scene' || Date.now() < downUntil) return null;
  try {
    if (a.op === 'record') return (await request('GetRecordStatus')).outputActive;
    if (a.op === 'stream') return (await request('GetStreamStatus')).outputActive;
    return (await request('GetInputMute', { inputName: a.input })).inputMuted;
  } catch {
    if (!sock) downUntil = Date.now() + 10000;
    return null;
  }
}

module.exports = { configure, runObs, obsState, sha };
