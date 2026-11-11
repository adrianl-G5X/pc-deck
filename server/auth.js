// Appairage : sur le PC, la page « Connecter un appareil » affiche un code à 6 chiffres
// À USAGE UNIQUE, valable 5 minutes. L'appareil le tape (ou scanne le QR code) et reçoit
// un jeton secret qu'il garde et renvoie à chaque connexion.
// devices.json (dossier de données) contient les jetons, sous forme chiffrée.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { DATA_DIR } = require('./paths');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');

const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60 * 1000;
const failures = new Map(); // adresse IP -> { count, lockedUntil }

function readOne(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); // ignore le BOM
}
// Fichier illisible (écriture en cours...) : on lit la copie de secours plutôt que de « oublier » tous les appareils
function readJson(file, fallback) {
  for (const f of [file, file + '.bak']) {
    try { return readOne(f); } catch { /* essai suivant */ }
  }
  return fallback;
}

// Écriture en deux temps : un lecteur ne voit jamais un fichier à moitié écrit
function writeJson(file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const text = JSON.stringify(value, null, 2);
  fs.writeFileSync(file + '.tmp', text);
  fs.writeFileSync(file + '.bak', text);
  fs.renameSync(file + '.tmp', file);
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// Code en cours : { code, expires, failures, paired: [noms des appareils connectés avec] }
const CODE_MS = 5 * 60 * 1000;
const MAX_CODE_FAILURES = 10; // tous appareils confondus : au-delà, le code est annulé
let pending = null;

function newPairingCode() {
  pending = {
    code: String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'),
    expires: Date.now() + CODE_MS,
    failures: 0,
    paired: [],
  };
  return pairingStatus();
}

// Pour la page « Connecter un appareil » (seulement sur ce PC)
function pairingStatus() {
  if (!pending) return { code: null, secondsLeft: 0, paired: [] };
  const left = Math.max(0, Math.round((pending.expires - Date.now()) / 1000));
  return { code: left > 0 ? pending.code : null, secondsLeft: left, paired: pending.paired };
}

function sameText(a, b) {
  const ha = Buffer.from(sha256(String(a)));
  const hb = Buffer.from(sha256(String(b)));
  return crypto.timingSafeEqual(ha, hb);
}

// Renvoie un nouveau jeton, ou lève une erreur si le code est faux.
function pair(code, ip, deviceName) {
  const now = Date.now();
  const entry = failures.get(ip) || { count: 0, lockedUntil: 0 };
  if (entry.lockedUntil > now) {
    const minutes = Math.ceil((entry.lockedUntil - now) / 60000);
    throw new Error(`Trop d'essais. Réessaie dans ${minutes} min.`);
  }
  const valid = pending && pending.code && Date.now() < pending.expires && /^\d{6}$/.test(String(code));
  if (!valid || !sameText(code, pending.code)) {
    if (pending?.code && ++pending.failures >= MAX_CODE_FAILURES) pending.code = null;
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) {
      entry.count = 0;
      entry.lockedUntil = now + LOCK_MS;
    }
    failures.set(ip, entry);
    throw new Error(valid ? 'Code incorrect.' : 'Pas de code en cours, ou code expiré. Sur le PC : clic droit sur l\'icône PC Deck, « Connecter un appareil ».');
  }
  failures.delete(ip);
  // Usage unique : pour un 2e appareil, la page du PC affiche un nouveau code
  pending.code = null;
  pending.paired.push(String(deviceName || 'Appareil').slice(0, 60));

  const token = crypto.randomBytes(32).toString('hex');
  const devices = readJson(DEVICES_FILE, []);
  devices.push({
    name: String(deviceName || 'Appareil').slice(0, 60),
    tokenHash: sha256(token),
    pairedAt: new Date().toISOString(),
  });
  writeJson(DEVICES_FILE, devices);
  return token;
}

// Identifiant court d'un appareil (début de l'empreinte de son jeton) : sert à le retirer
const deviceId = (token) => sha256(String(token)).slice(0, 12);

function listDevices() {
  return readJson(DEVICES_FILE, []).map((d) => ({ id: d.tokenHash.slice(0, 12), name: d.name, pairedAt: d.pairedAt }));
}

// Retire un appareil : il devra être reconnecté avec un nouveau code
function removeDevice(id) {
  const devices = readJson(DEVICES_FILE, []);
  const kept = devices.filter((d) => d.tokenHash.slice(0, 12) !== id);
  if (kept.length === devices.length) return false;
  writeJson(DEVICES_FILE, kept);
  return true;
}

function isValidToken(token) {
  if (typeof token !== 'string' || token.length !== 64) return false;
  const hash = sha256(token);
  return readJson(DEVICES_FILE, []).some((d) => sameText(d.tokenHash, hash));
}

module.exports = { newPairingCode, pairingStatus, pair, isValidToken, deviceId, listDevices, removeDevice };
