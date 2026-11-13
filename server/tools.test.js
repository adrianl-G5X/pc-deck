// Fichiers du PC vus depuis la tablette : seulement dans les dossiers personnels (npm test)
process.env.PCDECK_DATA = require('path').join(require('os').tmpdir(), 'pcdeck-test-tools-' + process.pid);
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { safePath, listFolder, killProgram } = require('./tools');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcdeck-recus-')); // joue le rôle du dossier « Fichiers reçus »
const inside = path.join(root, 'photo.jpg');
fs.writeFileSync(inside, 'x');
const outside = path.join(os.tmpdir(), `pcdeck-secret-${process.pid}.txt`);
fs.writeFileSync(outside, 'x');
const windowsDir = process.env.SystemRoot || 'C:/Windows';

assert.strictEqual(safePath(inside, root), fs.realpathSync(inside));
assert.strictEqual(safePath(path.join(root, '..', path.basename(outside)), root), null); // « .. » pour sortir : refusé
assert.strictEqual(safePath(outside, root), null);
assert.strictEqual(safePath(path.join(windowsDir, 'System32', 'drivers', 'etc', 'hosts'), root), null);
assert.ok(listFolder('', root).items.some((r) => r.name === 'Fichiers reçus'));
assert.throws(() => listFolder(windowsDir, root));
// Données par appareil : additionnées par jour et par type
{
  const du = require('./datause');
  du.add('tab1', 'screen', 1000); du.add('tab1', 'files', 500); du.add('tab1', 'screen', 24);
  const r = du.report('tab1');
  assert.deepStrictEqual(r.today, { screen: 1024, files: 500, other: 0 });
  assert.strictEqual(r.month.screen, 1024);
  assert.deepStrictEqual(du.report('inconnu').today, { screen: 0, files: 0, other: 0 });
}
(async () => {
  await assert.rejects(killProgram('explorer')); // Windows lui-même : jamais
  await assert.rejects(killProgram('a&calc'));   // nom bizarre : refusé
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { force: true });
  fs.rmSync(process.env.PCDECK_DATA, { recursive: true, force: true });
  console.log('Fichiers et programmes de la tablette : OK');
})();
