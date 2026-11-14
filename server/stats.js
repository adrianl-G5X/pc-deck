// Lecture des infos système.
// - CPU et RAM : directement via Node.js (module "os"), rien à installer.
// - Températures, consommation, GPU et réseau : via le serveur web de
//   LibreHardwareMonitor (LHM), qui doit tourner en administrateur.

const os = require('os');
const { getNetworkApps } = require('./netmon');
const { getProcesses } = require('./procmon');

const LHM_URL = process.env.LHM_URL || 'http://127.0.0.1:8085/data.json';
// Carte réseau à suivre : détectée toute seule (celle qui sert à aller sur Internet, câble ou Wi-Fi).
// NET_ADAPTER (nom affiché dans Windows) force un choix.
const NET_ADAPTER = process.env.NET_ADAPTER || '';
let adapter = { name: NET_ADAPTER || 'Wi-Fi', kind: null };

const DETECT_PS = `
$r = @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | ForEach-Object { $a = $_; $m = (Get-NetRoute -DestinationPrefix 0.0.0.0/0 -InterfaceIndex $a.InterfaceIndex -ErrorAction SilentlyContinue | Measure-Object RouteMetric -Minimum).Minimum; $i = (Get-NetIPInterface -InterfaceIndex $a.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).InterfaceMetric; [pscustomobject]@{ name = $a.Name; media = [string]$a.PhysicalMediaType; metric = $(if ($null -eq $m) { 99999 } else { $m + $i }) } } | Sort-Object metric)
ConvertTo-Json -InputObject $r -Compress`;

const kindOf = (name, media) => (/802\.11/.test(media) || /wi-?fi|wlan|sans fil/i.test(name) ? 'wifi' : /802\.3/.test(media) || /ethernet/i.test(name) ? 'ethernet' : null);

function detectAdapter() {
  require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DETECT_PS], { timeout: 10000, windowsHide: true }, (err, out) => {
    if (err) return;
    try {
      const list = JSON.parse(out);
      const best = list[0]; // la plus prioritaire pour Internet ; aucune = on garde la précédente
      if (best) adapter = { name: NET_ADAPTER || best.name, kind: kindOf(best.name, best.media) };
    } catch {}
  });
}
// Estimation du reste du PC (carte mère, RAM, SSD, ventilateurs...) en watts,
// et rendement de l'alimentation. Ce ne sont PAS des mesures.
const OTHER_PARTS_W = Number(process.env.OTHER_PARTS_W) || 50;
const PSU_EFFICIENCY = Number(process.env.PSU_EFFICIENCY) || 0.9;
// Nombre de points gardés pour les graphiques (1 point par seconde).
const HISTORY_LENGTH = 120;

// ---------- CPU (usage en %) ----------
// Windows ne donne pas directement un "% CPU". On compare le temps
// passé "au repos" entre deux mesures pour en déduire l'usage.
function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const t of Object.values(cpu.times)) total += t;
    idle += cpu.times.idle;
  }
  return { idle, total };
}

let previousTimes = cpuTimes();

function readCpuUsage() {
  const now = cpuTimes();
  const idle = now.idle - previousTimes.idle;
  const total = now.total - previousTimes.total;
  previousTimes = now;
  if (total <= 0) return null;
  return round1((1 - idle / total) * 100);
}

// ---------- RAM ----------
function readRam() {
  const total = os.totalmem();
  const used = total - os.freemem();
  return {
    usedGB: round1(used / 1024 ** 3),
    availableGB: round1(os.freemem() / 1024 ** 3),
    totalGB: round1(total / 1024 ** 3),
    percent: round1((used / total) * 100),
  };
}

// ---------- LibreHardwareMonitor ----------
// data.json est un arbre : PC > composant (CPU, GPU, Wi-Fi...) > groupe
// (Temperatures, Powers, Throughput...) > capteur { Text, Value, SensorId }.
// Les valeurs sont du texte au format de Windows, ex. "52,3 °C" ou "1,2 MB/s".
const BYTE_UNITS = { 'B/s': 1, 'KB/s': 1024, 'MB/s': 1024 ** 2, 'GB/s': 1024 ** 3 };

