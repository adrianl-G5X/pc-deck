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
    case 'mic': // couper / remettre le micro de Windows
    case 'screenoff': // éteindre l'écran (il se rallume à la souris)
      break;
    case 'audio': // sortie son : "device" = un nom (ex. « Casque »), vide = la suivante à chaque appui
      if (a.device !== undefined && typeof a.device !== 'string') fail(where, '"device" doit être un nom de sortie son');
      a.device = (a.device || '').trim();
      break;
    case 'powerplan': // mode d'alimentation de Windows
      if (!['saver', 'balanced', 'performance'].includes(a.plan)) fail(where, '"plan" doit être "saver", "balanced" ou "performance"');
      break;
    case 'brightness': // luminosité (écran d'un PC portable)
      if (!['up', 'down'].includes(a.op)) fail(where, '"op" doit être "up" ou "down"');
      break;
    case 'cycle': // bouton à plusieurs états : chaque appui lance l'étape suivante (ex. « Mode jeu » ↔ « Mode travail »)
      if (!allowMacro) fail(where, '"cycle" ne s\'utilise pas dans une macro');
      if (!Array.isArray(a.steps) || a.steps.length < 2 || a.steps.length > 6) fail(where, '"steps" : de 2 à 6 étapes');
      a.steps = a.steps.map((st, i) => {
        if (typeof st?.label !== 'string' || !st.label.trim()) fail(`${where}, état ${i + 1}`, '"label" (nom affiché) manquant');
        return { label: st.label.trim().slice(0, 30), action: checkAction(st.action, `${where}, état ${i + 1}`, true) };
      });
      break;
    case 'http': // requête web : lumières (Home Assistant, Philips Hue), webhooks…
      if (typeof a.url !== 'string' || !/^https?:\/\/[^\s]+$/i.test(a.url)) fail(where, '"url" doit être une adresse commençant par http:// ou https://');
      a.method = (a.method || 'POST').toUpperCase();
      if (!['GET', 'POST', 'PUT'].includes(a.method)) fail(where, '"method" doit être "GET", "POST" ou "PUT"');
      if (a.body !== undefined && typeof a.body !== 'string') fail(where, '"body" doit être un texte (ex. {"entity_id": "light.salon"})');
      if (a.token !== undefined && typeof a.token !== 'string') fail(where, '"token" doit être un texte');
      // Lumière avec son état (Home Assistant) : adresse qui renvoie { "state": "on" | "off" }
      if (a.stateUrl !== undefined && (typeof a.stateUrl !== 'string' || !/^https?:\/\/\S+$/i.test(a.stateUrl))) fail(where, '"stateUrl" doit être une adresse http(s)');
      break;
    case 'power': // éteindre, redémarrer, mettre en veille (la tablette demande toujours « Tu es sûr ? »)
      if (!['shutdown', 'restart', 'sleep'].includes(a.op)) fail(where, '"op" doit être "shutdown", "restart" ou "sleep"');
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
    case 'obs': // OBS Studio : scène, enregistrement, direct, micro (ou autre source audio)
      if (!['scene', 'record', 'stream', 'mute'].includes(a.op)) fail(where, '"op" doit être "scene", "record", "stream" ou "mute"');
      if (a.op === 'scene' && (typeof a.scene !== 'string' || !a.scene.trim())) fail(where, '"scene" : nom de la scène OBS manquant');
      if (a.op === 'mute' && (typeof a.input !== 'string' || !a.input.trim())) fail(where, '"input" : nom de la source audio OBS manquant (ex. "Mic/Aux")');
      break;
    case 'timer': // minuteur (seconds > 0) ou chronomètre (seconds = 0), géré par le serveur
      if (!allowMacro) fail(where, '"timer" ne s\'utilise pas dans une macro');
      if (!Number.isInteger(a.seconds) || a.seconds < 0 || a.seconds > 86400) fail(where, '"seconds" doit être un nombre entier entre 0 (chronomètre) et 86400 (24 h)');
      break;
    case 'page': // bouton « dossier » : la tablette affiche une autre page de boutons (rien ne tourne sur le PC)
      if (!allowMacro) fail(where, '"page" ne s\'utilise pas dans une macro');
      if (typeof a.page !== 'string' || a.page.trim().length > 30) fail(where, '"page" doit être un nom de page (30 caractères au plus, vide = page principale)');
      a.page = a.page.trim();
      break;
    case 'macro':
      if (!allowMacro) fail(where, 'une macro ne peut pas contenir une autre macro');
      if (!Array.isArray(a.steps) || a.steps.length === 0) fail(where, '"steps" (liste d\'étapes) manquant');
      a.steps = a.steps.map((step, i) => checkAction(step, `${where}, étape ${i + 1}`, false));
      break;
    default:
      fail(where, `type d'action inconnu "${a.type}" (possibles : open, app, newtab, keys, volume, window, tab, lock, mic, power, http, audio, screenoff, powerplan, brightness, cycle, obs, page, timer, macro)`);
  }
  return a;
}

