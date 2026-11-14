// Mises à jour du PC : vérifie GitHub Releases, prévient, installe en un clic.
//
// Sécurité : chaque version publiée contient "update.json" (numéro de version, empreintes
// SHA-256 de l'installeur et de l'APK) et "update.json.sig", sa signature Ed25519 faite avec
// la clé privée du développeur. PC Deck ne connaît que la clé PUBLIQUE (update-key.pem) :
// une version non signée par cette clé est ignorée, même si le compte GitHub est piraté.
// Les réglages (%LOCALAPPDATA%\PC Deck) ne sont jamais touchés par une mise à jour.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { VERSION } = require('./version');

const pkg = require('../package.json');
const REPO = pkg.pcdeck?.updateRepo || '';
// PCDECK_UPDATE_URL / PCDECK_UPDATE_PUBKEY : pour les tests uniquement
const API = process.env.PCDECK_UPDATE_URL || (REPO ? `https://api.github.com/repos/${REPO}/releases/latest` : null);
const KEY_FILE = process.env.PCDECK_UPDATE_PUBKEY || path.join(__dirname, 'update-key.pem');
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
// shortcut: installeur pas encore signé (Smart App Control le bloque) : « Installer » ouvre la page GitHub de la version ; repasser à false une fois signé (SignPath)
const OPEN_RELEASE_PAGE = true;

const state = {
  configured: !!API,
  current: VERSION,
  latest: null,
  available: false,
  notes: '',
  checking: false,
  installing: false,
  error: null,
  lastCheck: null,
};
let manifest = null;
let assets = {};
let releasePage = null;

// "1.10.0" > "1.9.3"
function newer(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number);
  const pb = String(b).split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function download(url, timeoutMs = 15000) {
  const r = await fetch(url, { headers: { 'User-Agent': 'PC-Deck-updater', Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status} pour ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

function verifySignature(data, signatureBase64) {
  const key = crypto.createPublicKey(fs.readFileSync(KEY_FILE));
  return crypto.verify(null, data, key, Buffer.from(String(signatureBase64).trim(), 'base64'));
}

async function check() {
  if (!API || state.checking) return state;
  state.checking = true;
  state.error = null;
  try {
    const r = await fetch(API, { headers: { 'User-Agent': 'PC-Deck-updater', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
    if (r.status === 404) throw new Error('aucune version publiée');
    if (!r.ok) throw new Error(`GitHub a répondu ${r.status}`);
    const release = await r.json();
    releasePage = String(release.html_url || '').startsWith('https://github.com/') ? release.html_url : null;
    assets = Object.fromEntries((release.assets || []).map((a) => [a.name, a.browser_download_url]));
    if (!assets['update.json'] || !assets['update.json.sig']) throw new Error('version publiée sans fichier de signature');
    const [data, sig] = await Promise.all([download(assets['update.json']), download(assets['update.json.sig'])]);
    if (!verifySignature(data, sig.toString('utf8'))) throw new Error('signature invalide : mise à jour ignorée');
    const m = JSON.parse(data.toString('utf8'));
    if (!/^\d+\.\d+\.\d+/.test(m.version) || !/^[0-9a-f]{64}$/.test(m.setup?.sha256 || '') || !assets[m.setup?.name])
      throw new Error('fichier update.json incomplet');
    manifest = m;
    state.latest = m.version;
    state.notes = String(m.notes || '').slice(0, 4000);
    state.available = newer(m.version, VERSION);
  } catch (err) {
    state.error = err.message;
  } finally {
    state.checking = false;
    state.lastCheck = new Date().toISOString();
  }
  return state;
}

// Télécharge l'installeur, vérifie son empreinte, puis le lance (Windows demande l'autorisation).
// L'installeur ferme PC Deck, se met à jour et le relance tout seul.
async function install() {
  if (!state.available || !manifest || state.installing) throw new Error('Aucune mise à jour à installer');
  if (OPEN_RELEASE_PAGE && !process.env.PCDECK_UPDATE_DRYRUN) {
    const page = releasePage || `https://github.com/${REPO}/releases/latest`;
    spawn('explorer.exe', [page], { detached: true, stdio: 'ignore' }).unref();
    return { page };
  }
  state.installing = true;
  try {
    const data = await download(assets[manifest.setup.name], 10 * 60 * 1000);
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    if (sha !== manifest.setup.sha256) throw new Error('fichier téléchargé abîmé ou modifié (empreinte différente) : installation annulée');
    const file = path.join(os.tmpdir(), `PCDeck-Setup-${manifest.version}.exe`);
    fs.writeFileSync(file, data);
    if (process.env.PCDECK_UPDATE_DRYRUN) return { file, dryRun: true };
    const quoted = file.replace(/'/g, "''");
    // Windows peut refuser de lancer l'installeur (non signé + Contrôle intelligent des applications, ou autorisation refusée) : on le dit
    const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
      `try { Start-Process -FilePath '${quoted}' -ArgumentList '/SILENT','/SUPPRESSMSGBOXES','/NORESTART' -Verb RunAs -ErrorAction Stop } catch { [Console]::Error.Write($_.Exception.Message); exit 1 }`],
    { detached: true, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let why = '';
    child.stderr.on('data', (d) => { why += d; });
    child.on('close', (code) => {
      if (!code) return;
      state.error = /annul|cancel|1223/i.test(why) ? "Autorisation refusée : l'installation n'a pas démarré."
        : /bloqu|stratégie|policy|4551|application control/i.test(why) ? "Windows (Contrôle intelligent des applications) bloque l'installeur car il n'est pas encore signé. Désactive-le dans Sécurité Windows, ou lance l'installeur à la main."
        : `L'installation n'a pas démarré : ${why.trim() || 'erreur inconnue'}`;
    });
    child.unref();
    return { file };
  } catch (err) {
    state.error = err.message;
    throw err;
  } finally {
    state.installing = false;
  }
}

function startUpdates() {
  if (!API) return;
  setTimeout(check, 30 * 1000);
  setInterval(check, CHECK_EVERY_MS);
}

module.exports = { startUpdates, check, install, getState: () => state, newer };
