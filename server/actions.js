// Exécution des actions. La tablette envoie seulement l'"id" d'un bouton :
// l'action réellement lancée vient toujours de config.json, jamais du client.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { audioDevices, setAudioDevice, screenOff, parseKeys, pressKeys, changeAppVolume, changeSystemVolume, changeMic, showWindow, focusFolder, foregroundProcess, typeText, showOsd } = require('./keys');

// ---------- Navigateurs ----------
const BROWSERS = ['chrome', 'msedge', 'firefox', 'opera', 'brave', 'vivaldi'];
const isBrowser = (proc) => BROWSERS.includes(proc);
// Nom du programme qui tourne (pour le retrouver) d'après son .exe. Opera s'installe avec launcher.exe.
function processOf(exePath) {
  const base = path.basename(String(exePath)).toLowerCase().replace(/\.exe$/, '');
  return base === 'launcher' && /opera/i.test(exePath) ? 'opera' : base;
}
const CTRL_T = parseKeys('ctrl+t');
const ALT_D = parseKeys('alt+d');
const ENTER = parseKeys('enter');
const isFolder = (p) => { try { return fs.statSync(String(p).replace(/[\\/]+$/, '')).isDirectory(); } catch { return false; } };

// Attend que le programme soit au premier plan (pour ne jamais envoyer de touches ailleurs)
async function waitForeground(proc, refocus) {
  for (let i = 0; i < 3; i++) {
    await sleep(200);
    if ((await foregroundProcess()) === proc) return true;
    await refocus();
  }
  return false;
}

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
  const isWeb = /^https?:\/\//i.test(action.target);
  if (action.newWindow && isWeb) {
    const exe = await defaultBrowserExe();
    // Les navigateurs (Opera, Chrome, Edge, Firefox) comprennent --new-window
    if (exe) return launch(exe, ['--new-window', action.target]);
  }
  if (isWeb) {
    // Site : nouvel onglet dans le navigateur déjà ouvert (comportement normal de Windows),
    // puis on ramène le navigateur au premier plan.
    await launch('explorer.exe', [action.target]);
    await sleep(500);
    const procs = await browserProcesses();
    if (procs.length) await showWindow(procs, 'front');
    return null;
  }
  if (/^[a-z]:[\\/]|^\\\\/i.test(action.target) && !fs.existsSync(action.target.replace(/[\\/]+$/, ''))) throw new Error(`fichier ou dossier introuvable : ${action.target}`);
  // Dossier ou fichier déjà ouvert : on ramène sa fenêtre au lieu d'en ouvrir une autre
  if (!action.newInstance) {
    const target = action.target.replace(/[\\/]+$/, '');
    let isDir = false;
    try { isDir = fs.statSync(target).isDirectory(); } catch {}
    if (isDir && (await focusFolder(target))) return null;
    // Emplacement de l'Explorateur qui n'est pas un chemin (ex. « Accueil ») : la fenêtre de l'Explorateur déjà ouverte
    if (!isDir && !/\.\w{1,5}$/.test(target) && (await focusFolder('*'))) return null;
    if (!isDir && (await showWindow(['*'], 'front', path.parse(target).name))) return null;
  }
  return launch('explorer.exe', [action.target]);
}

// Programme : déjà ouvert -> sa fenêtre revient au premier plan (restaurée si réduite) ;
// sinon -> lancé. "newInstance" : toujours lancer une nouvelle fenêtre.
// Appli du Store : nom de son programme (ex. « AppleInc.AppleMusicWin_…!App » -> « applemusic »), lu dans
// le manifeste du paquet Windows ; gardé en mémoire une fois trouvé.
const storeProcs = new Map();
function storeProcess(appId) {
  if (storeProcs.has(appId)) return Promise.resolve(storeProcs.get(appId));
  const script = `$id = $env:PCDECK_APPID -split '!'; $pkg = Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq $id[0] } | Select-Object -First 1
if ($pkg) { $apps = @((Get-AppxPackageManifest $pkg).Package.Applications.Application)
  $app = $apps | Where-Object { $_.Id -eq $id[1] } | Select-Object -First 1; if (-not $app) { $app = $apps[0] }
  [IO.Path]::GetFileNameWithoutExtension($app.Executable) }`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, env: { ...process.env, PCDECK_APPID: appId } }, (err, out) => {
      const name = err ? null : String(out || '').trim().toLowerCase();
      if (name !== null && /^[\w.-]+$/.test(name)) storeProcs.set(appId, name);
      resolve(name === null ? null : /^[\w.-]+$/.test(name) ? name : ''); // '' = aucun paquet de ce nom : pas installée
    });
  });
}