// Outils de la tablette (menu « Outils »)
const TOOL_IDS = ['windows', 'programs', 'files', 'snapshot', 'clips', 'pad', 'dictate', 'voice', 'device'];

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
    if (b.draft !== undefined && typeof b.draft !== 'boolean') fail(where, '"draft" doit valoir true ou false');
    if (b.confirm !== undefined && typeof b.confirm !== 'boolean') fail(where, '"confirm" doit valoir true ou false');
    if (b.logo !== undefined && typeof b.logo !== 'boolean') fail(where, '"logo" doit valoir true ou false');
    if (b.logoApp !== undefined && (typeof b.logoApp !== 'string' || b.logoApp.length > 100)) fail(where, '"logoApp" doit être le nom d\'une appli (texte)');
    if (b.logoImage !== undefined && !(typeof b.logoImage === 'string' && b.logoImage.length <= 300000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.logoImage)))
      fail(where, '"logoImage" doit être une image PNG, JPEG ou WebP de moins de 200 Ko');
    if (b.page !== undefined && (typeof b.page !== 'string' || b.page.trim().length > 30)) fail(where, '"page" doit être un nom de page (30 caractères au plus)');
    // Valeur affichée sous le nom du bouton (mini-widget)
    if (b.value !== undefined && !['cpu', 'cpuTemp', 'gpu', 'gpuTemp', 'ram', 'volume', 'clock', 'fps'].includes(b.value)) fail(where, '"value" inconnue');
    const action = checkAction(b.action, where);
    return {
      id: b.id,
      page: (b.page || '').trim(), // page de la tablette ('' = page principale)
      value: b.value || null, // valeur affichée sous le nom (cpu, cpuTemp, volume, clock…)
      logo: b.logo === true, // vrai logo du programme ou du site à la place de l'icône
      logoApp: b.logoApp || '', // logo d'une autre appli installée (son nom dans le menu Démarrer)
      logoImage: b.logoImage || '', // image personnalisée (a priorité sur le reste)
      // « Tu es sûr ? » sur la tablette : par défaut pour verrouiller le PC, au choix pour le reste
      confirm: b.confirm === undefined ? action.type === 'lock' : b.confirm,
      draft: b.draft === true, // brouillon : gardé dans la config mais pas affiché sur la tablette
      label: String(b.label ?? b.id),
      icon: String(b.icon ?? ''),
      color: b.color || null,
      action,
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
    if (t.draft !== undefined && typeof t.draft !== 'boolean') fail(where, '"draft" doit valoir true ou false');
    return {
      id: t.id,
      draft: t.draft === true, // désactivé : gardé dans la config, pas affiché sur la tablette
      label: String(t.label ?? t.id),
      style: t.style || 'switch',
      action: checkAction(t.action, where),
    };
  });

  // Application dont les boutons de son peuvent régler le volume (facultatif)
  // "audioApps" : plusieurs applis (la tablette passe de l'une à l'autre) ; l'ancien "audioApp" (une seule) reste accepté
  const rawApps = raw.audioApps !== undefined ? raw.audioApps : raw.audioApp !== undefined ? [raw.audioApp] : [];
  if (!Array.isArray(rawApps) || rawApps.length > 8) fail('audioApps', 'doit être une liste de 8 applis au plus');
  const allApps = rawApps.map((a, i) => {
    const where = `audioApps[${i}]`;
    const p = a?.processes;
    if (!Array.isArray(p) || p.length === 0 || !p.every((x) => typeof x === 'string' && /^[\w.-]+$/.test(x)))
      fail(where, '"processes" doit être une liste de noms de programmes (ex. ["opera"])');
    if (a.draft !== undefined && typeof a.draft !== 'boolean') fail(where, '"draft" doit valoir true ou false');
    return {
      label: String(a.label || p[0]),
      draft: a.draft === true,
      // nom du programme sans ".exe", en minuscules
      processes: p.map((x) => x.toLowerCase().replace(/\.exe$/, '')),
    };
  });
  if (new Set(allApps.map((a) => a.label)).size !== allApps.length) fail('audioApps', 'deux applis ont le même nom affiché');
  const audioApps = allApps.filter((a) => !a.draft); // une appli désactivée (brouillon) n'apparaît pas sur la tablette
  const audioApp = audioApps[0] || null; // première appli (ancien nom)
  if (raw.bigStepEnabled !== undefined && typeof raw.bigStepEnabled !== 'boolean') fail('racine', '"bigStepEnabled" doit valoir true ou false');

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
    // Couleurs personnalisées (vide = celles du thème) : fond, touches, texte, courbe de réception, courbe d'envoi
    colors: Object.fromEntries(['background', 'keys', 'text', 'down', 'up'].map((k) => {
      const v = d.colors?.[k];
      if (v !== undefined && v !== '' && !/^#[0-9a-f]{6}$/i.test(v)) fail('display', `"colors.${k}" doit être une couleur comme "#1b1d1f"`);
      return [k, v || ''];
    })),
    columns: Number.isInteger(cols) && cols >= 2 && cols <= 6 ? cols : 3,
    refreshMs: [1000, 2000, 5000].includes(d.refreshMs) ? d.refreshMs : 1000,
    buttonSize: ['small', 'normal', 'large'].includes(d.buttonSize) ? d.buttonSize : 'normal', // hauteur des boutons de la tablette
    playerFull: d.playerFull !== false, // toucher la carte « morceau en cours » ouvre le lecteur plein écran
    lyrics: d.lyrics === true, // paroles (cherchées en ligne sur lrclib.net : le titre et l'artiste sont envoyés à ce site)
    weather: typeof d.weather === 'string' ? d.weather.trim().slice(0, 60) : '', // ville de la météo (vide = pas de météo)
    // lien iCal secret de l'agenda (vide = pas de rendez-vous)
    calendar: typeof d.calendar === 'string' && /^(https?|webcal):\/\/\S+$/i.test(d.calendar.trim()) ? d.calendar.trim() : '',
    lockLayout: d.lockLayout === true, // pas d'appui long sur la tablette (enfants, invités)
    // Menu « Outils » de la tablette : ordre et noms (Paramètres → Affichage, ou « Modifier » sur la tablette)
    tools: {
      order: (Array.isArray(d.tools?.order) ? d.tools.order : []).filter((k) => TOOL_IDS.includes(k)),
      names: Object.fromEntries(Object.entries(d.tools?.names || {}).filter(([k, v]) => TOOL_IDS.includes(k) && typeof v === 'string' && v.trim())
        .map(([k, v]) => [k, v.trim().slice(0, 30)])),
    },
    standby: [0, 2, 5, 10, 30].includes(d.standby) ? d.standby : 0, // veille (horloge) après N minutes sans toucher
    vibrate: d.vibrate !== false, // petite vibration à chaque appui (Android, iPhone avec iOS 18+)
    show: Object.fromEntries(
      ['media', 'cpu', 'gpu', 'ram', 'power', 'cpuChart', 'gpuChart', 'netChart'].map((k) => [k, d.show?.[k] !== false])
    ),
  };

  // Démarrage avec Windows : true / false, ou null = on n'y touche pas
  const autostart = typeof raw.autostart === 'boolean' ? raw.autostart : null;

  const bigStepEnabled = raw.bigStepEnabled !== false; // « Volume par grands pas » (désactivable)
  // Profils automatiques : quand ce programme passe au premier plan sur le PC, la tablette affiche cette page
  if (!Array.isArray(raw.profiles ?? []) || (raw.profiles ?? []).length > 30) fail('profiles', 'doit être une liste de 30 profils au plus');
  const profiles = (raw.profiles ?? []).map((p, i) => {
    const where = `profil ${i + 1}`;
    if (typeof p?.process !== 'string' || !/^[\w .-]+$/.test(p.process.trim())) fail(where, '"process" doit être le nom du programme sans .exe (ex. "steam")');
    if (typeof p.page !== 'string' || p.page.trim().length > 30) fail(where, '"page" doit être un nom de page (30 caractères au plus)');
    return { process: p.process.trim().toLowerCase().replace(/\.exe$/, ''), page: p.page.trim() };
  });

  // Actions programmées : à cette heure (et ces jours-là), le bouton choisi est lancé tout seul
  if (!Array.isArray(raw.schedules ?? []) || (raw.schedules ?? []).length > 30) fail('schedules', 'doit être une liste de 30 actions programmées au plus');
  const schedules = (raw.schedules ?? []).map((s, i) => {
    const where = `action programmée ${i + 1}`;
    if (typeof s?.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) fail(where, '"time" doit être une heure comme "23:00"');
    const days = s.days ?? 'all';
    if (!['all', 'week', 'weekend'].includes(days)) fail(where, '"days" doit être "all", "week" (lundi-vendredi) ou "weekend"');
    const button = buttons.find((b) => b.id === s.button);
    if (!button) fail(where, `"button" : aucun bouton ne s'appelle "${s.button}"`);
    if (s.confirm !== undefined && typeof s.confirm !== 'boolean') fail(where, '"confirm" doit valoir true ou false');
    // Demander « Tu es sûr ? » avant : par défaut pour éteindre / redémarrer / veille et les boutons qui le demandent déjà
    const confirm = s.confirm ?? (button.action.type === 'power' || button.confirm === true);
    return { time: s.time, days, button: s.button, confirm };
  });

  // Dossier où arrivent les photos et fichiers envoyés depuis un appareil (vide = Téléchargements\PC Deck)
  const uploadDir = typeof raw.uploadDir === 'string' ? raw.uploadDir.trim() : '';
  if (uploadDir && !/^([a-z]:[\\/]|\\\\)/i.test(uploadDir)) fail('uploadDir', 'doit être un chemin complet de dossier (ex. "D:\\Photos")');

  // Temps d'écran : programme fermé tout seul après N minutes par jour (ex. un jeu)
  if (!Array.isArray(raw.limits ?? []) || (raw.limits ?? []).length > 30) fail('limits', 'doit être une liste de 30 limites au plus');
  const limits = (raw.limits ?? []).map((l, i) => {
    const where = `limite ${i + 1}`;
    if (typeof l?.process !== 'string' || !/^[\w .-]+$/.test(l.process.trim())) fail(where, '"process" doit être le nom du programme (ex. "fortnite")');
    if (!Number.isInteger(l.minutes) || l.minutes < 5 || l.minutes > 1440) fail(where, '"minutes" doit être un nombre entier entre 5 et 1440');
    return { process: l.process.trim().toLowerCase().replace(/\.exe$/, ''), minutes: l.minutes };
  });

  // OBS Studio (serveur WebSocket intégré) : port et mot de passe
  const obs = {
    port: Number.isInteger(raw.obs?.port) && raw.obs.port > 0 && raw.obs.port < 65536 ? raw.obs.port : 4455,
    password: typeof raw.obs?.password === 'string' ? raw.obs.password : '',
  };

  return { server, buttons, toggles, audioApp, audioApps, bigStepEnabled, usb, remote, display, autostart, profiles, schedules, uploadDir, limits, obs };
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
