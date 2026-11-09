// Appairage par code à usage unique, valable 5 minutes : npm test
process.env.PCDECK_DATA = require('path').join(require('os').tmpdir(), 'pcdeck-auth-test-' + process.pid);
const assert = require('node:assert');
const fs = require('fs');
const auth = require('./auth');

assert.throws(() => auth.pair('123456', '10.0.0.2', 'x'), /Pas de code/, 'sans code en cours : refus');
let { code } = auth.newPairingCode();
assert.match(code, /^\d{6}$/);
const wrong = code === '000000' ? '111111' : '000000';
assert.throws(() => auth.pair(wrong, '10.0.0.2', 'x'), /incorrect/);
const token = auth.pair(code, '10.0.0.2', 'Tablette');
assert.ok(auth.isValidToken(token), 'le jeton reçu est accepté ensuite');
assert.throws(() => auth.pair(code, '10.0.0.3', 'y'), /Pas de code/, 'usage unique');
assert.deepStrictEqual(auth.pairingStatus().paired, ['Tablette']);

// Expiration après 5 minutes
({ code } = auth.newPairingCode());
const realNow = Date.now;
Date.now = () => realNow() + 5 * 60 * 1000 + 1;
assert.throws(() => auth.pair(code, '10.0.0.4', 'z'), /expiré/);
Date.now = realNow;

// 10 mauvais essais (plusieurs appareils) : le code est annulé
({ code } = auth.newPairingCode());
for (let i = 0; i < 10; i++) { try { auth.pair(String((Number(code) + 1 + i) % 1e6).padStart(6, '0'), `10.0.1.${i}`, 'pirate'); } catch {} }
assert.throws(() => auth.pair(code, '10.0.0.9', 'ok'), /Pas de code/);
assert.ok(!auth.isValidToken('f'.repeat(64)));

fs.rmSync(process.env.PCDECK_DATA, { recursive: true, force: true });
console.log('Appairage : code unique, expiration, annulation : OK');
