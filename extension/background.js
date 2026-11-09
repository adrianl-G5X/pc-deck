// Extension PC Deck : relie le navigateur au serveur PC Deck du même PC.
// Le serveur demande :
//   { id, cmd: "focus", match }  -> met au premier plan le premier onglet dont l'adresse correspond
//   { id, cmd: "open", url, match } -> ouvre un nouvel onglet (à côté des onglets du même site s'il y en a)
// L'extension répond { id, ok, found, title } ou { id, ok: false, error }.
// Elle ne se connecte qu'à 127.0.0.1 (ce PC) et n'exécute rien d'autre.

const SERVER = 'ws://127.0.0.1:8787/ext';
let socket = null;

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  try {
    socket = new WebSocket(SERVER);
  } catch {
    return;
  }
  socket.onopen = () => socket.send(JSON.stringify({
    type: 'hello',
    version: chrome.runtime.getManifest().version,
    userAgent: navigator.userAgent,
  }));
  socket.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'ping') return; // garde l'extension éveillée
    if (!msg.id || !msg.cmd) return;
    let reply;
    try {
      reply = await handle(msg);
    } catch (err) {
      reply = { ok: false, error: String(err && err.message || err) };
    }
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: msg.id, ...reply }));
  };
  socket.onclose = () => {
    socket = null;
    setTimeout(connect, 5000); // serveur arrêté : nouvel essai
  };
  socket.onerror = () => {};
}

async function bringToFront(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  const win = await chrome.windows.get(tab.windowId);
  await chrome.windows.update(tab.windowId, {
    focused: true,
    ...(win.state === 'minimized' ? { state: 'maximized' } : {}),
  });
  const fresh = await chrome.tabs.get(tab.id);
  return { ok: true, found: true, title: fresh.title || '' };
}

async function handle(msg) {
  if (msg.cmd === 'focus') {
    const tabs = await chrome.tabs.query({ url: msg.match });
    if (!tabs.length) return { ok: true, found: false };
    // Préfère l'onglet utilisé le plus récemment
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return bringToFront(tabs[0]);
  }
  if (msg.cmd === 'open') {
    if (!/^https?:\/\//i.test(msg.url || '')) return { ok: false, error: 'adresse invalide' };
    // Ouvre le nouvel onglet juste à droite de l'onglet de ce site utilisé en dernier
    // (ex. à droite de Gmail) ; sinon à la fin de la dernière fenêtre utilisée.
    let windowId;
    let index;
    if (msg.match) {
      const same = await chrome.tabs.query({ url: msg.match });
      same.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      if (same.length) {
        windowId = same[0].windowId;
        index = same[0].index + 1;
      }
    }
    if (windowId === undefined) {
      try { windowId = (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id; } catch {}
    }
    const tab = windowId === undefined
      ? (await chrome.windows.create({ url: msg.url, focused: true })).tabs[0]
      : await chrome.tabs.create({ url: msg.url, windowId, active: true, ...(index !== undefined ? { index } : {}) });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { ok: true, found: false, title: tab.title || '' };
  }
  if (msg.cmd === 'reload') {
    // Le serveur a une version plus récente de l'extension : on la recharge
    setTimeout(() => chrome.runtime.reload(), 200);
    return { ok: true };
  }
  return { ok: false, error: 'commande inconnue' };
}

// Se (re)connecte au démarrage du navigateur, à l'installation, et chaque minute au cas où
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.alarms.create('pcdeck-keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(connect);
connect();
