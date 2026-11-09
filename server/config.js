// Lecture et vérification de config.json (dans %LOCALAPPDATA%\PC Deck, voir paths.js).
// Le fichier est relu automatiquement quand tu l'enregistres.

const fs = require('fs');
const path = require('path');
const { parseKeys } = require('./keys');

const { CONFIG_PATH } = require('./paths');

function fail(where, message) {
  throw new Error(`config.json, ${where} : ${message}`);
}

// Vérifie une action et la prépare (ex. "ctrl+c" -> codes de touches).
function checkAction(action, where, allowMacro = true) {
  if (!action || typeof action !== 'object') fail(where, '"action" manquant');
  const a = { ...action };
  switch (a.type) {
    case 'open':
      if (typeof a.target !== 'string' || !a.target) fail(where, '"target" (lien ou fichier) manquant');
      if (a.newWindow !== undefined && typeof a.newWindow !== 'boolean')
        fail(where, '"newWindow" doit valoir true ou false');
      if (a.newInstance !== undefined && typeof a.newInstance !== 'boolean') fail(where, '"newInstance" doit valoir true ou false');
      break;
    case 'newtab':
      if (typeof a.folder === 'string' && a.folder) break; // nouvel onglet de l'Explorateur sur ce dossier
      // Nouvel onglet dans un navigateur : "path" (son .exe, pour le lancer s'il est fermé) ou "process"
      if (typeof a.path !== 'string' && !(typeof a.process === 'string' && /^[\w.-]+$/.test(a.process)))
        fail(where, 'il faut "path" (chemin du navigateur) ou "process" (ex. "chrome")');
      break;
    case 'app':
      if (typeof a.path !== 'string' && typeof a.appId !== 'string')
        fail(where, 'il faut "path" (chemin du .exe) ou "appId" (application du Store)');
      if (a.newInstance !== undefined && typeof a.newInstance !== 'boolean') fail(where, '"newInstance" doit valoir true ou false');
      if (a.screen !== undefined && !['same', 'primary', 'secondary'].includes(a.screen))
        fail(where, '"screen" doit être "same", "primary" ou "secondary"');
      if (a.args !== undefined && !(Array.isArray(a.args) && a.args.every((x) => typeof x === 'string')))
        fail(where, '"args" doit être une liste de textes');
      break;
    case 'keys':
      if (typeof a.keys !== 'string') fail(where, '"keys" manquant (ex. "ctrl+shift+esc")');
      try {
        a.codes = parseKeys(a.keys);
      } catch (err) {
        fail(where, err.message);
      }
      a.repeat = a.repeat === undefined ? 1 : a.repeat;
      if (!Number.isInteger(a.repeat) || a.repeat < 1 || a.repeat > 50)
        fail(where, '"repeat" doit être un nombre entier entre 1 et 50');
      break;
    case 'lock':
      break;
    case 'tab':
      // "url" : adresse à ouvrir ; "match" : modèle des onglets à retrouver (ex. "https://mail.google.com/*")
      if (typeof a.url !== 'string' || !/^https?:\/\//i.test(a.url))
        fail(where, '"url" doit être une adresse web commençant par https://');
      if (a.match === undefined) a.match = new URL(a.url).origin + '/*';
      if (typeof a.match !== 'string' || !/^(\*|https?):\/\/[^/]+\/.*$/.test(a.match))
        fail(where, '"match" doit ressembler à "https://mail.google.com/*"');
      break;
    case 'window': {
      // "process" : nom du programme sans .exe (ou une liste de noms)
      const list = Array.isArray(a.process) ? a.process : [a.process];
      if (!list.length || !list.every((x) => typeof x === 'string' && /^[\w.-]+$/.test(x)))
        fail(where, '"process" doit être le nom du programme sans .exe (ex. "opera")');
      a.processes = list.map((x) => x.toLowerCase().replace(/\.exe$/, ''));
      a.screen = a.screen === undefined ? 'same' : a.screen;
      if (!['same', 'secondary', 'primary'].includes(a.screen))
        fail(where, '"screen" doit être "same" (dernier écran utilisé), "secondary" ou "primary"');
      if (a.title !== undefined && (typeof a.title !== 'string' || !a.title.trim()))
        fail(where, '"title" doit être un texte (ex. "Gmail")');
      for (const key of ['ifNotRunning', 'secondClick']) {
        if (a[key] === undefined) continue;
        if (a[key]?.type === 'window') fail(where, `"${key}" ne peut pas être une action "window"`);
        a[key] = checkAction(a[key], `${where}, ${key}`, allowMacro);
      }
      break;
    }
    case 'volume':
      if (!['up', 'down', 'mute'].includes(a.op)) fail(where, '"op" doit être "up", "down" ou "mute"');
      // "step" = pas normal, "bigStep" = pas quand la case "de 10 en 10" est cochée
      a.step = a.step === undefined ? 2 : a.step;
      a.bigStep = a.bigStep === undefined ? 10 : a.bigStep;
      for (const key of ['step', 'bigStep']) {
        if (!Number.isInteger(a[key]) || a[key] < 1 || a[key] > 50)
          fail(where, `"${key}" (en %) doit être un nombre entier entre 1 et 50`);
      }
      break;
    case 'wait':
      if (allowMacro) fail(where, '"wait" ne s\'utilise que dans les étapes d\'une macro');
      if (!Number.isInteger(a.ms) || a.ms < 0 || a.ms > 10000)
        fail(where, '"ms" doit être un nombre entier entre 0 et 10000');
      break;
    case 'macro':
      if (!allowMacro) fail(where, 'une macro ne peut pas contenir une autre macro');
      if (!Array.isArray(a.steps) || a.steps.length === 0) fail(where, '"steps" (liste d\'étapes) manquant');
      a.steps = a.steps.map((step, i) => checkAction(step, `${where}, étape ${i + 1}`, false));
      break;
    default:
      fail(where, `type d'action inconnu "${a.type}" (possibles : open, app, newtab, keys, volume, window, tab, lock, macro)`);
  }
  return a;
}

function loadConfig() {
  let raw;
  try {
    // .replace : ignore le BOM qu'ajoutent certains éditeurs au début du fichier
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    throw new Error(`config.json illisible : ${err.message}`);
  }
  return parseConfig(raw);
}

// Vérifie une configuration déjà lue (aussi utilisée par les tests et les modèles)
function parseConfig(raw) {
  const server = {
    host: raw.server?.host || '127.0.0.1',
    port: Number(process.env.PORT) || Number(raw.server?.port) || 8787,
  };

  if (!Array.isArray(raw.buttons)) fail('racine', '"buttons" doit être une liste');
  const ids = new Set();
  const buttons = raw.buttons.map((b, i) => {
    const where = `bouton ${i + 1}${b?.label ? ` ("${b.label}")` : ''}`;
    if (typeof b?.id !== 'string' || !/^[a-z0-9-]+$/.test(b.id))
      fail(where, '"id" doit contenir seulement des minuscules, chiffres et tirets');
    if (ids.has(b.id)) fail(where, `"id" en double : ${b.id}`);
    ids.add(b.id);
    if (b.color !== undefined && b.color !== null && !/^#[0-9a-f]{6}$/i.test(b.color))
      fail(where, '"color" doit être une couleur comme "#f2a33a"');
    return {
      id: b.id,
      label: String(b.label ?? b.id),
      icon: String(b.icon ?? ''),
      color: b.color || null,
      action: checkAction(b.action, where),
      // Double appui : action choisie, null = rien, absent = automatique (nouvel onglet pour un navigateur)
      double: b.double === undefined || b.double === null ? b.double : checkAction(b.double, `${where}, double appui`),
    };
  });

  // Interrupteurs à deux positions (ex. micro Discord coupé / actif).
  // La même action est lancée à chaque bascule ; le serveur retient la position.
  if (!Array.isArray(raw.toggles ?? [])) fail('racine', '"toggles" doit être une liste');
  const toggles = (raw.toggles ?? []).map((t, i) => {
    const where = `interrupteur ${i + 1}${t?.label ? ` ("${t.label}")` : ''}`;
    if (typeof t?.id !== 'string' || !/^[a-z0-9-]+$/.test(t.id))
      fail(where, '"id" doit contenir seulement des minuscules, chiffres et tirets');
    if (ids.has(t.id)) fail(where, `"id" en double : ${t.id}`);
    ids.add(t.id);
    if (t.style !== undefined && !['mic', 'switch'].includes(t.style))
      fail(where, '"style" doit être "mic" ou "switch"');
    return {
      id: t.id,
      label: String(t.label ?? t.id),
      style: t.style || 'switch',
      action: checkAction(t.action, where),
    };
  });

  // Application dont les boutons de son peuvent régler le volume (facultatif)
  let audioApp = null;
  if (raw.audioApp !== undefined) {
    const p = raw.audioApp?.processes;
    if (!Array.isArray(p) || p.length === 0 || !p.every((x) => typeof x === 'string' && /^[\w.-]+$/.test(x)))
      fail('audioApp', '"processes" doit être une liste de noms de programmes (ex. ["opera"])');
    audioApp = {
      label: String(raw.audioApp.label || p[0]),
      // nom du programme sans ".exe", en minuscules
      processes: p.map((x) => x.toLowerCase().replace(/\.exe$/, '')),
    };
  }

  // Mode USB de secours (adb reverse)
  const usb = {
    enabled: raw.usb?.enabled !== false,
    adbPath: typeof raw.usb?.adbPath === 'string' ? raw.usb.adbPath : '',
  };

  // Contrôle à distance (voir et piloter l'écran du PC) : désactivé si absent
  const remote = {
    view: raw.remoteControl?.enabled === true,
    control: raw.remoteControl?.enabled === true && raw.remoteControl?.viewOnly !== true,
  };

  // Affichage sur la tablette (modifiable dans la page Paramètres)
  const d = raw.display || {};
  const cols = Number(d.columns);
  const display = {
    theme: d.theme === 'light' ? 'light' : 'dark',
    accent: /^#[0-9a-f]{6}$/i.test(d.accent || '') ? d.accent : '#f2a33a',
    columns: Number.isInteger(cols) && cols >= 2 && cols <= 6 ? cols : 3,
    refreshMs: [1000, 2000, 5000].includes(d.refreshMs) ? d.refreshMs : 1000,
    show: Object.fromEntries(
      ['cpu', 'gpu', 'ram', 'power', 'cpuChart', 'gpuChart', 'netChart'].map((k) => [k, d.show?.[k] !== false])
    ),
  };

  // Démarrage avec Windows : true / false, ou null = on n'y touche pas
  const autostart = typeof raw.autostart === 'boolean' ? raw.autostart : null;

  return { server, buttons, toggles, audioApp, usb, remote, display, autostart };
}

// Relance "onChange" à chaque enregistrement de config.json.
function watchConfig(onChange) {
  let timer = null;
  fs.watch(CONFIG_PATH, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        onChange(loadConfig());
        console.log('config.json rechargé.');
      } catch (err) {
        console.error(`⚠ ${err.message}\n  (l'ancienne configuration reste active)`);
      }
    }, 300);
  });
}

module.exports = { loadConfig, parseConfig, watchConfig, CONFIG_PATH };