async function runApp(action) {
  // Écran choisi : "primary" / "secondary" = en grand sur cet écran ; sinon là où il était
  const where = ['primary', 'secondary'].includes(action.screen) ? action.screen : 'front';
  if (action.appId) {
    // Appli du Store : déjà ouverte -> sa fenêtre revient au premier plan (sur l'écran choisi) ; sinon -> lancée puis placée
    const sproc = await storeProcess(action.appId);
    if (sproc === '') throw new Error(`appli du Store introuvable : ${action.appId}`);
    if (sproc && !action.newInstance && (await showWindow([sproc], where))) return null;
    await launch('explorer.exe', [`shell:AppsFolder\\${action.appId}`]);
    if (sproc && where !== 'front') {
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        if (await showWindow([sproc], where)) break;
      }
    }
    return null;
  }
  const proc = processOf(action.path);
  if (!action.newInstance && (await showWindow([proc], where))) return null;
  // Chemin complet qui n'existe plus (programme déplacé, désinstallé) : message clair plutôt qu'une erreur de Windows
  if (/^[a-z]:[\\/]|^\\\\/i.test(action.path) && !fs.existsSync(action.path)) throw new Error(`programme introuvable : ${action.path}`);
  await launch(action.path, action.args || []);
  if (where !== 'front') {
    for (let i = 0; i < 30; i++) { // on attend sa fenêtre pour la placer
      await sleep(500);
      if (await showWindow([proc], where)) break;
    }
  }
  return null;
}

// Nouvel onglet : navigateur ouvert -> premier plan + Ctrl+T (marche dans Chrome, Edge,
// Firefox, Opera, Brave) ; pas ouvert -> lancé normalement (il s'ouvre avec un seul onglet).
async function runNewTab(action) {
  // Dossier : nouvel onglet de l'Explorateur, ouvert sur ce même dossier
  if (action.folder) {
    // Vrai dossier : sa fenêtre ; sinon (ex. « Accueil ») : n'importe quelle fenêtre de l'Explorateur
    const real = isFolder(action.folder);
    const focus = () => focusFolder(real ? action.folder : '*');
    if (!(await focus())) {
      await launch('explorer.exe', [action.folder]); // pas encore ouvert : on l'ouvre simplement
      return null;
    }
    if (!(await waitForeground('explorer', focus))) throw new Error('Windows n\'a pas laissé passer l\'Explorateur au premier plan : réessaie');
    await pressKeys(CTRL_T);   // nouvel onglet (il s'ouvre sur l'Accueil)
    if (!real) return 'Nouvel onglet';
    await sleep(500);
    await pressKeys(ALT_D);    // barre d'adresse
    await sleep(200);
    await typeText(action.folder);
    await pressKeys(ENTER);
    return 'Nouvel onglet';
  }
  const proc = action.process || processOf(action.path);
  if (await showWindow([proc], 'front')) {
    // Ctrl+T seulement si le navigateur est VRAIMENT au premier plan (sinon il partirait ailleurs)
    for (let i = 0; i < 3; i++) {
      await sleep(200);
      if ((await foregroundProcess()) === proc) {
        await pressKeys(CTRL_T);
        return 'Nouvel onglet';
      }
      await showWindow([proc], 'front');
    }
    throw new Error(`Windows n'a pas laissé passer ${proc} au premier plan : réessaie`);
  }
  if (action.path) {
    await launch(action.path, []);
    return null;
  }
  throw new Error(`${proc} n'est pas ouvert`);
}

// Action du double appui d'un bouton (null = rien de spécial : le double appui fait l'appui simple).
// "double" dans config.json : l'action choisie ; null : rien ; absent : choix automatique.
function doubleActionFor(button) {
  if (button.double === null) return null;
  if (button.double) return button.double;
  const a = button.action;
  if (a.type === 'tab') return a; // nouvel onglet du site (via l'extension)
  if (a.type === 'window' && a.secondClick) return a.secondClick;
  // Dossier (ou emplacement de l'Explorateur sans extension, ex. « Accueil », « shell:Downloads »)
  if (a.type === 'open' && !/^https?:\/\//i.test(a.target) && (isFolder(a.target) || !/\.\w{1,5}$/.test(a.target))) return { type: 'newtab', folder: a.target };
  if (a.type === 'app' && a.path && isBrowser(processOf(a.path))) return { type: 'newtab', path: a.path };
  if (a.type === 'window') {
    const proc = a.processes.find(isBrowser);
    if (proc) return { type: 'newtab', process: proc };
  }
  return null;
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
// appui simple -> onglet déjà ouvert mis au premier plan (sinon nouvel onglet) ;
// double appui -> nouvel onglet.
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
      return 'Onglet affiché — double appui pour en ouvrir un nouveau';
    }
  }
  await ext.request({ cmd: 'open', url: action.url, match: action.match });
  await sleep(300);
  await bringBrowserToFront('');
  return context.repeat ? 'Nouvel onglet ouvert' : null;
}

