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
console.log(`Configuration : défaut + ${templates.length} modèles OK`);
