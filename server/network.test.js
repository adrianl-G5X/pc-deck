// Test du filtre d'adresses (porte d'entrée de la sécurité) : npm test
const assert = require('node:assert');
const { isLocalNetwork, isLoopback } = require('./network');

const allowed = ['127.0.0.1', '::1', '::ffff:192.168.1.24', '10.0.0.5', '172.16.0.1', '172.31.255.1',
  '100.64.0.1', '100.86.57.50', '100.127.255.254', 'fd7a:115c:a1e0::5001:39de'];
const refused = ['8.8.8.8', '90.45.82.247', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1',
  '2a01:cb0c:186:b400::1', '192.169.0.1'];

for (const ip of allowed) assert.ok(isLocalNetwork(ip), `devrait être autorisé : ${ip}`);
for (const ip of refused) assert.ok(!isLocalNetwork(ip), `devrait être refusé : ${ip}`);
assert.ok(isLoopback('::ffff:127.0.0.1') && !isLoopback('192.168.1.24'));
console.log(`Filtre d'adresses : ${allowed.length + refused.length} cas OK`);