// Avec "title", seule une fenêtre dont le titre contient ce texte compte (ex. "Gmail").
// "secondClick" : action du double appui (ex. ouvrir une nouvelle fenêtre au lieu de
// réafficher l'ancienne).
async function runWindow(action, context) {
  if (context.repeat && action.secondClick) {
    await runAction(action.secondClick, context);
    return 'Nouvelle fenêtre ouverte';
  }
  if (await showWindow(action.processes, action.screen, action.title)) {
    return action.secondClick ? 'Fenêtre affichée — double appui pour en ouvrir une nouvelle' : null;
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
      return runApp(action);
    case 'newtab':
      return runNewTab(action);
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
    case 'mic': {
      const r = await changeMic('mute');
      if (!r) throw new Error('aucun micro branché sur le PC');
      return r.muted ? 'Micro coupé' : 'Micro activé';
    }
    case 'http': { // la réponse n'est pas lue : seul compte « accepté » ou non
      const res = await fetch(action.url, {
        method: action.method,
        headers: { ...(action.body ? { 'Content-Type': /^\s*[{[]/.test(action.body) ? 'application/json' : 'text/plain' } : {}), ...(action.token ? { Authorization: `Bearer ${action.token}` } : {}) },
        body: action.method === 'GET' ? undefined : action.body || undefined,
        signal: AbortSignal.timeout(6000),
      }).catch((err) => { throw new Error(`${new URL(action.url).host} ne répond pas (${err.name === 'TimeoutError' ? 'délai dépassé' : 'introuvable sur le réseau'})`); });
      if (!res.ok) throw new Error(`${new URL(action.url).host} a refusé la demande (code ${res.status}${res.status === 401 ? ' : jeton refusé' : ''})`);
      return null;
    }
    case 'audio': { // sortie son : celle dont le nom contient « device », sinon la suivante de la liste
      const list = (await audioDevices(0)).filter((d) => !/steam streaming/i.test(d.name));
      if (!list.length) throw new Error('aucune sortie son trouvée');
      const cur = list.findIndex((d) => d.current);
      const next = action.device ? list.find((d) => d.name.toLowerCase().includes(action.device.toLowerCase())) : list[(cur + 1) % list.length];
      if (!next) throw new Error(`sortie son « ${action.device} » introuvable (branchée ?)`);
      await setAudioDevice(next.id);
      return `Son sur ${next.name.replace(/\s*\(.*\)$/, '') || next.name}`;
    }
    case 'screenoff':
      await screenOff();
      return 'Écran éteint (bouge la souris pour le rallumer)';
    case 'powerplan': { // modes d'alimentation fournis par Windows
      const plans = { saver: ['SCHEME_MAX', "Économie d'énergie"], balanced: ['SCHEME_BALANCED', 'Équilibré'], performance: ['SCHEME_MIN', 'Performances élevées'] };
      const [scheme, label] = plans[action.plan];
      await new Promise((resolve, reject) => execFile('powercfg.exe', ['/setactive', scheme], { windowsHide: true }, (err) => (err ? reject(new Error("mode d'alimentation indisponible sur ce PC")) : resolve())));
      return `Alimentation : ${label}`;
    }
    case 'brightness': { // écran d'un portable (les écrans de PC fixe se règlent avec leurs boutons)
      const ps = "$b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1; " +
        "$v = [Math]::Max(0, [Math]::Min(100, $b.CurrentBrightness + [int]$env:PCDECK_STEP)); " +
        "Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1; Brightness=[byte]$v} | Out-Null; $v";
      const out = await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 10000, env: { ...process.env, PCDECK_STEP: action.op === 'up' ? '10' : '-10' } },
        (err, o) => (err ? reject(new Error("luminosité réglable seulement sur l'écran d'un PC portable")) : resolve(String(o).trim()))));
      return `Luminosité : ${out} %`;
    }
    case 'power':
      if (action.op === 'sleep') { // veille (et pas la mise en veille prolongée de rundll32)
        return launch('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
          "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"]);
      }
      return launch('shutdown.exe', [action.op === 'restart' ? '/r' : '/s', '/t', '0']);
    case 'wait':
      return sleep(action.ms);
    case 'obs':
      return require('./obs').runObs(action);
    case 'page': // la tablette change de page elle-même
    case 'timer': // géré par le serveur (minuteurs partagés entre les appareils)
      return null;
    case 'macro':
      for (const step of action.steps) await runAction(step, context);
      return null;
    default:
      throw new Error(`type d'action inconnu : ${action.type}`);
  }
}

module.exports = { runAction, doubleActionFor, processOf };
