// Vérifie que la configuration par défaut et tous les modèles sont valides : npm test
process.env.PCDECK_DATA = require('path').join(require('os').tmpdir(), 'pcdeck-test-' + process.pid); // ne touche pas aux vraies données
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseConfig } = require('./config');
const { APP_DIR, DATA_DIR } = require('./paths');

const read = (f) => JSON.parse(fs.readFileSync(path.join(APP_DIR, f), 'utf8'));

const def = parseConfig(read('config.default.json'));
assert.ok(def.buttons.length > 0, 'la config par défaut doit avoir des boutons');
assert.strictEqual(def.remote.view, false, 'contrôle à distance désactivé par défaut');
assert.ok(fs.existsSync(path.join(DATA_DIR, 'config.json')), 'config créée au premier lancement');

const { templates } = read('templates.json');
for (const t of templates) {
  parseConfig({ buttons: t.buttons || [], toggles: t.toggles || [], audioApp: t.audioApp });
}
// Un identifiant en double doit être refusé
assert.throws(() => parseConfig({ buttons: [def.buttons[0], def.buttons[0]] }));
// Éteindre / redémarrer / veille : seulement ces trois ordres
parseConfig({ buttons: [{ id: 'off', label: 'Éteindre', action: { type: 'power', op: 'shutdown' } }, { id: 'mic', label: 'Micro', action: { type: 'mic' } }] });
assert.throws(() => parseConfig({ buttons: [{ id: 'off', label: 'X', action: { type: 'power', op: 'format' } }] }));
// Requête web (lumières) : adresse http(s) seulement, méthode GET / POST / PUT
assert.strictEqual(parseConfig({ buttons: [{ id: 'l', label: 'Lumière', action: { type: 'http', url: 'http://192.168.1.5:8123/api/services/light/toggle', body: '{}' } }] }).buttons[0].action.method, 'POST');
assert.throws(() => parseConfig({ buttons: [{ id: 'l', label: 'L', action: { type: 'http', url: 'file:///C:/x' } }] }));
// Dossier des fichiers reçus : chemin complet seulement
assert.strictEqual(parseConfig({ buttons: [], uploadDir: 'D:\\Photos' }).uploadDir, 'D:\\Photos');
assert.throws(() => parseConfig({ buttons: [], uploadDir: 'Photos' }));
// Nouveaux boutons : sortie son, écran, alimentation, luminosité, plusieurs états, valeur affichée, limites
{
  const c = parseConfig({ buttons: [
    { id: 'son', label: 'Casque', value: 'cpuTemp', action: { type: 'audio', device: 'Casque' } },
    { id: 'ecran', label: 'Écran', action: { type: 'screenoff' } },
    { id: 'eco', label: 'Éco', action: { type: 'powerplan', plan: 'saver' } },
    { id: 'lum', label: 'Lum', action: { type: 'brightness', op: 'up' } },
    { id: 'mode', label: 'Mode', action: { type: 'cycle', steps: [{ label: 'Jeu', action: { type: 'keys', keys: 'win+g' } }, { label: 'Travail', action: { type: 'lock' } }] } },
  ], limits: [{ process: 'Fortnite.exe', minutes: 120 }] });
  assert.strictEqual(c.buttons[0].value, 'cpuTemp');
  assert.strictEqual(c.buttons[4].action.steps[1].label, 'Travail');
  assert.deepStrictEqual(c.limits, [{ process: 'fortnite', minutes: 120 }]);
  assert.throws(() => parseConfig({ buttons: [{ id: 'm', label: 'M', action: { type: 'cycle', steps: [{ label: 'Seul', action: { type: 'lock' } }] } }] }));
  assert.throws(() => parseConfig({ buttons: [], limits: [{ process: 'x', minutes: 1 }] }));
}
// Outils de la tablette : seulement les outils connus, noms de 30 caractères au plus
{
  const t = parseConfig({ buttons: [], display: { tools: { order: ['files', 'inconnu', 'windows'], names: { files: '  Mes fichiers ', pirate: 'x', pad: '' } } } }).display.tools;
  assert.deepStrictEqual(t, { order: ['files', 'windows'], names: { files: 'Mes fichiers' } });
}
// Action programmée : heure valide et bouton qui existe
const off = { id: 'off', label: 'Éteindre', action: { type: 'power', op: 'shutdown' } };
assert.strictEqual(parseConfig({ buttons: [off], schedules: [{ time: '23:00', button: 'off' }] }).schedules[0].days, 'all');
// Éteindre programmé : « Tu es sûr ? » par défaut ; décoché dans les Paramètres : non
assert.strictEqual(parseConfig({ buttons: [off], schedules: [{ time: '23:00', button: 'off' }] }).schedules[0].confirm, true);
assert.strictEqual(parseConfig({ buttons: [off], schedules: [{ time: '23:00', button: 'off', confirm: false }] }).schedules[0].confirm, false);
assert.throws(() => parseConfig({ buttons: [off], schedules: [{ time: '24:00', button: 'off' }] }));
assert.throws(() => parseConfig({ buttons: [off], schedules: [{ time: '23:00', button: 'inconnu' }] }));

