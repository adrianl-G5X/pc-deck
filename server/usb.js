// Mode USB de secours : quand la tablette est branchée en USB (débogage USB activé),
// on crée un tunnel "adb reverse". Sur la tablette, http://localhost:8787 mène
// alors au serveur du PC, même sans Wi-Fi. Vérifié toutes les 5 secondes, donc
// le tunnel se recrée tout seul si on débranche / rebranche le câble.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOCAL = process.env.LOCALAPPDATA || '';
const CANDIDATES = [
  path.join(LOCAL, 'Microsoft', 'WinGet', 'Links', 'adb.exe'), // installé avec winget
  path.join(LOCAL, 'Android', 'Sdk', 'platform-tools', 'adb.exe'), // Android Studio
  'C:\\platform-tools\\adb.exe',
];

function run(adb, args) {
  return new Promise((resolve, reject) => {
    execFile(adb, args, { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });
}

// winget peut aussi l'installer dans WinGet\Packages\Google.PlatformTools_…\platform-tools
function wingetPackages() {
  const dir = path.join(LOCAL, 'Microsoft', 'WinGet', 'Packages');
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.startsWith('Google.PlatformTools'))
      .map((name) => path.join(dir, name, 'platform-tools', 'adb.exe'));
  } catch {
    return [];
  }
}

async function findAdb(configured) {
  const list = [configured, process.env.ADB_PATH, ...CANDIDATES, ...wingetPackages()].filter(Boolean);
  for (const p of list) {
    if (fs.existsSync(p)) return p;
  }
  // adb dans le PATH ?
  try {
    await run('adb', ['version']);
    return 'adb';
  } catch {
    return null;
  }
}

function startUsb(port, usbConfig) {
  if (!usbConfig.enabled) {
    console.log('  Mode USB : désactivé dans config.json');
    return;
  }

  let adb = null;
  let warnedMissing = false;
  const known = new Map(); // numéro de série -> état déjà signalé
  let busy = false;

  async function check() {
    if (busy) return;
    busy = true;
    try {
      if (!adb) {
        adb = await findAdb(usbConfig.adbPath);
        if (!adb) {
          if (!warnedMissing) {
            console.log('  Mode USB : adb introuvable (voir README, « Mode USB »). Nouvel essai chaque minute.');
            warnedMissing = true;
          }
          return;
        }
        console.log(`  Mode USB : prêt (adb trouvé). Branche la tablette pour l'activer.`);
      }

      const out = await run(adb, ['devices']);
      const devices = out
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 2);

      const seen = new Set();
      for (const [serial, status] of devices) {
        seen.add(serial);
        if (status === 'unauthorized') {
          if (known.get(serial) !== 'unauthorized') {
            console.log(`Tablette USB (${serial}) : accepte « Autoriser le débogage USB » sur la tablette.`);
            known.set(serial, 'unauthorized');
          }
          continue;
        }
        if (status !== 'device') continue;

        const list = await run(adb, ['-s', serial, 'reverse', '--list']);
        if (!list.includes(`tcp:${port}`)) {
          await run(adb, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
          console.log(`Tablette USB (${serial}) : tunnel activé -> http://localhost:${port} sur la tablette`);
        }
        known.set(serial, 'ok');
      }
      for (const serial of known.keys()) {
        if (!seen.has(serial)) {
          console.log(`Tablette USB (${serial}) : débranchée`);
          known.delete(serial);
        }
      }
    } catch (err) {
      // adb peut échouer ponctuellement (câble débranché pendant la commande...)
      if (adb && !fs.existsSync(adb) && adb !== 'adb') adb = null;
    } finally {
      busy = false;
    }
  }

  check();
  let ticks = 0;
  setInterval(() => {
    ticks += 1;
    if (adb || ticks % 12 === 0) check(); // sans adb : 1 essai par minute
  }, 5000);
}

module.exports = { startUsb };