function parseValue(value) {
  if (typeof value !== 'string') return null;
  const n = parseFloat(value.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const unit = value.trim().split(/\s+/).pop();
  return unit in BYTE_UNITS ? n * BYTE_UNITS[unit] : n; // débits convertis en octets/s
}

function collectSensors(node, path, out) {
  if (node.SensorId) {
    out.push({
      id: node.SensorId,
      name: node.Text || '',
      hardware: path[path.length - 2] || '', // le composant (parent du groupe)
      value: parseValue(node.Value),
    });
  }
  for (const child of node.Children || []) {
    collectSensors(child, [...path, node.Text], out);
  }
  return out;
}

function pick(sensors, test, preferredName) {
  const candidates = sensors.filter((s) => s.value !== null && test(s));
  const found = candidates.find((s) => preferredName.test(s.name)) || candidates[0];
  return found ? found.value : null;
}

const isCpu = (kind) => (s) => /^\/(amdcpu|intelcpu)\//.test(s.id) && s.id.includes(`/${kind}/`);
// Carte dédiée (/gpu-nvidia/, /gpu-amd/...) ou puce intégrée (/gpu-intel-integrated/...)
const isGpu = (kind) => (s) => /^\/gpu-(nvidia|amd|intel)(-[a-z]+)?\//.test(s.id) && s.id.includes(`/${kind}/`);
const isNic = (s) => /^\/nic\//.test(s.id) && s.id.includes('/throughput/');
const isNet = (s, name) => isNic(s) && s.hardware === name;

// Valeur d'un capteur au nom exact (ex. "GPU Memory Used"), ou null
function exact(sensors, test, name) {
  const s = sensors.find((x) => test(x) && x.name === name && x.value !== null);
  return s ? s.value : null;
}

// Détail par cœur : fréquence, fréquence effective, tension, puissance, usage.
// L'usage est donné par "thread" (2 par cœur avec l'hyper-threading) : on fait la moyenne.
function readCores(sensors) {
  const byNumber = (kind, re) => {
    const map = new Map();
    for (const s of sensors) {
      if (!isCpu(kind)(s) || s.value === null) continue;
      const m = re.exec(s.name);
      if (m) map.set(Number(m[1]), s.value);
    }
    return map;
  };
  const clocks = byNumber('clock', /^Core #(\d+)$/);
  const effective = byNumber('clock', /^Core #(\d+) \(Effective\)$/);
  const volts = byNumber('voltage', /^Core #(\d+) VID$/);
  const powers = byNumber('power', /^Core #(\d+) \(SMU\)$/);
  const threads = byNumber('load', /^CPU Core #(\d+)$/);

  const count = Math.max(clocks.size, volts.size, powers.size);
  const perCore = count && threads.size >= count ? Math.round(threads.size / count) : 1;
  const cores = [];
  for (let n = 1; n <= count; n++) {
    let load = null;
    const loads = [];
    for (let t = (n - 1) * perCore + 1; t <= n * perCore; t++) if (threads.has(t)) loads.push(threads.get(t));
    if (loads.length) load = round1(loads.reduce((a, b) => a + b, 0) / loads.length);
    cores.push({
      n,
      load,
      clock: clocks.get(n) ?? null,
      effectiveClock: effective.get(n) ?? null,
      voltage: volts.get(n) ?? null,
      power: powers.get(n) ?? null,
    });
  }
  return cores;
}

// Composants (nom + identifiant) : processeur, carte graphique, barrettes de mémoire
function collectHardware(node, out = []) {
  if (node.HardwareId) out.push({ id: node.HardwareId, name: node.Text || '' });
  for (const child of node.Children || []) collectHardware(child, out);
  return out;
}

async function readLhm() {
  const response = await fetch(LHM_URL, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const tree = await response.json();
  return extract(collectSensors(tree, [], []), undefined, collectHardware(tree));
}

// Noms COURTS affichés à côté des mesures : « Ryzen 9 5900X », « RTX 4070 SUPER », « 2 × Corsair »
const squash = (s) => s.replace(/ +/g, ' ').trim();
const shortCpu = (n) => squash(n.replace(/[(](R|TM)[)]/gi, '').replace(/ @ .*$/, '').replace(/CPU|Processor|[0-9]+-Core|^AMD |^Intel /gi, '').replace(/^Core /, '')) || n;
const shortGpu = (n) => { const s = squash(n.replace(/[(](R|TM)[)]/gi, '').replace(/^NVIDIA GeForce |^NVIDIA |^AMD Radeon |^AMD |^Intel /i, '').replace(/ Graphics$/i, '')); return s && !/^graphics$/i.test(s) ? s : squash(n.replace(/[(](R|TM)[)]/gi, '').replace(/^AMD /, '')); };
function hardwareNames(hw) {
  const cpu = hw.find((h) => h.id.startsWith('/amdcpu/') || h.id.startsWith('/intelcpu/'))?.name;
  const gpus = hw.filter((h) => h.id.startsWith('/gpu-'));
  const gpu = (gpus.find((h) => !h.id.includes('-integrated/')) || gpus[0])?.name;
  // Barrettes : seulement la marque (le modèle est trop long) — « 2 × Corsair »
  const brands = hw.filter((h) => h.id.startsWith('/memory/dimm/')).map((h) => h.name.split(/[ -]/)[0]);
  const ram = brands.length ? [...new Set(brands)].map((b) => `${brands.filter((x) => x === b).length > 1 ? brands.filter((x) => x === b).length + ' × ' : ''}${b}`).join(' + ') : null;
  return { cpu: cpu ? shortCpu(cpu) : null, gpu: gpu ? shortGpu(gpu) : null, ram };
}

// Disques (SSD, NVMe, disque dur) : débit de lecture / écriture, place utilisée
const isDisk = (s) => ['/nvme/', '/ssd/', '/hdd/'].some((p) => s.id.startsWith(p));
function readDisks(sensors) {
  const byDisk = new Map();
  for (const s of sensors.filter(isDisk)) {
    const d = byDisk.get(s.hardware) || { name: s.hardware };
    if (/throughput/.test(s.id) && /^Read Rate/.test(s.name)) d.read = s.value;
    else if (/throughput/.test(s.id) && /^Write Rate/.test(s.name)) d.write = s.value;
    else if (s.id.includes('/load/') && s.name === 'Used Space') d.usedPercent = s.value;
    else if (s.id.includes('/data/') && s.name === 'Free Space') d.freeGB = s.value;
    else if (s.id.includes('/data/') && s.name === 'Total Space') d.totalGB = s.value;
    else if (/temperature/.test(s.id) && /^(Composite )?Temperature( #1)?$/.test(s.name)) d.temp = s.value;
    byDisk.set(s.hardware, d);
  }
  return [...byDisk.values()].map((d) => ({ name: d.name, read: d.read ?? null, write: d.write ?? null, usedPercent: round1(d.usedPercent), freeGB: round1(d.freeGB), totalGB: round1(d.totalGB), temp: round1(d.temp) }));
}

// Choisit les valeurs affichées parmi tous les capteurs
function extract(sensors, netName = adapter.name, hw = []) {
  // Nom de carte introuvable dans LHM : on prend la carte qui a le plus de trafic
  if (!sensors.some((s) => isNet(s, netName))) {
    const total = new Map();
    for (const s of sensors.filter(isNic)) total.set(s.hardware, (total.get(s.hardware) || 0) + (s.value || 0));
    netName = [...total].sort((a, b) => b[1] - a[1])[0]?.[0] ?? netName;
  }
  // Carte graphique : la carte dédiée passe avant la puce intégrée (portables qui ont les deux)
  const integrated = (s) => s.id.includes('-integrated/');
  const gpuSensors = [...sensors.filter((s) => !integrated(s)), ...sensors.filter(integrated)];
  const gpu = (kind, name) => exact(gpuSensors, isGpu(kind), name);

  const disks = readDisks(sensors);
  return {
    names: hardwareNames(hw),
    disks,
    cpuTemp: pick(sensors, isCpu('temperature'), /Tctl|Tdie|Package/i),
    cpuPower: pick(sensors, isCpu('power'), /Package/i),
    gpuTemp: pick(gpuSensors, isGpu('temperature'), /GPU Core/i),
    // puce intégrée : pas de "GPU Core" en charge, mais "D3D 3D" (charge 3D vue par Windows)
    gpuLoad: gpu('load', 'GPU Core') ?? gpu('load', 'D3D 3D') ?? pick(gpuSensors, isGpu('load'), /GPU/i),
    gpuPower: pick(gpuSensors, isGpu('power'), /Package|Power/i),
    netDown: pick(sensors, (s) => isNet(s, netName) && /Download/i.test(s.name), /Download/i),
    netUp: pick(sensors, (s) => isNet(s, netName) && /Upload/i.test(s.name), /Upload/i),
    cpuDetails: {
      cores: readCores(sensors),
      averageClock: exact(sensors, isCpu('clock'), 'Cores (Average)'),
      coreVoltage: pick(sensors, (s) => isCpu('voltage')(s) && /^Core \(/.test(s.name), /SVI/),
    },
    gpuDetails: {
      memoryUsedMB: gpu('smalldata', 'GPU Memory Used') ?? gpu('smalldata', 'D3D Shared Memory Used'),
      memoryTotalMB: gpu('smalldata', 'GPU Memory Total') ?? gpu('smalldata', 'D3D Shared Memory Total'),
      coreClock: gpu('clock', 'GPU Core'),
      memoryClock: gpu('clock', 'GPU Memory'),
      hotSpotTemp: gpu('temperature', 'GPU Hot Spot'),
      memoryTemp: gpu('temperature', 'GPU Memory Junction'),
      voltage: gpu('voltage', 'GPU Core Voltage'),
      fanRpm: pick(gpuSensors, isGpu('fan'), /Fan 1/),
      fanPercent: pick(gpuSensors, isGpu('control'), /Fan 1/),
    },
  };
}

// ---------- Mise à jour périodique ----------
const latest = {
  time: null,
  cpu: { usage: null, temp: null, power: null, name: null },
  gpu: { usage: null, temp: null, power: null, name: null },
  disk: { read: null, write: null, list: [] }, // en octets/s (total de tous les disques)
  ram: readRam(),
  power: { measured: null, estimatedWall: null },
  network: { adapter: adapter.name, kind: null, down: null, up: null }, // en octets/s ; kind : 'wifi' | 'ethernet'
  history: [], // [{ t, cpuPower, gpuPower, cpuUsage, gpuUsage, down, up }]
  lhm: { ok: false, error: 'pas encore interrogé' },
};

async function refresh() {
  latest.time = new Date().toISOString();
  latest.cpu.usage = readCpuUsage();
  latest.ram = { ...readRam(), name: latest.ram.name ?? null }; // le nom des barrettes est gardé d'un tour à l'autre

  let t = {};
  try {
    t = await readLhm();
    latest.lhm = { ok: true };
  } catch (err) {
    latest.lhm = {
      ok: false,
      error: `LibreHardwareMonitor injoignable sur ${LHM_URL} (${err.message})`,
    };
  }

  latest.cpu.temp = round1(t.cpuTemp);
  latest.cpu.power = round1(t.cpuPower);
  latest.gpu.temp = round1(t.gpuTemp);
  latest.gpu.usage = round1(t.gpuLoad);
  latest.gpu.power = round1(t.gpuPower);
  latest.network.adapter = adapter.name;
  latest.network.kind = adapter.kind;
  latest.network.down = t.netDown ?? null;
  latest.network.up = t.netUp ?? null;
  if (t.names) { latest.cpu.name = t.names.cpu; latest.gpu.name = t.names.gpu; latest.ram.name = t.names.ram; }
  const sum = (k) => { const v = (t.disks || []).map((d) => d[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  latest.disk = { read: sum('read'), write: sum('write'), list: t.disks || [] };
  latest.cpu.details = t.cpuDetails ?? null;
  latest.gpu.details = t.gpuDetails ?? null;
  latest.network.apps = getNetworkApps();
  latest.processes = getProcesses(); // applis qui utilisent le plus le processeur / la mémoire

  const measured = (t.cpuPower ?? 0) + (t.gpuPower ?? 0);
  const hasPower = t.cpuPower != null || t.gpuPower != null;
  latest.power.measured = hasPower ? round1(measured) : null;
  latest.power.estimatedWall = hasPower
    ? Math.round((measured + OTHER_PARTS_W) / PSU_EFFICIENCY)
    : null;

  latest.history.push({
    t: Date.now(),
    cpuPower: latest.cpu.power,
    gpuPower: latest.gpu.power,
    cpuUsage: latest.cpu.usage,
    gpuUsage: latest.gpu.usage,
    down: latest.network.down,
    up: latest.network.up,
    diskRead: latest.disk.read,
    diskWrite: latest.disk.write,
  });
  if (latest.history.length > HISTORY_LENGTH) latest.history.shift();
}

function startStats(intervalMs = 1000) {
  detectAdapter();
  setInterval(detectAdapter, 15000); // câble branché ou débranché : le graphique suit
  refresh();
  setInterval(refresh, intervalMs);
}

function getStats() {
  return latest;
}

function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}

module.exports = { startStats, getStats, extract };