fs.rmSync(DATA_DIR, { recursive: true, force: true });
// Le 1er démarrage et le modèle « Boutons de base » donnent les mêmes boutons
{
  const R = require('path').join(__dirname, '..');
  const def = JSON.parse(require('fs').readFileSync(require('path').join(R, 'config.default.json'), 'utf8'));
  const base = JSON.parse(require('fs').readFileSync(require('path').join(R, 'templates.json'), 'utf8')).templates.find((t) => t.id === 'base');
  require('assert').deepStrictEqual(base.buttons, def.buttons);
  require('assert').ok(def.buttons.length >= 10);
  parseConfig(def); // les boutons de base sont valides (touches comprises)
}
// « Tu es sûr ? » : par défaut pour verrouiller seulement, au choix pour le reste
{
  const b = (action, extra) => parseConfig({ buttons: [{ id: 'a', label: 'A', action, ...extra }] }).buttons[0].confirm;
  require('assert').strictEqual(b({ type: 'lock' }), true);
  require('assert').strictEqual(b({ type: 'lock' }, { confirm: false }), false);
  require('assert').strictEqual(b({ type: 'keys', keys: 'ctrl+c' }), false);
  require('assert').strictEqual(b({ type: 'keys', keys: 'ctrl+c' }, { confirm: true }), true);
  require('assert').throws(() => b({ type: 'lock' }, { confirm: 'oui' }));
}
// Interrupteurs, applis de son et grands pas : désactivables (brouillon) sans perdre leurs réglages
{
  const c = parseConfig({
    buttons: [],
    toggles: [{ id: 't', label: 'T', action: { type: 'keys', keys: 'ctrl+m' }, draft: true }],
    audioApps: [{ label: 'A', processes: ['a'], draft: true }, { label: 'B', processes: ['b'] }],
    bigStepEnabled: false,
  });
  require('assert').strictEqual(c.toggles[0].draft, true);
  require('assert').deepStrictEqual(c.audioApps.map((a) => a.label), ['B']); // A est au brouillon
  require('assert').strictEqual(c.bigStepEnabled, false);
  require('assert').strictEqual(parseConfig({ buttons: [] }).bigStepEnabled, true);
  require('assert').throws(() => parseConfig({ buttons: [], bigStepEnabled: 'non' }));
}
// Couleurs personnalisées : vides par défaut, refusées si ce n'est pas une couleur
{
  const colors = (c) => parseConfig({ buttons: [], display: { colors: c } }).display.colors;
  require('assert').deepStrictEqual(colors(undefined), { background: '', keys: '', text: '', down: '', up: '' });
  require('assert').strictEqual(colors({ background: '#0e1524' }).background, '#0e1524');
  require('assert').throws(() => colors({ text: 'rouge' }));
}
// Logo : vrai logo du programme ou du site, au choix
{
  const b = (extra) => parseConfig({ buttons: [{ id: 'a', label: 'A', action: { type: 'lock' }, ...extra }] }).buttons[0].logo;
  require('assert').strictEqual(b({ logo: true }), true);
  require('assert').strictEqual(b({}), false);
  require('assert').throws(() => b({ logo: 'oui' }));
  const img = (v) => parseConfig({ buttons: [{ id: 'a', label: 'A', action: { type: 'lock' }, logoImage: v }] }).buttons[0].logoImage;
  require('assert').ok(img('data:image/png;base64,iVBORw0KGgo='));
  require('assert').throws(() => img('https://exemple.fr/x.png'));
  require('assert').throws(() => img('data:text/html;base64,PHNjcmlwdD4='));
  require('assert').strictEqual(parseConfig({ buttons: [{ id: 'a', label: 'A', action: { type: 'lock' }, logoApp: 'Spotify' }] }).buttons[0].logoApp, 'Spotify');
}
// Brouillon : bouton gardé dans la config mais marqué « draft »
{
  const b = (extra) => ({ id: 'a', label: 'A', action: { type: 'lock' }, ...extra });
  require('assert').strictEqual(parseConfig({ buttons: [b({ draft: true })] }).buttons[0].draft, true);
  require('assert').strictEqual(parseConfig({ buttons: [b({})] }).buttons[0].draft, false);
  require('assert').throws(() => parseConfig({ buttons: [b({ draft: 'oui' })] }));
}
// Plusieurs applis pour le son ; l'ancien "audioApp" (une seule) reste accepté
const apps = parseConfig({ buttons: [], audioApps: [{ label: 'A', processes: ['a.exe'] }, { label: 'B', processes: ['b'] }] });
require('assert').deepStrictEqual(apps.audioApps.map((a) => a.processes[0]), ['a', 'b']);
require('assert').strictEqual(parseConfig({ buttons: [], audioApp: { label: 'X', processes: ['x'] } }).audioApps.length, 1);
require('assert').throws(() => parseConfig({ buttons: [], audioApps: [{ label: 'A', processes: ['a'] }, { label: 'A', processes: ['b'] }] }));
// Pages : bouton rangé sur une page, bouton « dossier », refusé dans une macro
const paged = parseConfig({ buttons: [{ id: 'j', page: ' Jeux ', action: { type: 'lock' } }, { id: 'd', action: { type: 'page', page: 'Jeux' } }] });
require('assert').deepStrictEqual([paged.buttons[0].page, paged.buttons[1].page, paged.buttons[1].action.page], ['Jeux', '', 'Jeux']);
require('assert').throws(() => parseConfig({ buttons: [{ id: 'm', action: { type: 'macro', steps: [{ type: 'page', page: 'J' }] } }] }));
// Minuteur et OBS
require('assert').strictEqual(parseConfig({ buttons: [{ id: 't', action: { type: 'timer', seconds: 300 } }] }).buttons[0].action.seconds, 300);
require('assert').throws(() => parseConfig({ buttons: [{ id: 't', action: { type: 'timer', seconds: -1 } }] }));
require('assert').throws(() => parseConfig({ buttons: [{ id: 'o', action: { type: 'obs', op: 'scene' } }] })); // scène manquante
require('assert').strictEqual(parseConfig({ buttons: [{ id: 'o', action: { type: 'obs', op: 'record' } }] }).obs.port, 4455);
const { sha } = require('./obs'); // exemple officiel du protocole obs-websocket 5
require('assert').strictEqual(sha(sha('supersecretpassword' + 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=') + '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY='), '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=');
// Profils automatiques : nom de programme nettoyé, nom invalide refusé
require('assert').deepStrictEqual(parseConfig({ buttons: [], profiles: [{ process: 'Steam.exe', page: 'Jeux' }] }).profiles, [{ process: 'steam', page: 'Jeux' }]);
require('assert').throws(() => parseConfig({ buttons: [], profiles: [{ process: 'a/b', page: 'J' }] }));
console.log(`Configuration : défaut + ${templates.length} modèles OK`);
