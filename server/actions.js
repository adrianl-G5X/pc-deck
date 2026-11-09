// Exécution des actions. La tablette envoie seulement l'"id" d'un bouton :
// l'action réellement lancée vient toujours de config.json, jamais du client.

const { spawn } = require('child_process');
const { pressKeys, changeAppVolume, changeSystemVolume, showWindow, showOsd } = require('./keys');

function launch(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', (err) => reject(new Error(`impossible de lancer ${command} (${err.message})`)));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Navigateur par défaut (pour ouvrir une NOUVELLE fenêtre) ----------
// Lu dans le registre Windows, ex. "C:\...\Opera GX\opera.exe".
const { execFile } = require('child_process');
function regQuery(key, value) {
  return new Promise((resolve) => {
    const args = ['query', key, ...(value ? ['/v', value] : ['/ve'])];
    execFile('reg.exe', args, { windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      const m = /REG_\w+\s+(.*)$/m.exec(out.toString());
      resolve(m ? m[1].trim() : null);
    });
  });
}
let browserCache = null;
async function defaultBrowserExe() {
  if (browserCache && Date.now() - browserCache.time < 60000) return browserCache.exe;
  const base = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https';
  const progId = (await regQuery(`${base}\\UserChoiceLatest\\ProgId`, 'ProgId')) || (await regQuery(`${base}\\UserChoice`, 'ProgId'));
  let exe = null;
  if (progId) {
    const cmd = await regQuery(`HKCR\\${progId}\\shell\\open\\command`);
    const m = cmd && (/^"([^"]+\.exe)"/i.exec(cmd) || /^(\S+\.exe)/i.exec(cmd));
    exe = m ? m[1] : null;
  }
  browserCache = { exe, time: Date.now() };
  return exe;
}

async function openUrl(action) {
  if (action.newWindow && /^https?:\/\//i.test(action.target)) {
    const exe = await defaultBrowserExe();
    // Les navigateurs (Opera, Chrome, Edge, Firefox) comprennent --new-window
    if (exe) return launch(exe, ['--new-window', action.target]);
  }
  // Explorer ouvre un lien dans le navigateur par défaut, ou un fichier/dossier.
  return launch('explorer.exe', [action.target]);
}

// Boutons de son : volume de Windows, ou d'une seule application (config "audioApp")
async function runVolume(action, context) {
  const { audioMode, audioApp, bigStep } = context;
  const step = bigStep ? action.bigStep : action.step;

  let label;
  let result;
  if (audioMode === 'app' && audioApp) {
    label = audioApp.label;
    result = await changeAppVolume(audioApp.processes, action.op, step);
    if (!result) {
      throw new Error(`${audioApp.label} ne joue pas de son en ce moment (lance la lecture d'abord)`);
    }
  } else {
    label = 'Système';
    result = await changeSystemVolume(action.op, step);
  }
  // Indicateur sur l'écran du PC (en bas au milieu) ; l'appli affiche le sien
  showOsd(label, result.volume, result.muted).catch(() => {});
  return {
    message: result.muted ? `${label} : son coupé` : `${label} : ${result.volume} %`,
    volume: { label, level: result.volume, muted: result.muted },
  };
}

// Fenêtre d'un programme : déjà ouverte -> affichée en grand (sur l'écran demandé) ;
// sinon -> lancée avec "ifNotRunning", puis placée dès que sa fenêtre apparaît.
// Onglet d'un site (ex. Gmail), via l'extension de navigateur :
// 1er appui -> onglet déjà ouvert mis au premier plan (sinon nouvel onglet) ;
// 2e appui dans les 5 s -> nouvel onglet.
const ext = require('./ext');
async function browserProcesses() {
  const exe = await defaultBrowserExe();
  return exe ? [require('path').basename(exe).toLowerCase().replace(/\.exe$/, '')] : [];
}
async function bringBrowserToFront(title) {
  const processes = await browserProcesses();
  if (!processes.length) return;
  // Le titre de la fenêtre = titre de l'onglet actif : on vise donc la bonne fenêtre
  if (!(title && (await showWindow(processes, 'same', title.slice(0, 60))))) {
    await showWindow(processes, 'same');
  }
}
async function runTab(action, context) {
  if (!ext.isConnected()) {
    await openUrl({ target: action.url });
    return 'Extension du navigateur non connectée : onglet ouvert sans vérifier les autres';
  }
  if (!context.repeat) {
    const reply = await ext.focus(action.match);
    if (reply.found) {
      await bringBrowserToFront(reply.title);
      return 'Onglet affiché — rappuie pour en ouvrir un nouveau';
    }
  }
  await ext.request({ cmd: 'open', url: action.url, match: action.match });
  await sleep(300);
  await bringBrowserToFront('');
  return context.repeat ? 'Nouvel onglet ouvert' : null;
}

// Avec "title", seule une fenêtre dont le titre contient ce texte compte (ex. "Gmail").
// "secondClick" : action lancée si on rappuie sur le bouton dans les 5 secondes
// (ex. ouvrir une nouvelle fenêtre au lieu de réafficher l'ancienne).
async function runWindow(action, context) {
  if (context.repeat && action.secondClick) {
    await runAction(action.secondClick, context);
    return 'Nouvelle fenêtre ouverte';
  }
  if (await showWindow(action.processes, action.screen, action.title)) {
    return action.secondClick ? 'Fenêtre affichée — rappuie pour en ouvrir une nouvelle' : null;
  }
  if (!action.ifNotRunning) throw new Error(`${action.title || action.processes[0]} n'est pas ouvert`);
  await runAction(action.ifNotRunning, context);
  if (action.screen === 'same') return null; // Windows l'ouvre là où il était la dernière fois
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (await showWindow(action.processes, action.screen, action.title)) return null;
  }
  return null; // lancé, mais fenêtre pas encore là : tant pis pour le placement
}

// Renvoie éventuellement un petit message à afficher sur la tablette.
async function runAction(action, context = {}) {
  switch (action.type) {
    case 'open':
      return openUrl(action);
    case 'app':
      if (action.appId) return launch('explorer.exe', [`shell:AppsFolder\\${action.appId}`]);
      return launch(action.path, action.args || []);
    case 'keys':
      for (let i = 0; i < action.repeat; i++) await pressKeys(action.codes);
      return null;
    case 'volume':
      return runVolume(action, context);
    case 'window':
      return runWindow(action, context);
    case 'tab':
      return runTab(action, context);
    case 'lock':
      return launch('rundll32.exe', ['user32.dll,LockWorkStation']);
    case 'wait':
      return sleep(action.ms);
    case 'macro':
      for (const step of action.steps) await runAction(step, context);
      return null;
    default:
      throw new Error(`type d'action inconnu : ${action.type}`);
  }
}

module.exports = { runAction };
