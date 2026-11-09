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
console.log(`Configuration : défaut + ${templates.length} modèles OK`);
