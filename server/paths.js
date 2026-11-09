// Où le programme range ses fichiers.
// - APP_DIR  : le programme lui-même (en lecture seule une fois installé dans "Program Files").
// - DATA_DIR : réglages (config.json), appairage, état, journaux : %LOCALAPPDATA%\PC Deck.
//   PCDECK_DATA permet de choisir un autre dossier (tests, essais).

const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');
const CUSTOM = process.env.PCDECK_DATA;
const DATA_DIR = CUSTOM || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'PC Deck');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

function prepare() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Avant la version 0.2, tout vivait dans le dossier du programme : on reprend ces fichiers
  // une seule fois, puis on les renomme en ".migrated" (copie de secours).
  if (!CUSTOM) {
    const legacy = [
      [path.join(APP_DIR, 'config.json'), CONFIG_PATH],
      ...['devices.json', 'pairing.json', 'state.json'].map((f) => [path.join(APP_DIR, 'data', f), path.join(DATA_DIR, f)]),
    ];
    for (const [from, to] of legacy) {
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      fs.copyFileSync(from, to);
      if (!fs.readFileSync(from).equals(fs.readFileSync(to))) continue; // copie douteuse : on ne touche pas à l'original
      fs.renameSync(from, from + '.migrated');
      console.log(`Fichier repris dans ${DATA_DIR} : ${path.basename(from)}`);
    }
  }

  // Première utilisation : configuration neutre
  if (!fs.existsSync(CONFIG_PATH)) fs.copyFileSync(path.join(APP_DIR, 'config.default.json'), CONFIG_PATH);
}
prepare();

module.exports = { APP_DIR, DATA_DIR, CONFIG_PATH };
