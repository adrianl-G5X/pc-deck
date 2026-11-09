// Mises à jour : signature, empreinte, comparaison de versions (faux GitHub local) : npm test
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcdeck-update-test-'));
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(path.join(dir, 'pub.pem'), publicKey.export({ type: 'spki', format: 'pem' }));

const setup = Buffer.from('faux installeur');
let files = {};
function publish(manifest, signWith = privateKey) {
  const data = Buffer.from(JSON.stringify(manifest));
  files = { 'update.json': data, 'update.json.sig': Buffer.from(crypto.sign(null, data, signWith).toString('base64')), [manifest.setup.name]: setup };
}
const goodManifest = { version: '99.0.0', setup: { name: 'PCDeck-Setup-99.0.0.exe', sha256: crypto.createHash('sha256').update(setup).digest('hex') }, notes: 'Nouveautés' };

const server = http.createServer((req, res) => {
  const port = server.address().port;
  if (req.url === '/latest') {
    res.end(JSON.stringify({ tag_name: 'v99.0.0', assets: Object.keys(files).map((n) => ({ name: n, browser_download_url: `http://127.0.0.1:${port}/f/${n}` })) }));
  } else {
    const f = files[decodeURIComponent(req.url.replace('/f/', ''))];
    f ? res.end(f) : res.writeHead(404).end();
  }
});

server.listen(0, '127.0.0.1', async () => {
  process.env.PCDECK_UPDATE_URL = `http://127.0.0.1:${server.address().port}/latest`;
  process.env.PCDECK_UPDATE_PUBKEY = path.join(dir, 'pub.pem');
  process.env.PCDECK_UPDATE_DRYRUN = '1';
  const updates = require('./update');

  assert.ok(updates.newer('1.10.0', '1.9.3') && !updates.newer('1.2.0', '1.2.0') && !updates.newer('0.9.9', '1.0.0'));

  // Version signée par la bonne clé : proposée, téléchargée, empreinte vérifiée
  publish(goodManifest);
  let st = await updates.check();
  assert.strictEqual(st.available, true, st.error);
  assert.strictEqual(st.latest, '99.0.0');
  const done = await updates.install();
  assert.ok(done.dryRun && fs.readFileSync(done.file).equals(setup));

  // Signée par une AUTRE clé (compte GitHub piraté) : ignorée
  publish(goodManifest, crypto.generateKeyPairSync('ed25519').privateKey);
  st = await updates.check();
  assert.match(st.error, /signature invalide/);

  // Installeur modifié après la signature : refusé à l'installation
  publish(goodManifest);
  await updates.check();
  files[goodManifest.setup.name] = Buffer.from('installeur piégé');
  await assert.rejects(updates.install(), /empreinte différente/);

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Mises à jour : signature, empreinte, versions : OK');
});
