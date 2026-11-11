// Détection de la carte graphique (dédiée, intégrée, ou les deux) : npm test
const assert = require('node:assert');
const { extract } = require('./stats');

const S = (id, name, value) => ({ id, name, value, hardware: '' });
const IGPU = '/gpu-intel-integrated/%5C%5C%3F%5CPCI%23VEN_8086%26DEV_64A0';

// Portable avec seulement une puce Intel intégrée (relevé réel : Intel Arc, Core Ultra 7 256V)
const laptop = [
  S('/intelcpu/0/load/0', 'CPU Total', 8.7),
  S(`${IGPU}/clock/0`, 'GPU Core', 1950),
  S(`${IGPU}/load/0`, 'D3D ', 1),
  S(`${IGPU}/load/1`, 'D3D 3D', 12),
  S(`${IGPU}/power/0`, 'GPU Power', 3.5),
  S(`${IGPU}/smalldata/0`, 'D3D Shared Memory Used', 700),
  S(`${IGPU}/smalldata/1`, 'D3D Shared Memory Total', 7900),
];
let r = extract(laptop);
assert.strictEqual(r.gpuLoad, 12, 'charge de la puce intégrée = D3D 3D');
assert.strictEqual(r.gpuPower, 3.5);
assert.strictEqual(r.gpuDetails.memoryUsedMB, 700);
assert.strictEqual(r.gpuDetails.memoryTotalMB, 7900);
assert.strictEqual(r.gpuTemp, null, 'pas de température sur cette puce : affichage "—"');

// Portable avec puce intégrée ET carte NVIDIA : la carte dédiée gagne
r = extract([...laptop, S('/gpu-nvidia/0/load/0', 'GPU Core', 55), S('/gpu-nvidia/0/temperature/0', 'GPU Core', 61), S('/gpu-nvidia/0/power/0', 'GPU Package', 40)]);
assert.strictEqual(r.gpuLoad, 55);
assert.strictEqual(r.gpuTemp, 61);
assert.strictEqual(r.gpuPower, 40);

// Réseau : la carte demandée est suivie ; si LHM ne la connaît pas, la plus active
const N = (hw, name, value) => ({ id: `/nic/${hw}/throughput/${name === 'Download Speed' ? 8 : 7}`, name, value, hardware: hw });
const nics = [N('Wi-Fi', 'Download Speed', 0), N('Wi-Fi', 'Upload Speed', 0), N('Ethernet', 'Download Speed', 5e6), N('Ethernet', 'Upload Speed', 1e6)];
assert.strictEqual(extract(nics, 'Ethernet').netDown, 5e6);
assert.strictEqual(extract(nics, 'Wi-Fi').netDown, 0);
assert.strictEqual(extract(nics, 'Ethernet 2').netDown, 5e6, 'nom inconnu : carte la plus active');

console.log('Carte graphique et réseau : OK');
process.exit(0); // stats.js lance des mesures en arrière-plan
