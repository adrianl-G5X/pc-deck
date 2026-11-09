// Double appui : quelle action pour quel bouton ? (règles par défaut + choix de l'utilisateur) : npm test
process.env.PCDECK_DATA = require('path').join(require('os').tmpdir(), 'pcdeck-actions-test-' + process.pid);
const assert = require('node:assert');
const fs = require('fs');
const { doubleActionFor, processOf } = require('./actions');
const { parseConfig } = require('./config');

const btn = (action, double) => parseConfig({ buttons: [{ id: 'b', label: 'B', action, ...(double !== undefined ? { double } : {}) }] }).buttons[0];

assert.strictEqual(processOf('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'), 'chrome');
assert.strictEqual(processOf('C:\\Users\\x\\AppData\\Local\\Programs\\Opera GX\\launcher.exe'), 'opera');

// Navigateur lancé par son .exe : double appui automatique = nouvel onglet
for (const exe of ['C:\\x\\chrome.exe', 'C:\\x\\msedge.exe', 'C:\\x\\firefox.exe', 'C:\\x\\Opera GX\\launcher.exe', 'C:\\x\\brave.exe']) {
  const d = doubleActionFor(btn({ type: 'app', path: exe }));
  assert.strictEqual(d?.type, 'newtab', exe);
}
// Autre programme : rien par défaut
assert.strictEqual(doubleActionFor(btn({ type: 'app', path: 'C:\\Windows\\notepad.exe' })), null);
// Choix « Rien » (null) l'emporte sur l'automatique
assert.strictEqual(doubleActionFor(btn({ type: 'app', path: 'C:\\x\\chrome.exe' }, null)), null);
// Choix « Nouvelle fenêtre »
const nw = doubleActionFor(btn({ type: 'app', path: 'C:\\Windows\\notepad.exe' }, { type: 'app', path: 'C:\\Windows\\notepad.exe', newInstance: true }));
assert.strictEqual(nw.newInstance, true);
// Bouton « fenêtre » d'un navigateur (ex. Opera) et onglet de site (extension)
assert.strictEqual(doubleActionFor(btn({ type: 'window', process: 'opera' })).type, 'newtab');
assert.strictEqual(doubleActionFor(btn({ type: 'tab', url: 'https://mail.google.com' })).type, 'tab');
// Raccourci clavier, volume : pas de double appui (envoi immédiat, sans attente)
assert.strictEqual(doubleActionFor(btn({ type: 'keys', keys: 'ctrl+c' })), null);
// Validation : nouvel onglet sans navigateur indiqué refusé
assert.throws(() => btn({ type: 'newtab' }));
assert.throws(() => btn({ type: 'app', path: 'x.exe', newInstance: 'oui' }));
// Dossier existant : double appui = nouvel onglet de l'Explorateur sur ce dossier ; fichier : rien
assert.deepStrictEqual(doubleActionFor(btn({ type: 'open', target: require('os').tmpdir() })), { type: 'newtab', folder: require('os').tmpdir() });
assert.strictEqual(doubleActionFor(btn({ type: 'open', target: __filename })), null);
btn({ type: 'open', target: 'C:\\x' }, { type: 'newtab', folder: 'C:\\x' }); // accepté
// Écran d'un programme
btn({ type: 'app', path: 'x.exe', screen: 'secondary' });
assert.throws(() => btn({ type: 'app', path: 'x.exe', screen: 'gauche' }));

fs.rmSync(process.env.PCDECK_DATA, { recursive: true, force: true });
console.log('Double appui : règles par défaut et choix : OK');
process.exit(0);
