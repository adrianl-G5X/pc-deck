// Interface PC Deck : connexion WebSocket au PC, appairage, boutons et infos.

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'pcdeck-token';
let authRetries = 0;
// Demande au navigateur de ne pas effacer le « laissez-passer » de cet appareil (évite de retaper le code)
try { navigator.storage?.persist?.(); } catch {}

// ---------- Mémoire de l'appareil (jeton d'appairage) ----------
function loadToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function saveToken(token) {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch {}
}

// ---------- Mise en forme ----------
const num = (v, unit) => (v == null ? '—' : v + unit);
const watts = (v) => (v == null ? '—' : Math.round(v) + ' W');
function speed(bytesPerSec) {
  if (bytesPerSec == null) return '—';
  if (bytesPerSec >= 1024 ** 2) return (bytesPerSec / 1024 ** 2).toFixed(1).replace('.', ',') + ' Mo/s';
  return Math.round(bytesPerSec / 1024) + ' Ko/s';
}

const fr = (v, digits = 0) =>
  v == null ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// ---------- Graphiques ----------
const cpuChart = createLineChart($('cpuChart'), {
  series: [{ key: 'cpuPower', label: 'Processeur', color: '--series-mono' }],
  format: watts,
  autoZoom: 4,
  windowMs: 60000,
});
const gpuChart = createLineChart($('gpuChart'), {
  series: [{ key: 'gpuPower', label: 'Carte graphique', color: '--series-mono' }],
  format: watts,
  autoZoom: 4,
  windowMs: 60000,
});
const netChart = createLineChart($('netChart'), {
  series: [
    { key: 'down', label: 'Réception', color: '--series-1' },
    { key: 'up', label: 'Envoi', color: '--series-2' },
  ],
  format: speed,
  minMax: 100 * 1024,
});

const diskChart = createLineChart($('diskChart'), {
  series: [
    { key: 'diskRead', label: 'Lecture', color: '--series-1' },
    { key: 'diskWrite', label: 'Écriture', color: '--series-2' },
  ],
  format: speed,
  minMax: 1024 * 1024,
});

// ---------- Graphiques en plein écran ----------
const EXPAND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function setExpanded(card, on) {
  card.classList.toggle('expanded', on);
  document.body.classList.toggle('has-expanded', !!document.querySelector('.chart-card.expanded'));
  const btn = card.querySelector('.expand');
  btn.innerHTML = on ? CLOSE_ICON : EXPAND_ICON;
  btn.setAttribute('aria-label', on ? 'Réduire le graphique' : 'Agrandir le graphique');
  if (lastStats) showNetApps(lastStats.network.apps);
}
for (const btn of document.querySelectorAll('.chart-card .expand')) {
  btn.innerHTML = EXPAND_ICON;
  btn.addEventListener('click', () => {
    const card = btn.closest('.chart-card');
    setExpanded(card, !card.classList.contains('expanded'));
  });
}

// ---------- Applis qui utilisent le plus le réseau ----------
function showNetApps(info) {
  const box = $('netApps');
  // Pas de mesure (droits Windows manquants...) : on cache le panneau,
  // le graphique Wi-Fi prend toute la largeur.
  box.closest('.apps').hidden = !info || !info.ok;
  if (!info || !info.ok) return;
  const expanded = !!box.closest('.chart-card.expanded');
  const apps = info.apps.filter((a) => a.down + a.up >= 1024).slice(0, expanded ? 8 : 3);
  if (!apps.length) {
    const note = document.createElement('div');
    note.className = 'apps-note';
    note.textContent = 'Aucun trafic en ce moment.';
    box.replaceChildren(note);
    return;
  }
  const max = Math.max(...apps.map((a) => a.down + a.up));
  box.replaceChildren(
    ...apps.map((a) => {
      const row = document.createElement('div');
      row.className = 'app-row';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = a.name.charAt(0).toUpperCase() + a.name.slice(1);
      const total = document.createElement('span');
      total.className = 'total';
      total.textContent = speed(a.down + a.up);
      const split = document.createElement('span');
      split.className = 'split';
      split.textContent = `↓ ${speed(a.down)} · ↑ ${speed(a.up)}`;
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.width = Math.max(4, ((a.down + a.up) / max) * 100) + '%';
      row.append(name, total, split, bar);
      return row;
    })
  );
}

// ---------- Fenêtre de détails (processeur / carte graphique) ----------
let detailKind = null;
let lastStats = null;

function openDetail(kind) {
  detailKind = kind;
  $('detailTitle').textContent = {
    cpu: 'Processeur — détail des cœurs',
    gpu: 'Carte graphique — détails',
    ram: 'Mémoire vive — détails',
  }[kind];
  $('detail').hidden = false;
  renderDetail();
}
function closeDetail() {
  detailKind = null;
  $('detail').hidden = true;
}
for (const el of document.querySelectorAll('[data-detail]')) {
  el.addEventListener('click', () => openDetail(el.dataset.detail));
}
$('detailClose').addEventListener('click', closeDetail);
$('detail').addEventListener('click', (e) => { if (e.target === $('detail')) closeDetail(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (detailKind) closeDetail();
  else for (const c of document.querySelectorAll('.chart-card.expanded')) setExpanded(c, false);
});

function summary(items) {
  return '<div class="summary">' +
    // Mesure que ce PC ne fournit pas (ex. température d'une puce graphique intégrée) : case cachée
    items.filter(([, value]) => !String(value).startsWith('—'))
      .map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`).join('') +
    '</div>';
}

let pilotOn = false; // pilotage autorisé sur le PC : boutons « Fermer » dans le détail
const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const appName = (n) => n.charAt(0).toUpperCase() + n.slice(1);
function memSize(bytes) {
  return bytes >= 1024 ** 3 ? `${fr(bytes / 1024 ** 3, 1)} Go` : `${fr(bytes / 1024 ** 2, 0)} Mo`;
}

// Liste "applis qui utilisent le plus…" : nom, barre proportionnelle, valeur
function topApps(title, items, valueOf, format) {
  if (!items) return `<h3 class="apps-heading">${title}</h3><p class="apps-note">Mesure en cours…</p>`;
  if (!items.length) return `<h3 class="apps-heading">${title}</h3><p class="apps-note">Aucune donnée.</p>`;
  const max = Math.max(...items.map(valueOf), 0.0001);
  return `<h3 class="apps-heading">${title}</h3><div class="top-apps">` +
    items.map((a) => `
      <div class="top-app">
        <span class="name">${escapeHtml(appName(a.name))}</span>
        <div class="track"><div class="fill" style="width:${Math.max(2, (valueOf(a) / max) * 100)}%"></div></div>
        <b>${format(a)}</b>${pilotOn ? `<button class="kill" type="button" data-kill="${escapeHtml(a.name)}">Fermer</button>` : ''}
      </div>`).join('') +
    '</div>';
}

function renderDetail() {
  if (!detailKind || !lastStats) return;
  const s = lastStats;
  const body = $('detailBody');

  if (detailKind === 'ram') {
    const r = s.ram;
    body.innerHTML =
      `<h2 style="font-size:14px;color:var(--text-secondary);margin:0">Mémoire utilisée</h2>
       <div class="mem-bar"><div class="fill" style="width:${r.percent}%"></div></div>
       <div class="mem-text"><span><b>${fr(r.usedGB, 1)} Go</b> sur ${fr(r.totalGB, 1)} Go</span><b>${fr(r.percent, 0)} %</b></div>` +
      summary([
        ['Utilisée', `${fr(r.usedGB, 1)} Go`],
        ['Disponible', `${fr(r.availableGB, 1)} Go`],
        ['Total', `${fr(r.totalGB, 1)} Go`],
      ]) +
      topApps('Les 5 applis qui utilisent le plus de mémoire', s.processes && s.processes.mem.slice(0, 5),
        (a) => a.bytes, (a) => memSize(a.bytes));
    return;
  }

  if (detailKind === 'cpu') {
    const d = s.cpu.details;
    if (!d || !d.cores.length) {
      body.innerHTML = '<p class="apps-note">Détails indisponibles : LibreHardwareMonitor doit tourner en administrateur.</p>';
      return;
    }
    const rows = d.cores.map((c) => `
      <tr>
        <td>${c.n}</td>
        <td class="usage"><div class="usage-bar"><div class="track"><div class="fill" style="width:${c.load ?? 0}%"></div></div><span>${fr(c.load, 0)}</span></div></td>
        <td>${fr(c.clock != null ? c.clock / 1000 : null, 2)}</td>
        <td>${fr(c.effectiveClock != null ? c.effectiveClock / 1000 : null, 2)}</td>
        <td>${fr(c.voltage, 3)}</td>
        <td>${fr(c.power, 1)}</td>
      </tr>`).join('');
    body.innerHTML =
      summary([
        ['Usage', `${fr(s.cpu.usage, 0)} %`],
        ['Température', `${fr(s.cpu.temp, 1)} °C`],
        ['Consommation', `${fr(s.cpu.power, 0)} W`],
        ['Fréquence moyenne', `${fr(d.averageClock != null ? d.averageClock / 1000 : null, 2)} GHz`],
        ['Tension cœurs', `${fr(d.coreVoltage, 3)} V`],
      ]) +
      topApps('Les 3 applis qui utilisent le plus le processeur', s.processes && s.processes.cpu.slice(0, 3),
        (a) => a.percent, (a) => `${fr(a.percent, 1)} %`) +
      `<h3 class="apps-heading">Détail des cœurs</h3>
      <table class="cores">
        <thead><tr><th>Cœur</th><th>Usage %</th><th>Fréq. GHz</th><th>Effect. GHz</th><th>Tension V</th><th>Puiss. W</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } else {
    const d = s.gpu.details;
    if (!d) {
      body.innerHTML = '<p class="apps-note">Détails indisponibles : LibreHardwareMonitor ne répond pas.</p>';
      return;
    }
    const used = d.memoryUsedMB;
    const total = d.memoryTotalMB;
    const pct = used != null && total ? (used / total) * 100 : null;
    body.innerHTML =
      `<h2 style="font-size:14px;color:var(--text-secondary);margin:0">Mémoire vidéo utilisée</h2>
       <div class="mem-bar"><div class="fill" style="width:${pct ?? 0}%"></div></div>
       <div class="mem-text"><span><b>${fr(used != null ? used / 1024 : null, 1)} Go</b> sur ${fr(total != null ? total / 1024 : null, 1)} Go</span><b>${fr(pct, 0)} %</b></div>` +
      summary([
        ['Usage', `${fr(s.gpu.usage, 0)} %`],
        ['Consommation', `${fr(s.gpu.power, 0)} W`],
        ['Température', `${fr(s.gpu.temp, 0)} °C`],
        ['Point chaud', `${fr(d.hotSpotTemp, 0)} °C`],
        ['Temp. mémoire', `${fr(d.memoryTemp, 0)} °C`],
        ['Fréquence cœur', `${fr(d.coreClock, 0)} MHz`],
        ['Fréquence mémoire', `${fr(d.memoryClock, 0)} MHz`],
        ['Tension', `${fr(d.voltage, 3)} V`],
        ['Ventilateurs', `${fr(d.fanRpm, 0)} tr/min (${fr(d.fanPercent, 0)} %)`],
      ]);
  }
}

let diskOff = false; // Paramètres : « Graphique disque » décoché
function showStats(s) {
  lastStats = s;
  $('cpuUsage').textContent = s.cpu.usage ?? '—';
  $('cpuTemp').textContent = num(s.cpu.temp, ' °C');
  $('cpuPower').textContent = watts(s.cpu.power);
  $('gpuUsage').textContent = s.gpu.usage ?? '—';
  $('gpuTemp').textContent = num(s.gpu.temp, ' °C');
  $('gpuPower').textContent = watts(s.gpu.power);
  // Images par seconde du jeu au premier plan (RivaTuner / MSI Afterburner sur le PC)
  $('fpsWrap').hidden = s.fps == null;
  if (s.fps != null) $('fps').textContent = s.fps;
  $('ramPct').textContent = Math.round(s.ram.percent);
  $('ramUsed').textContent = s.ram.usedGB + ' / ' + s.ram.totalGB + ' Go';
  $('powerMeasured').textContent = s.power.measured == null ? '—' : Math.round(s.power.measured);
  $('powerWall').textContent = watts(s.power.estimatedWall);
  $('lgCpu').textContent = watts(s.cpu.power);
  $('lgGpu').textContent = watts(s.gpu.power);
  $('netTitle').textContent = s.network.kind === 'ethernet' ? 'Câble (Ethernet)' : s.network.kind === 'wifi' ? 'Wi-Fi' : 'Réseau';
  $('lgDown').textContent = speed(s.network.down);
  $('lgUp').textContent = speed(s.network.up);
  $('lhmWarn').textContent = s.lhm.ok ? '' : s.lhm.error;
  cpuChart.update(s.history);
  gpuChart.update(s.history);
  netChart.update(s.history);
  // Noms des composants à côté des titres
  $('cpuName').textContent = s.cpu.name || '';
  $('gpuName').textContent = s.gpu.name || '';
  $('ramName').textContent = s.ram.name || '';
  // Disque : débit lecture / écriture, et place utilisée
  const disks = s.disk?.list || [], d0 = disks[0];
  $('diskCard').hidden = !disks.length || diskOff;
  $('diskName').textContent = disks.length > 1 ? `${disks.length} disques` : d0?.name || '';
  $('lgDiskRead').textContent = speed(s.disk?.read);
  $('lgDiskWrite').textContent = speed(s.disk?.write);
  $('diskBar').style.width = (d0?.usedPercent ?? 0) + '%';
  $('diskSpace').textContent = disks.map((d) => `${disks.length > 1 ? d.name + ' : ' : ''}${fr(d.usedPercent, 0)} % utilisé · ${fr(d.freeGB, 0)} Go libres sur ${fr(d.totalGB, 0)} Go`).join('  |  ');
  diskChart.update(s.history);
  showNetApps(s.network.apps);
  renderDetail();
}

// ---------- Cible des boutons de son ----------
let audio = { mode: 'system', appLabel: null, bigStep: false };

function showAudio(state) {
  audio = state;
  $('audioSwitch').hidden = !state.appLabel;
  // 1 appli : interrupteur « Son sur <appli> ». Plusieurs : chaque appui passe à la suivante (Windows → appli 1 → appli 2 → Windows)
  const many = (state.apps || []).length > 1;
  $('audioAppLabel').textContent = many && state.mode !== 'app' ? 'Windows' : state.appLabel || '';
  $('audioApp').checked = state.mode === 'app';
  $('bigStep').checked = !!state.bigStep;
  $('bigStep').closest('label').hidden = state.bigStepEnabled === false; // désactivé dans les Paramètres
  for (const el of document.querySelectorAll('.deck-btn .target')) updateTarget(el);
}

// Niveaux de volume actuels, envoyés par le PC : { system: {volume, muted}, app: ... }
let levels = { system: null, app: null };
function showLevels(next) {
  levels = next || { system: null, app: null };
  for (const el of document.querySelectorAll('.deck-btn .target')) updateTarget(el);
}

// Étiquette sous un bouton de son, ex. "Apple Music · ±10 %" ou "Système · 42 %"
function updateTarget(el) {
  const app = audio.mode === 'app';
  let text = app ? audio.appLabel : 'Système';
  if (el.dataset.op !== 'mute') {
    text += ` · ±${audio.bigStep ? el.dataset.bigStep : el.dataset.step} %`;
  } else {
    // Sur "Son on/off" : le niveau actuel
    const lv = app ? levels.app : levels.system;
    if (lv) text += lv.muted ? ' · coupé' : ` · ${lv.volume} %`;
  }
  el.textContent = text;
  el.classList.toggle('app', app);
}

$('audioApp').addEventListener('change', (e) => {
  buzz();
  const apps = audio.apps || [];
  if (apps.length > 1) {
    e.target.checked = audio.mode === 'app'; // l'affichage suit la réponse du PC
    const i = audio.mode === 'app' ? apps.indexOf(audio.appLabel) : -1;
    if (i === apps.length - 1) send({ type: 'set-audio-mode', mode: 'system' });
    else send({ type: 'set-audio-mode', mode: 'app', app: apps[i + 1] });
    return;
  }
  send({ type: 'set-audio-mode', mode: e.target.checked ? 'app' : 'system' });
});
for (const id of ['audioApp', 'bigStep']) $(id).addEventListener('change', (e) => { if (e.target.checked) flash(e.target.closest('label')); });
$('bigStep').addEventListener('change', (e) => {
  buzz();
  send({ type: 'set-volume-step', big: e.target.checked });
});

// ---------- Interrupteurs (ex. micro Discord) ----------
const ICONS = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="3" y1="3" x2="21" y2="21"/></svg>',
};

// Petite onde quand un interrupteur s'allume (relancée à chaque fois)
function flash(el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
const lastToggle = new Map(); // état affiché de chaque interrupteur : anime ceux qui changent depuis le PC
function toggleState(el, mic, active) {
  el.classList.toggle('active', active);
  el.setAttribute('aria-checked', String(active));
  el.querySelector('.state').textContent = mic ? (active ? 'Muet' : 'Micro actif') : (active ? 'Activé' : 'Désactivé');
}

function showToggles(toggles) {
  $('toggles').replaceChildren(
    ...toggles.map((t) => {
      const mic = t.style === 'mic';
      const el = document.createElement('button');
      el.type = 'button';
      const was = lastToggle.get(t.id);
      lastToggle.set(t.id, !!t.active);
      el.className = 'toggle' + (mic ? '' : ' plain') + (t.active ? ' active' : '') + (was !== undefined && was !== !!t.active ? ' moved' + (t.active ? ' flash' : '') : '');
      el.setAttribute('role', 'switch');
      el.setAttribute('aria-checked', String(t.active));
      el.innerHTML =
        '<span class="name"></span>' +
        (mic ? `<span class="side on" title="Micro actif">${ICONS.mic}</span>` : '') +
        `<span class="switch-track"><span class="switch-thumb">${mic ? ICONS.mic.replace('<svg', '<svg class="ic-on"') + ICONS.micOff.replace('<svg', '<svg class="ic-off"') : ''}</span></span>` +
        (mic ? `<span class="side off" title="Micro coupé">${ICONS.micOff}</span>` : '') +
        '<span class="state"></span>';
      el.querySelector('.name').textContent = t.label;
      toggleState(el, mic, !!t.active);

      // Appui court : bascule. Appui long (1 s) : corrige seulement l'affichage,
      // si tu as changé l'état directement dans l'application.
      let timer = null;
      let longPress = false;
      el.addEventListener('pointerdown', () => {
        longPress = false;
        timer = setTimeout(() => {
          longPress = true;
          buzz(25);
          send({ type: 'toggle-sync', id: t.id });
          toast('Affichage corrigé (rien envoyé à l\'application)');
        }, 1000);
      });
      const cancel = () => clearTimeout(timer);
      el.addEventListener('pointerup', cancel);
      el.addEventListener('pointerleave', cancel);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.addEventListener('click', () => {
        if (longPress) return;
        buzz();
        // Réaction immédiate (le PC confirme ensuite et corrige si besoin)
        const on = !el.classList.contains('active');
        lastToggle.set(t.id, on);
        el.classList.remove('moved');
        toggleState(el, mic, on);
        if (on) flash(el);
        send({ type: 'toggle', id: t.id });
      });
      return el;
    })
  );
}

// ---------- Indicateur de volume (en bas au milieu, comme sur le PC) ----------
const HUD_ICONS = {
  on: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>',
  off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
};
let hudTimer = null;
function showVolumeHud({ label, level, muted }) {
  const hud = $('volumeHud');
  $('hudIcon').innerHTML = muted || level === 0 ? HUD_ICONS.off : HUD_ICONS.on;
  $('hudLabel').textContent = label;
  $('hudFill').style.width = (muted ? 0 : level) + '%';
  $('hudValue').textContent = muted ? 'Coupé' : `${level} %`;
  hud.classList.toggle('muted', !!muted);
  hud.classList.add('show');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => hud.classList.remove('show'), 1600);
}

// ---------- Erreur d'un bouton : reste affichée jusqu'à « OK », avec « Réessayer » ----------
let errId = null;
function showError(text, id) {
  errId = allButtons.some((b) => b.id === id) ? id : null;
  $('errText').textContent = text;
  $('errRetry').hidden = !errId;
  $('errCard').hidden = false;
  buzz(60);
}
$('errOk').addEventListener('click', () => { $('errCard').hidden = true; });
$('errRetry').addEventListener('click', () => { $('errCard').hidden = true; if (errId) runButton(errId, 'single'); });

// ---------- Message temporaire ----------
let toastTimer = null;
function toast(text, isError) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isError ? Math.min(9000, 3500 + text.length * 55) : 1800); // une erreur avec sa solution se lit en entier
}

// ---------- Boutons ----------
// ---------- Versions : interface, appli tablette et PC ----------
// L'interface vient du PC, donc elle est toujours à sa version. Deux cas restent :
// - copie de l'interface plus ancienne que le PC (appli Android hors ligne) : on recharge ;
// - appli Android (la « coquille ») plus ancienne que celle fournie par le PC : on propose
//   de l'installer, et on bloque si elle est trop ancienne pour fonctionner.
const CLIENT_PROTOCOL = 20; // le PC annonce un protocole plus grand : la page se recharge une fois pour prendre la nouvelle interface
function checkVersions(msg) {
  if (msg.protocol > CLIENT_PROTOCOL) {
    try {
      if (sessionStorage.getItem('pcdeck-reload') !== String(msg.protocol)) {
        sessionStorage.setItem('pcdeck-reload', String(msg.protocol));
        location.reload();
        return true;
      }
    } catch {}
  }
  const box = $('appUpdate');
  box.hidden = true;
  if (!NATIVE || !msg.app) return false;
  // L'appli 0.3.0 ne sait pas encore donner son numéro de version
  const installed = Number(NATIVE.appVersionCode?.()) || 300;
  if (installed >= msg.app.versionCode || sessionStorage.getItem('pcdeck-later') === String(msg.app.versionCode)) return false;
  const blocking = installed < msg.app.minVersionCode;
  box.classList.toggle('blocking', blocking);
  $('appUpdateText').textContent = blocking
    ? `Cette appli est trop ancienne pour ce PC. Installe la version ${msg.app.versionName} pour continuer.`
    : `Nouvelle version de l'appli tablette : ${msg.app.versionName}.`;
  const canInstall = typeof NATIVE.installUpdate === 'function';
  $('appUpdateBtn').hidden = !canInstall;
  $('appUpdateHelp').hidden = canInstall;
  $('appUpdateLater').hidden = blocking;
  $('appUpdateLater').onclick = () => {
    try { sessionStorage.setItem('pcdeck-later', String(msg.app.versionCode)); } catch {}
    box.hidden = true;
  };
  box.hidden = false;
  return false;
}
$('appUpdateBtn').addEventListener('click', () => {
  NATIVE.installUpdate();
  $('appUpdateText').textContent = 'Téléchargement depuis le PC… Touche « Mettre à jour » quand Android le demande. L\'appli se ferme ensuite : rouvre-la depuis son icône.';
});

// ---------- Affichage (réglé dans la page Paramètres du PC) ----------
// Thème clair/sombre, couleur d'accent, nombre de colonnes de boutons, infos affichées.
function applyDisplay(d) {
  if (typeof Tools !== 'undefined') Tools.setLayout(d.tools); // menu Outils : ordre et noms choisis sur le PC
  else window.pendingToolsLayout = d.tools;
  if (!d) return;
  const root = document.documentElement;
  root.dataset.theme = d.theme === 'light' ? 'light' : 'dark';
  root.style.setProperty('--amber', d.accent);
  PcDeckColors.apply(root, d); // fond, touches, texte, courbes personnalisés
  root.style.setProperty('--cols', d.columns);
  const show = d.show || {};
  const card = (id) => document.getElementById(id)?.closest('.card');
  const parts = {
    cpu: document.querySelector('[data-detail="cpu"]'),
    gpu: document.querySelector('[data-detail="gpu"]'),
    ram: document.querySelector('[data-detail="ram"]'),
    power: $('tilePower'),
    cpuChart: card('cpuChart'),
    gpuChart: card('gpuChart'),
    netChart: card('netChart'),
  };
  diskOff = show.diskChart === false;
  if (lastStats) $('diskCard').hidden = !(lastStats.disk?.list || []).length || diskOff;
  for (const [key, el] of Object.entries(parts)) if (el) el.hidden = show[key] === false;
  const row = document.querySelector('.chart-row');
  if (row) row.hidden = show.cpuChart === false && show.gpuChart === false;
  mediaShown = show.media !== false;
  playerFull = d.playerFull !== false;
  lyricsOn = d.lyrics === true;
  $('mediaCard').style.cursor = playerFull ? 'pointer' : 'default';
  updatePlayer(true);
  layoutLocked = d.lockLayout === true; // Paramètres : « Verrouiller la disposition » (pas d'appui long)
  standbyMin = Number(d.standby) || 0; // Paramètres : veille après N minutes sans toucher (0 = jamais)
  armStandby();
  vibrateOn = d.vibrate !== false; // Paramètres > Thème : « Vibration au toucher »
  root.style.setProperty('--btn-h', ({ small: '64px', large: '128px' })[d.buttonSize] || '84px'); // taille des boutons
  root.dataset.btnSize = d.buttonSize || 'normal';
  showMedia(media);
}

// ---------- Mélangeur de volume ----------
let layoutLocked = false;

// ---------- Astuces au premier lancement : les gestes qu'on ne devine pas ----------
const TIPS = [
  ['Modifier un bouton', 'Garde le doigt appuyé sur un bouton : tu peux le renommer, le déplacer ou le ranger sur une autre page.'],
  ['Changer de page', "S'il y a plusieurs pages, glisse le doigt vers la gauche ou la droite, ou touche leurs noms en haut."],
  ['Double appui', 'Sur un navigateur ou un dossier, deux appuis rapides ouvrent un nouvel onglet.'],
  ['Les icônes du haut', 'Volume, Envoyer (photo vers le PC), Souris, Écran PC… Le nom est écrit sous chaque icône.'],
];
function showTips() {
  let i = 0;
  const step = () => {
    if (i >= TIPS.length) { $('tipsBox').hidden = true; try { localStorage.setItem('pcdeck-tips', '1'); } catch {} return; }
    $('tipsTitle').textContent = TIPS[i][0];
    $('tipsText').textContent = TIPS[i][1];
    $('tipsStep').textContent = `${i + 1} / ${TIPS.length}`;
    $('tipsNext').textContent = i === TIPS.length - 1 ? 'Compris !' : 'Suivant';
    i++;
  };
  $('tipsNext').onclick = step;
  step();
  $('tipsBox').hidden = false;
}
document.querySelector('.panel-head h1').addEventListener('click', showTips); // toucher « PC Deck » : revoir les astuces
function maybeTips() {
  try { if (localStorage.getItem('pcdeck-tips')) return; } catch { return; }
  setTimeout(() => { if ($('tipsBox').hidden && $('pair').hidden) showTips(); }, 1200);
}

// ---------- Veille : horloge, météo et morceau en cours en grand ----------
// Après N minutes sans toucher (Paramètres → Affichage). Un toucher la ferme (sans appuyer sur un bouton).
let standbyMin = 0, standbyTimer = null;
function armStandby() {
  clearTimeout(standbyTimer);
  if (standbyMin > 0 && $('standby').hidden) standbyTimer = setTimeout(showStandby, standbyMin * 60000);
}
function showStandby() {
  if (!$('player').hidden || !$('remote').hidden) return armStandby(); // lecteur ou écran du PC ouverts : pas de veille
  $('standby').hidden = false;
  tickStandby();
}
function tickStandby() {
  if ($('standby').hidden) return;
  const now = new Date();
  $('sbTime').textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  $('sbDate').textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase());
  $('sbWeather').textContent = weather ? `${weather.temp}° · ${weather.text} · ${weather.city}` : '';
  $('sbMedia').textContent = $('mediaCard').hidden ? '' : `♪ ${$('mediaTitle').textContent} — ${$('mediaArtist').textContent}`;
}
setInterval(tickStandby, 10000);
$('standby').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); $('standby').hidden = true; armStandby(); }, true);
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, armStandby, { passive: true });

// ---------- Pavé tactile, texte et presse-papiers ----------
// Réservés au pilotage (Paramètres du PC → « Contrôle à distance… et le piloter ») : le PC refuse sinon.
$('padBtn').addEventListener('click', () => { $('padBox').hidden = false; });
$('padBox').addEventListener('click', (e) => { if (e.target === $('padBox')) $('padBox').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('padBox').hidden = true; });
{
  const area = $('padArea');
  const pts = new Map(); // doigts posés : id -> [x, y]
  let first = null, most = 0, travel = 0, downAt = 0, pend = [0, 0], scroll = 0, raf = 0;
  const click = (b) => { send({ type: 'pad', action: 'button', button: b, state: 'down' }); send({ type: 'pad', action: 'button', button: b, state: 'up' }); };
  // Un envoi par image : les petits déplacements s'additionnent (le reste après arrondi est gardé)
  const flush = () => {
    raf = 0;
    const dx = Math.round(pend[0] * 1.6), dy = Math.round(pend[1] * 1.6);
    if (dx || dy) { send({ type: 'pad', action: 'move', dx, dy }); pend = [pend[0] - dx / 1.6, pend[1] - dy / 1.6]; }
    if (Math.abs(scroll) >= 15) { send({ type: 'pad', action: 'wheel', delta: Math.round(scroll * 4) }); scroll = 0; }
  };
  area.addEventListener('pointerdown', (e) => {
    area.setPointerCapture(e.pointerId);
    if (!pts.size) { first = e.pointerId; most = 0; travel = 0; downAt = Date.now(); }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    most = Math.max(most, pts.size);
  });
  area.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    travel += Math.hypot(dx, dy);
    if (pts.size === 1) { pend[0] += dx; pend[1] += dy; } else if (e.pointerId === first) scroll += dy; // 2 doigts : défiler
    if (!raf) raf = requestAnimationFrame(flush);
  });
  const up = (e) => {
    if (!pts.delete(e.pointerId) || pts.size) return;
    if (travel < 10 && Date.now() - downAt < 350) { buzz(8); click(most >= 2 ? 'r' : 'l'); } // toucher = clic
  };
  area.addEventListener('pointerup', up);
  area.addEventListener('pointercancel', up);
  $('padL').addEventListener('click', () => click('l'));
  $('padR').addEventListener('click', () => click('r'));
  $('padType').addEventListener('click', () => {
    const text = $('padText').value;
    if (!text) return toast("Écris d'abord le texte à taper", true);
    send({ type: 'pad', action: 'text', text });
    $('padText').value = '';
  });
  for (const b of document.querySelectorAll('#padBox [data-key]')) b.addEventListener('click', () => send({ type: 'pad', action: 'key', key: b.dataset.key }));
  $('clipGet').addEventListener('click', () => send({ type: 'clip-get' }));
  $('clipSet').addEventListener('click', async () => {
    let text = $('padText').value;
    if (!text) try { text = await navigator.clipboard.readText(); } catch {} // http : souvent refusé, d'où la zone de texte
    if (!text) return toast("Colle d'abord le texte dans la zone ci-dessus", true);
    send({ type: 'clip-set', text });
  });
}
// ---------- Envoyer une photo ou un fichier au PC ----------
// Rangés sur le PC dans le dossier choisi dans les Paramètres (par défaut Téléchargements\PC Deck). Envoi direct (HTTP), avec le laissez-passer de l'appareil.
$('sendBtn').addEventListener('click', () => $('sendFile').click());
$('sendFile').addEventListener('change', async () => {
  const files = [...$('sendFile').files];
  $('sendFile').value = '';
  for (const [i, f] of files.entries()) {
    const label = files.length > 1 ? `${i + 1}/${files.length} ` : '';
    try {
      const dir = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${location.protocol === 'https:' ? 'https' : 'http'}://${link.host}/api/upload?name=${encodeURIComponent(f.name)}`);
        xhr.setRequestHeader('X-PCDeck-Token', loadToken() || '');
        xhr.upload.onprogress = (e) => e.lengthComputable && toast(`Envoi ${label}: ${Math.round((e.loaded / e.total) * 100)} %`);
        xhr.onload = () => (xhr.status === 200 ? resolve(JSON.parse(xhr.responseText).dir) : reject(new Error(JSON.parse(xhr.responseText || '{}').error || `refusé par le PC (${xhr.status})`)));
        xhr.onerror = () => reject(new Error('connexion au PC perdue'));
        xhr.send(f);
      });
      toast(`${f.name} envoyé sur le PC (dossier ${dir})`);
    } catch (err) {
      toast(`${f.name} non envoyé : ${err.message}`, true);
    }
  }
});

// ---------- Météo (ville choisie dans les Paramètres du PC) ----------
let weather = null;
function showWeather(w) {
  weather = w;
  $('weatherCard').hidden = !w;
  if (!w) { $('wxBox').hidden = true; return; }
  if (!$('wxBox').hidden) showWeatherDetails();
  $('wTemp').textContent = `${w.temp}°`;
  $('wCity').textContent = w.city;
  $('wText').textContent = w.text;
  $('wRange').textContent = `${w.min}° / ${w.max}°`;
}

// ---------- Prochains rendez-vous (lien d'agenda dans les Paramètres du PC) ----------
// « En cours », « Aujourd'hui 14:30 », « Demain 9:00 », « Lun. 16 18:00 » ; recalculé chaque minute
let agenda = null;
let asking = null; // question d'une action programmée en cours sur cet appareil
function showAgenda() {
  $('agendaCard').hidden = !agenda?.length;
  if (!agenda?.length) return;
  const now = Date.now(), day = (ms) => new Date(ms).setHours(0, 0, 0, 0), today = day(now);
  const when = (e) => {
    if (e.start <= now) return 'En cours';
    const d = Math.round((day(e.start) - today) / 86400000);
    const date = d === 0 ? "Aujourd'hui" : d === 1 ? 'Demain' : new Date(e.start).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
    return e.allDay ? date : `${date} ${new Date(e.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  };
  $('agendaList').replaceChildren(...agenda.map((e) => {
    const li = document.createElement('li'), b = document.createElement('b'), t = document.createElement('span');
    b.textContent = when(e).replace(/^./, (c) => c.toUpperCase());
    t.textContent = e.title;
    li.append(b, t);
    return li;
  }));
}
setInterval(showAgenda, 60000);

// Détail de la météo : toucher la carte (ressenti, humidité, vent, pluie, soleil, 12 h, 7 jours)
function showWeatherDetails() {
  const w = weather;
  if (!w?.hours) return; // ancien PC : pas de détail
  const cell = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  $('wxTemp').textContent = `${w.temp}°`;
  $('wxTitle').textContent = w.city;
  $('wxText').textContent = `${w.text} · ${w.min}° / ${w.max}°`;
  $('wxFacts').replaceChildren(...[['Ressenti', `${w.feels}°`], ['Humidité', `${w.humidity} %`], ['Vent', `${w.wind} km/h`],
    ['Pluie', w.rain == null ? '—' : `${w.rain} %`], ['Lever', w.sunrise], ['Coucher', w.sunset]]
    .map(([k, v]) => cell('div', '', `${esc(k)}<b>${esc(v)}</b>`)));
  $('wxHours').replaceChildren(...w.hours.map((h, i) => cell('div', '', `${i ? esc(h.h) + ' h' : 'Maint.'}<b>${h.temp}°</b>${esc(h.text)}` +
    (h.rain ? `<br><span class="rain">${h.rain} %</span>` : ''))));
  const day = (d, i) => (i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain' : new Date(d + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase()));
  $('wxDays').replaceChildren(...w.days.map((d, i) => cell('div', '', `<span>${esc(day(d.date, i))}</span><span>${esc(d.text)}</span>` +
    `<span class="rain">${d.rain ? d.rain + ' %' : ''}</span><span><b>${d.min}°</b> / <b>${d.max}°</b></span>`)));
}
const openWeather = () => { if (!weather?.hours) return; showWeatherDetails(); $('wxBox').hidden = false; };
$('weatherCard').addEventListener('click', openWeather);
$('weatherCard').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWeather(); } });
$('wxBox').addEventListener('click', (e) => { if (e.target === $('wxBox')) $('wxBox').hidden = true; }); // toucher à côté : fermer
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('wxBox').hidden = true; });

// Texte du presse-papiers du PC : dans la zone de texte, et copié sur l'appareil quand le navigateur le permet
async function showClip(text) {
  $('padText').value = text;
  try { await navigator.clipboard.writeText(text); toast(text ? 'Presse-papiers du PC copié ici' : 'Le presse-papiers du PC est vide'); }
  catch { toast(text ? 'Texte du PC affiché : appui long dessus pour le copier' : 'Le presse-papiers du PC est vide'); }
}

// Un curseur pour Windows et pour chaque programme qui joue du son ; relu toutes les 3 s pendant qu'il est ouvert.
let mixerTimer = null, mixerDrag = null;
function openMixer() {
  $('mixerBox').hidden = false;
  send({ type: 'mixer' });
  clearInterval(mixerTimer);
  mixerTimer = setInterval(() => send({ type: 'mixer' }), 3000);
}
function closeMixer() { $('mixerBox').hidden = true; clearInterval(mixerTimer); }
$('mixerBtn').addEventListener('click', openMixer);
// Se ferme en touchant en dehors de la fenêtre, ou avec Échap
$('mixerBox').addEventListener('click', (e) => { if (e.target === $('mixerBox')) closeMixer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('mixerBox').hidden) closeMixer(); });
// Une carte par source de son : icône, nom, pourcentage, bouton muet, grand curseur (se remplit comme la barre du lecteur)
const MIX_ICONS = {
  on: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
};
function showMixer(msg) {
  if ($('mixerBox').hidden) return;
  if (msg.error) { $('mixerList').textContent = msg.error; return; }
  const rows = [{ name: '', label: 'Windows', sub: 'Tout le son du PC', ...(msg.system || { volume: 0 }) }, ...(msg.apps || [])];
  const list = $('mixerList');
  list.querySelector(':scope > p')?.remove(); // « Chargement… »
  for (const r of rows) {
    let row = list.querySelector(`[data-name="${CSS.escape(r.name)}"]`);
    if (!row) {
      row = document.createElement('div');
      row.className = 'mixer-row' + (r.name ? '' : ' main'); row.dataset.name = r.name;
      row.innerHTML = '<button type="button" class="mx-mute" aria-label="Couper / remettre le son"></button><div class="mx-name"><b></b><small></small></div><span class="mx-pct"></span><input type="range" min="0" max="100" step="1">';
      const range = row.querySelector('input'), pct = row.querySelector('.mx-pct');
      let last = 0;
      range.addEventListener('input', () => {
        mixerDrag = r.name; fillPct(range);
        pct.textContent = range.value + ' %';
        if (Date.now() - last > 120) { last = Date.now(); send({ type: 'mixer-set', name: r.name, volume: Number(range.value) }); }
      });
      range.addEventListener('change', () => { send({ type: 'mixer-set', name: r.name, volume: Number(range.value) }); setTimeout(() => { mixerDrag = null; }, 600); });
      row.querySelector('.mx-mute').addEventListener('click', () => { buzz(); send({ type: 'mixer-mute', name: r.name }); setTimeout(() => send({ type: 'mixer' }), 300); });
      list.append(row);
    }
    row.querySelector('b').textContent = r.label;
    row.querySelector('small').textContent = r.sub || '';
    row.querySelector('small').hidden = !r.sub;
    row.classList.toggle('muted', !!r.muted);
    row.querySelector('.mx-mute').innerHTML = r.muted ? MIX_ICONS.off : MIX_ICONS.on;
    if (mixerDrag !== r.name) { // on ne bouge pas le curseur sous le doigt
      const range = row.querySelector('input');
      range.value = r.volume; fillPct(range);
      row.querySelector('.mx-pct').textContent = r.muted ? 'Muet' : r.volume + ' %';
    }
  }
  for (const row of [...list.children]) if (row.dataset && !rows.some((r) => r.name === row.dataset.name)) row.remove(); // appli fermée
}

// ---------- Morceau en cours ----------
// Le PC envoie la position à un instant donné ("at") ; la barre avance ici, sans trafic réseau.
let media = null, mediaShown = true;
const clock = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function showMedia(m, serverNow) {
  // L'horloge de la tablette n'est pas celle du PC : on ramène l'heure de la mesure à l'horloge de la tablette
  if (m && serverNow && !m.shifted) { m = { ...m, at: m.at + (Date.now() - serverNow), shifted: true }; }
  media = m;
  $('mediaCard').hidden = !m || !mediaShown;
  if (!m) return;
  $('mediaTitle').textContent = m.title;
  $('mediaArtist').textContent = m.artist;
  $('mediaApp').textContent = m.app;
  if (m.art !== undefined && $('mediaArt').getAttribute('src') !== m.art) $('mediaArt').setAttribute('src', m.art || '');
  $('mediaCard').classList.toggle('paused', !m.playing);
  updatePlayer(false);
  tickMedia();
}
function tickMedia() {
  if (!media || $('mediaCard').hidden) return;
  // shortcut: l'horloge de la tablette et celle du PC sont supposées à l'heure (écart = barre décalée d'autant)
  const pos = Math.min(media.duration || Infinity, media.position + (media.playing ? Math.max(0, Date.now() - media.at) / 1000 : 0));
  $('mediaPos').textContent = clock(pos);
  $('mediaDur').textContent = media.duration ? clock(media.duration) : '';
  $('mediaFill').style.width = media.duration ? `${(pos / media.duration) * 100}%` : '0';
}
function mediaPos() { return media ? Math.min(media.duration || Infinity, media.position + (media.playing ? Math.max(0, Date.now() - media.at) / 1000 : 0)) : 0; }

// ---------- Lecteur plein écran ----------
// Toucher la carte « morceau en cours » : grande pochette, précédent / lecture-pause / suivant, volume de l'appli
// de musique, et les paroles à droite (si l'option est cochée dans les Paramètres, Thème).
const PL_ICONS = {
  prev: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
};
const fillPct = (el) => el.style.setProperty('--pct', `${((el.value - el.min) / (el.max - el.min || 1)) * 100}%`);
let playerOpen = false, lyricsOn = false, playerFull = true, lyrics = null, lyricsKey = '', playerMixTimer = null, plVolDrag = false, lastLine = -2;
function openPlayer() {
  if (!media || !playerFull) return;
  $('plPrev').innerHTML = PL_ICONS.prev; $('plNext').innerHTML = PL_ICONS.next; $('plVolIcon').innerHTML = PL_ICONS.vol;
  playerOpen = true;
  $('player').hidden = false;
  updatePlayer(true);
  send({ type: 'mixer' });
  clearInterval(playerMixTimer);
  playerMixTimer = setInterval(() => { if (!plVolDrag) send({ type: 'mixer' }); }, 3000);
}
function closePlayer() { playerOpen = false; $('player').hidden = true; clearInterval(playerMixTimer); }
function updatePlayer(force) {
  if (!playerOpen) return;
  if (!media) { closePlayer(); return; }
  $('playerTitle').textContent = media.title;
  $('playerArtist').textContent = media.artist;
  $('playerApp').textContent = media.app;
  $('plToggle').innerHTML = media.playing ? PL_ICONS.pause : PL_ICONS.play;
  if (media.art !== undefined && $('playerArt').getAttribute('src') !== media.art) $('playerArt').setAttribute('src', media.art || '');
  $('playerLyrics').hidden = !lyricsOn;
  if (!lyricsOn) $('player').classList.add('no-lyrics'); // pas de paroles voulues : la pochette se centre
  const key = `${media.artist}|${media.title}`;
  if (lyricsOn && (force || key !== lyricsKey)) { // nouveau morceau : on redemande les paroles
    lyricsKey = key; lyrics = null; lastLine = -2;
    $('player').classList.remove('no-lyrics'); // le temps de la recherche, on garde la place des paroles
    $('playerLyrics').innerHTML = '<p class="none">Recherche des paroles…</p>';
    send({ type: 'lyrics', key });
  }
}
// Rotation de l'écran : la zone des paroles change de taille, on recentre la ligne en cours (une fois la mise en page terminée)
window.addEventListener('resize', () => { for (const ms of [80, 400]) setTimeout(() => { lastLine = -2; tickPlayer(); }, ms); });
function tickPlayer() {
  if (!playerOpen || !media) return;
  const pos = mediaPos();
  $('playerPos').textContent = clock(pos);
  $('playerDur').textContent = media.duration ? clock(media.duration) : '';
  $('playerFill').style.width = media.duration ? `${(pos / media.duration) * 100}%` : '0';
  if (lyrics?.synced) { // ligne en cours = la dernière dont l'heure est passée
    let i = -1;
    for (let k = 0; k < lyrics.synced.length && lyrics.synced[k].t <= pos + 0.3; k++) i = k;
    if (i !== lastLine) {
      lastLine = i;
      $('playerLyrics').style.scrollBehavior = 'smooth';
      const ps = $('playerLyrics').children;
      for (let k = 0; k < ps.length; k++) ps[k].classList.toggle('on', k === i);
      const el = ps[Math.max(i, 0)];
      if (el) $('playerLyrics').scrollTop = el.offsetTop - $('playerLyrics').clientHeight / 2 + el.clientHeight / 2;
    }
  }
}
setInterval(tickPlayer, 400);
function showLyrics(msg) {
  if (msg.key !== lyricsKey) return; // réponse d'un morceau déjà passé
  lyrics = msg;
  $('player').classList.toggle('no-lyrics', !(msg.synced || msg.plain)); // rien trouvé : pochette et commandes centrées sur l'écran
  const box = $('playerLyrics');
  box.replaceChildren();
  lastLine = -2;
  if (msg.synced) box.append(...msg.synced.map((l) => Object.assign(document.createElement('p'), { textContent: l.text || '♪' })));
  else if (msg.plain) box.append(...msg.plain.split(/\n+/).map((t) => Object.assign(document.createElement('p'), { textContent: t })));
  if (msg.plain) box.prepend(Object.assign(document.createElement('p'), { className: 'none', textContent: 'Paroles sans minutage : elles ne suivent pas la musique (tu peux les faire défiler).' }));
  else if (!msg.synced) box.append(Object.assign(document.createElement('p'), { className: 'none', textContent: msg.offline ? 'Paroles indisponibles (pas de connexion).' : 'Pas de paroles trouvées pour ce morceau.' }));
  tickPlayer();
}
// Icônes dessinées (SVG) dès le chargement : jamais le caractère ⏸ / ▶, que téléphones et tablettes affichent en emoji coloré
$('plPrev').innerHTML = PL_ICONS.prev; $('plNext').innerHTML = PL_ICONS.next; $('plVolIcon').innerHTML = PL_ICONS.vol; $('plToggle').innerHTML = PL_ICONS.play;
$('mediaCard').addEventListener('click', () => { buzz(8); openPlayer(); });
$('mediaCard').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayer(); } });
$('playerClose').addEventListener('click', closePlayer);
$('plPrev').addEventListener('click', () => { buzz(); send({ type: 'media-control', op: 'prev' }); });
$('plNext').addEventListener('click', () => { buzz(); send({ type: 'media-control', op: 'next' }); });
$('plToggle').addEventListener('click', () => { buzz(); send({ type: 'media-control', op: 'toggle' }); if (media) { media.position = mediaPos(); media.at = Date.now(); media.playing = !media.playing; updatePlayer(false); } }); // réaction immédiate ; le PC confirme ensuite
// Volume de l'appli de musique : la ligne du mélangeur qui porte son nom, sinon le volume de Windows
let plVolName = '';
function playerMixer(msg) {
  if (!playerOpen || plVolDrag) return;
  const row = (msg.apps || []).find((a) => a.label === media?.app);
  plVolName = row ? row.name : '';
  const r = row || msg.system;
  $('plVolLabel').textContent = row ? `Volume ${media.app}` : 'Volume Windows';
  if (r) { $('plVol').value = r.volume; fillPct($('plVol')); $('plVolPct').textContent = r.muted ? 'muet' : r.volume + ' %'; }
}
{
  let last = 0;
  const sendVol = () => send({ type: 'mixer-set', name: plVolName, volume: Number($('plVol').value) });
  $('plVol').addEventListener('input', () => { plVolDrag = true; fillPct($('plVol')); $('plVolPct').textContent = $('plVol').value + ' %'; if (Date.now() - last > 120) { last = Date.now(); sendVol(); } });
  $('plVol').addEventListener('change', () => { sendVol(); setTimeout(() => { plVolDrag = false; }, 600); });
}
setInterval(tickMedia, 1000);

// ---------- Simple ou double appui ----------
// Pour un bouton qui a une action de double appui, on attend 300 ms un éventuel 2e appui,
// puis on envoie UNE seule commande au PC : « single » ou « double » (jamais les deux).
// Les autres boutons partent tout de suite.
const DOUBLE_TAP_MS = 400; // 300 ms était trop court au doigt sur une tablette
let pendingTap = null; // { id, timer }

// « Tu es sûr ? » : boîte maison (le confirm() du navigateur n'existe pas toujours dans l'appli Android)
function askConfirm(b, title = 'Tu es sûr ?') {
  return new Promise((resolve) => {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = b.label;
    $('confirmBox').hidden = false;
    $('confirmNo').focus();
    const done = (ok) => { $('confirmBox').hidden = true; $('confirmYes').onclick = $('confirmNo').onclick = null; resolve(ok); };
    $('confirmYes').onclick = () => done(true);
    $('confirmNo').onclick = () => done(false);
  });
}
function pressButton(b) {
  if (b.goto !== null && b.goto !== undefined) { setPage(b.goto); return; } // bouton « dossier »
  if (b.confirm) { if ($('confirmBox').hidden) askConfirm(b).then((ok) => ok && runButton(b.id, 'single')); return; }
  pressNow(b);
}
function pressNow(b) {
  if (pendingTap && pendingTap.id === b.id) {
    clearTimeout(pendingTap.timer);
    pendingTap = null;
    runButton(b.id, 'double');
    return;
  }
  if (pendingTap) { // un autre bouton attendait : on l'envoie tout de suite en appui simple
    clearTimeout(pendingTap.timer);
    runButton(pendingTap.id, 'single');
    pendingTap = null;
  }
  if (!b.double) {
    runButton(b.id, 'single');
    return;
  }
  pendingTap = {
    id: b.id,
    timer: setTimeout(() => {
      pendingTap = null;
      runButton(b.id, 'single');
    }, DOUBLE_TAP_MS),
  };
}

// ---------- Pages de boutons ----------
// Chaque bouton a une page ('' = page principale). Onglets en haut, glisser le doigt pour changer,
// bouton « dossier » (goto) pour sauter à une page, et le PC peut en imposer une (profils automatiques).
let allButtons = [];
let page = '';
try { page = localStorage.getItem('pcdeck-page') || ''; } catch {}
const pageList = () => ['', ...new Set(allButtons.map((b) => b.page || '').filter(Boolean))];
function setPage(p) {
  if (!pageList().includes(p)) return;
  page = p;
  try { localStorage.setItem('pcdeck-page', p); } catch {}
  showButtons(allButtons);
}
{
  let start = null;
  const grid = $('buttons');
  grid.addEventListener('touchstart', (e) => { start = e.touches.length === 1 ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
  grid.addEventListener('touchend', (e) => {
    if (!start) return;
    const t = e.changedTouches[0], dx = t.clientX - start[0], dy = t.clientY - start[1];
    start = null;
    const list = pageList();
    if (list.length < 2 || Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
    e.preventDefault(); // un glissement n'appuie pas sur le bouton
    const i = list.indexOf(page) + (dx < 0 ? 1 : -1);
    setPage(list[(i + list.length) % list.length]);
  });
}

function showButtons(buttons) {
  allButtons = buttons;
  const pages = pageList();
  if (!pages.includes(page)) page = '';
  const bar = $('pageBar');
  bar.hidden = pages.length < 2;
  bar.replaceChildren(...pages.map((p) => {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'page-tab' + (p === page ? ' on' : '');
    t.textContent = p || 'Principal';
    t.addEventListener('click', () => { buzz(8); setPage(p); });
    return t;
  }));
  const grid = $('buttons');
  const big = buttons.find((b) => b.volume?.bigStep)?.volume.bigStep || 10; // valeur réglée dans les Paramètres
  $('bigStepLabel').textContent = `${big} en ${big}`;
  grid.replaceChildren(
    ...buttons.filter((b) => (b.page || '') === page).map((b) => {
      const el = document.createElement('button');
      el.className = 'deck-btn';
      el.dataset.id = b.id;
      const icon = document.createElement('span');
      icon.className = 'icon';
      const svg = iconSvg(b.icon);
      if (b.logo) { // vrai logo du programme ou du site (envoyé par le PC)
        const img = document.createElement('img');
        img.className = 'logo';
        img.alt = '';
        img.src = b.logo;
        icon.append(img);
        img.addEventListener('load', () => PcDeckColors.plate(img), { once: true }); // fond contrasté si besoin
      } else if (svg) icon.innerHTML = svg; // icône au trait (nom, ex. "mail")
      else icon.textContent = b.icon; // sinon : emoji ou texte
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = b.label;
      el.append(icon, label);
      if (b.volume) {
        const target = document.createElement('span');
        target.className = 'target';
        target.dataset.op = b.volume.op;
        target.dataset.step = b.volume.step;
        target.dataset.bigStep = b.volume.bigStep;
        updateTarget(target);
        el.append(target);
      }
      if (b.value || b.cycle) { // valeur (CPU, volume, heure…) ou état en cours, mis à jour chaque seconde
        const t = document.createElement('span');
        t.className = 'target';
        if (b.value) t.dataset.value = b.value; else t.dataset.cycle = JSON.stringify(b.cycle);
        el.append(t);
      }
      if (b.timer) {
        const t = document.createElement('span');
        t.className = 'target timer';
        t.dataset.timer = b.timer.seconds;
        el.append(t);
      }
      if (b.color) el.style.setProperty('--btn-color', b.color);
      // Appui long (0,6 s) : petit menu (renommer, déplacer, page, mettre de côté) ; l'appui ne part pas
      let holdTimer = null, held = false, start = null;
      el.addEventListener('pointerdown', (e) => {
        held = false; start = [e.clientX, e.clientY];
        if (!layoutLocked) holdTimer = setTimeout(() => { held = true; buzz(25); openEdit(b); }, 600);
      });
      el.addEventListener('pointermove', (e) => { if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 12) clearTimeout(holdTimer); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => clearTimeout(holdTimer));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.addEventListener('click', () => { if (held) { held = false; return; } buzz(); pressButton(b); });
      return el;
    })
  );
  tickTimers();
  showStates();
}

// ---------- État des boutons ----------
// Le PC envoie { id: true } pour les boutons « allumés » (micro coupé, son coupé, OBS qui enregistre…)
let states = {};
function showStates() {
  for (const el of document.querySelectorAll('.deck-btn')) el.classList.toggle('on', !!states[el.dataset.id]);
}

// ---------- Minuteurs / chronomètres ----------
// Le PC envoie { id: { start, end } } ; la tablette affiche le temps restant (ou écoulé) chaque seconde.
// shortcut: utilise l'horloge de la tablette (un écart d'heure avec le PC décale l'affichage d'autant)
let timers = {};
function tickTimers() {
  for (const t of document.querySelectorAll('.deck-btn .target.timer')) {
    const run = timers[t.closest('.deck-btn').dataset.id];
    const secs = Number(t.dataset.timer);
    t.closest('.deck-btn').classList.toggle('running', !!run);
    if (!run) t.textContent = secs ? clock(secs) : 'Chrono';
    else t.textContent = run.end ? `reste ${clock((run.end - Date.now()) / 1000 + 0.999)}` : clock((Date.now() - run.start) / 1000);
  }
}
setInterval(tickTimers, 1000);

// ---------- Appui long : modifier un bouton depuis la tablette ----------
let editing = null, editMode = 'rename'; // le champ du haut sert au nom du bouton, ou au nom d'une nouvelle page
function openEdit(b) {
  editing = b;
  resetEditName();
  $('editTitle').textContent = b.label;
  $('editName').value = b.label;
  const pages = pageList();
  if (!pages.includes(b.page || '')) pages.push(b.page || '');
  $('editPage').replaceChildren(...pages.map((p) => new Option('Page : ' + (p || 'Principal'), p)), new Option('Page : nouvelle page…', '\u0000new'));
  $('editPage').value = b.page || '';
  $('editBox').hidden = false;
}
function closeEdit() { $('editBox').hidden = true; editing = null; }
const editSend = (extra) => { if (editing) send({ type: 'edit-button', id: editing.id, ...extra }); };
$('editRename').addEventListener('click', () => {
  const v = $('editName').value.trim();
  if (editMode === 'page') { if (v) editSend({ op: 'page', page: v }); }
  else if (v && v !== editing?.label) editSend({ op: 'rename', label: v });
  closeEdit();
});
$('editName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('editRename').click(); });
$('editLeft').addEventListener('click', () => editSend({ op: 'move', dir: -1 }));
$('editRight').addEventListener('click', () => editSend({ op: 'move', dir: 1 }));
$('editPage').addEventListener('change', () => {
  let p = $('editPage').value;
  if (p === '\u0000new') {
    // Nouvelle page : on reprend le champ du nom, vidé, pour taper le nom de la page
    $('editName').value = ''; $('editName').placeholder = 'Nom de la nouvelle page, puis « Ranger »';
    $('editRename').textContent = 'Ranger sur cette page';
    editMode = 'page';
    $('editName').focus();
    return;
  }
  editSend({ op: 'page', page: p });
  closeEdit();
});
function resetEditName() { editMode = 'rename'; $('editRename').textContent = 'Renommer'; $('editName').placeholder = ''; }
$('editDraft').addEventListener('click', () => { editSend({ op: 'draft' }); closeEdit(); });
$('editClose').addEventListener('click', closeEdit);

// ---------- Vibration au toucher ----------
// Android (appli et navigateur) : navigator.vibrate. iPhone (Safari n'a pas de vibration) : cocher un
// interrupteur natif caché fait une petite vibration sur iOS 18 et plus. Réglable : Paramètres > Thème.
let vibrateOn = true;
let iosSwitch = null;
function buzz(pattern = 12) {
  if (!vibrateOn) return;
  try {
    if (navigator.vibrate) { navigator.vibrate(pattern); return; }
    if (/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
      if (!iosSwitch) {
        iosSwitch = document.createElement('label');
        iosSwitch.setAttribute('aria-hidden', 'true');
        iosSwitch.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
        iosSwitch.innerHTML = '<input type="checkbox" switch tabindex="-1">';
        document.body.append(iosSwitch);
      }
      iosSwitch.click();
      if (Array.isArray(pattern)) setTimeout(() => iosSwitch.click(), 90); // erreur : deux petites vibrations
    }
  } catch {}
}

// Retour visuel : le bouton tourne pendant que le PC travaille, puis affiche ✓ (réussi) ou ✗ (erreur)
const btnEl = (id) => document.querySelector(`.deck-btn[data-id="${CSS.escape(id)}"]`);
const busyTimers = {};
function runButton(id, press) {
  const b = allButtons.find((x) => x.id === id);
  if (!b?.timer) { // un minuteur répond par son affichage, pas par un résultat
    btnEl(id)?.classList.add('busy');
    clearTimeout(busyTimers[id]);
    busyTimers[id] = setTimeout(() => btnEl(id)?.classList.remove('busy'), 15000); // pas de réponse : on arrête de tourner
  }
  send({ type: 'run', id, press });
}
function flashButton(id, ok) {
  clearTimeout(busyTimers[id]);
  const el = btnEl(id);
  if (!el) return;
  el.classList.remove('busy', 'ok', 'error');
  void el.offsetWidth; // relance l'animation si on appuie deux fois de suite
  el.classList.add(ok ? 'ok' : 'error');
  el.dataset.mark = ok ? '✓' : '✗';
  setTimeout(() => el.classList.remove('ok', 'error'), 1200);
  if (!ok) buzz([30, 60, 30]);
}

// ---------- Connexion : Wi-Fi d'abord, câble USB en secours ----------
// Wi-Fi : l'adresse du PC sur le réseau (ex. 192.168.1.24:8787).
// USB   : "localhost:8787", qui mène au PC grâce au tunnel adb créé par le serveur.
const NETWORK_KEY = 'pcdeck-network';
const WIFI_PROBE_MS = 30000;
let ws = null;
let link = null; // { kind: 'wifi' | 'usb', host }
let retryDelay = 1000;
let failedRounds = 0;
let retryTimer = null; // prochain essai de connexion
let fastUntil = 0; // « Allumer le PC » : essais réguliers jusqu'à cette heure (le temps que le PC démarre)
let probeTimer = null;

function loadNetwork() {
  try { return JSON.parse(localStorage.getItem(NETWORK_KEY)) || null; } catch { return null; }
}
function saveNetwork(network) {
  try { localStorage.setItem(NETWORK_KEY, JSON.stringify(network)); } catch {}
}

const isLoopbackHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

// Liste des chemins à essayer, dans l'ordre
// Dans l'appli Android, l'interface vient d'une adresse interne : les chemins
// sont l'adresse Wi-Fi tapée dans l'appli + celles envoyées par le PC.
const NATIVE = window.PcDeckNative || null;

function endpoints() {
  const saved = loadNetwork();
  const port = saved?.port || (NATIVE ? 8787 : Number(location.port) || 80);
  const wifi = [];
  if (NATIVE) {
    const manual = String(NATIVE.wifiHost() || '');
    if (manual) wifi.push(manual.includes(':') ? manual : `${manual}:${port}`);
  } else if (!isLoopbackHost(location.hostname)) wifi.push(location.host);
  for (const ip of saved?.lan || []) {
    const host = `${ip}:${port}`;
    if (!wifi.includes(host)) wifi.push(host);
  }
  return [...wifi.map((host) => ({ kind: 'wifi', host })), { kind: 'usb', host: `localhost:${port}` }];
}

function setStatus(text, state) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + (state || '');
  // PC injoignable : l'appli Android peut l'allumer (Wake-on-LAN), avec les cartes réseau envoyées par le PC
  $('wakeBtn').hidden = !(state === 'offline' && NATIVE?.wake && loadNetwork()?.macs?.length);
}
$('wakeBtn').addEventListener('click', () => {
  const ok = NATIVE.wake(loadNetwork().macs.join(','));
  toast(ok ? 'Signal envoyé : le PC démarre (environ 30 s)' : "Impossible d'envoyer le signal (Wi-Fi coupé ?)", !ok);
  if (ok) { fastUntil = Date.now() + 3 * 60000; retryNow(); } // essais réguliers pendant 3 min, le temps que le PC démarre
});

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

// Ouvre une connexion ; renvoie null si elle échoue ou tarde trop.
function openSocket(host, timeoutMs) {
  return new Promise((resolve) => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    let sock;
    try {
      sock = new WebSocket(`${scheme}://${host}/ws`);
    } catch {
      resolve(null);
      return;
    }
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!value) sock.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock.onopen = () => finish(sock);
    sock.onerror = () => finish(null);
  });
}

async function connect() {
  retryTimer = null; // essai en cours
  setStatus('Connexion…');
  for (const ep of endpoints()) {
    const sock = await openSocket(ep.host, ep.kind === 'usb' ? 2000 : 3000);
    if (sock) {
      attach(sock, ep);
      return;
    }
  }
  // Après 4 essais ratés (PC éteint...) : un essai par minute seulement, pour économiser la batterie.
  // Revenir sur l'appli, toucher l'état ou « Allumer le PC » relance tout de suite des essais rapides.
  const slow = ++failedRounds >= 4 && Date.now() > fastUntil;
  if (failedRounds >= 2) showOffline(true);
  setStatus(slow ? 'PC injoignable — nouvel essai dans 1 min' : 'PC injoignable — nouvel essai…', 'offline');
  // Appli Android : le PC a peut-être changé d'adresse (nouvelle box...). On le recherche
  // sur le Wi-Fi une fois sur trois ; s'il n'y en a qu'un, on retient sa nouvelle adresse.
  if (NATIVE?.discover && failedRounds % 3 === 0) {
    try {
      const found = JSON.parse(NATIVE.discover());
      if (found.length === 1) NATIVE.rememberHost(found[0].host);
    } catch {}
  }
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, slow ? 60000 : retryDelay);
  retryDelay = Math.min(retryDelay * 2, 5000);
}
// Nouvel essai immédiat, puis de nouveau rapides (ex. le PC vient d'être allumé)
function retryNow() {
  if (ws) return;
  failedRounds = 0;
  retryDelay = 1000;
  if (!retryTimer) return; // essai déjà en cours : le suivant sera rapide
  clearTimeout(retryTimer);
  connect();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) retryNow(); });
$('status').addEventListener('click', retryNow);

// « Le PC ne répond pas » : ce qu'il faut vérifier, avec Réessayer et (appli Android) Allumer le PC
function showOffline(on) {
  $('offlineCard').hidden = !on;
  $('offlineWake').hidden = !(on && NATIVE?.wake && loadNetwork()?.macs?.length);
}
$('offlineRetry').addEventListener('click', () => { buzz(); retryNow(); });
$('offlineWake').addEventListener('click', () => $('wakeBtn').click());

function attach(sock, ep) {
  showOffline(false);
  ws = sock;
  link = ep;
  retryDelay = 1000;
  failedRounds = 0;
  sock.binaryType = 'arraybuffer'; // images de l'écran et son du PC
  sock.onmessage = onMessage;
  sock.onclose = () => {
    if (ws !== sock) return; // remplacée volontairement (retour au Wi-Fi)
    ws = null;
    link = null;
    stopWifiProbe();
    setStatus('Déconnecté — nouvel essai…', 'offline');
    setTimeout(connect, 500);
  };
  const token = loadToken();
  if (token) send({ type: 'auth', token });
  else showPairing();
  if (ep.kind === 'usb') startWifiProbe();
  else stopWifiProbe();
}

// En USB : toutes les 30 s, regarde si le Wi-Fi est revenu, et y retourne.
function startWifiProbe() {
  stopWifiProbe();
  probeTimer = setInterval(async () => {
    for (const ep of endpoints().filter((e) => e.kind === 'wifi')) {
      const sock = await openSocket(ep.host, 3000);
      if (!sock) continue;
      if (link?.kind !== 'usb') { sock.close(); return; }
      const old = ws;
      attach(sock, ep);
      old?.close();
      return;
    }
  }, WIFI_PROBE_MS);
}
function stopWifiProbe() {
  clearInterval(probeTimer);
  probeTimer = null;
}

function onMessage(event) {
  // Image de l'écran du PC (contrôle à distance) : arrive en binaire
  if (typeof event.data !== 'string') {
    if (new Uint8Array(event.data, 0, 1)[0] === 0x41) Remote.audio(event.data); // "A" : son du PC
    else Remote.frame(event.data);
    return;
  }
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case 'screen':
      Remote.started(msg);
      break;
    case 'remote':
      Remote.setAvailable(msg.remote);
      $('padBtn').hidden = !msg.remote?.control;
      pilotOn = !!msg.remote?.control;
      $('sendBtn').hidden = false;
      break;
    case 'display':
      applyDisplay(msg.display);
      break;
    case 'paired':
      saveToken(msg.token);
      $('pair').hidden = true;
      break;
    case 'pair-error':
      $('pairError').textContent = msg.error;
      break;
    case 'auth-error':
      // Un 1er refus peut venir d'un PC qui vient de redémarrer : on réessaie une fois avant d'oublier l'appareil
      if (authRetries < 3 && loadToken()) {
        authRetries++;
        setTimeout(() => { const t = loadToken(); if (t) send({ type: 'auth', token: t }); }, 1500);
        break;
      }
      authRetries = 0;
      saveToken(null);
      showPairing();
      break;
    case 'hello':
      authRetries = 0;
      $('pair').hidden = true;
      // Sur le PC lui-même, "localhost" n'est pas le câble USB mais l'accès direct
      setStatus(
        link?.kind !== 'usb' ? 'Connecté · Wi-Fi' : /Android/i.test(navigator.userAgent) ? 'Connecté · USB' : 'Connecté · ce PC',
        'online'
      );
      if (msg.network) {
        saveNetwork(msg.network);
        NATIVE?.setLan(JSON.stringify(msg.network));
      }
      audio = msg.audio;
      Remote.setAvailable(msg.remote);
      $('padBtn').hidden = !msg.remote?.control;
      pilotOn = !!msg.remote?.control;
      $('sendBtn').hidden = false;
      applyDisplay(msg.display);
      if (checkVersions(msg)) return;
      showButtons(msg.buttons);
      showToggles(msg.toggles || []);
      levels = msg.levels || { system: null, app: null };
      showAudio(msg.audio);
      showStats(msg.stats);
      showMedia(msg.media || null, msg.now);
      showWeather(msg.weather || null);
      agenda = msg.agenda || null;
      showAgenda();
      timers = msg.timers || {};
      tickTimers();
      maybeTips();
      if (typeof Tools !== 'undefined') { Tools.rememberPc(msg.pcName); Tools.setCycles(msg.cycles); }
      if (msg.pcUpdate && sessionStorage.getItem('pcdeck-upd') !== msg.pcUpdate) {
        try { sessionStorage.setItem('pcdeck-upd', msg.pcUpdate); } catch {}
        setTimeout(() => toast(`Nouvelle version ${msg.pcUpdate} de PC Deck : clique sur « Installer » dans les Paramètres du PC`), 2500);
      }
      states = msg.states || {};
      showStates();
      break;
    case 'states':
      states = msg.states || {};
      showStates();
      break;
    case 'media':
      showMedia(msg.media, msg.now);
      break;
    case 'ask': // action programmée qui demande confirmation (la 1re réponse, ici ou sur le PC, compte)
      if (!$('confirmBox').hidden) break;
      asking = msg.id;
      buzz(40);
      askConfirm({ label: msg.text }, 'Action programmée').then((yes) => { if (asking === msg.id) send({ type: 'ask-reply', id: msg.id, yes }); asking = null; });
      break;
    case 'ask-done': // déjà répondu ailleurs : la fenêtre se ferme
      if (asking === msg.id) { asking = null; $('confirmNo').onclick?.(); }
      break;
    case 'agenda':
      agenda = msg.agenda || null;
      showAgenda();
      break;
    case 'weather':
      showWeather(msg.weather);
      break;
    case 'clip':
      showClip(String(msg.text || ''));
      break;
    case 'lyrics':
      showLyrics(msg);
      break;
    case 'mixer':
      showMixer(msg);
      playerMixer(msg);
      break;
    case 'timers':
      timers = msg.timers || {};
      tickTimers();
      break;
    case 'buttons':
      showButtons(msg.buttons);
      break;
    case 'page': // profil automatique : l'appli au premier plan sur le PC a sa page
      setPage(msg.page);
      break;
    case 'stats':
      showStats(msg.stats);
      break;
    case 'audio':
      showAudio(msg.audio);
      break;
    case 'toggles':
      showToggles(msg.toggles);
      break;
    case 'result':
      flashButton(msg.id, msg.ok);
      if (!msg.ok) showError(msg.error, msg.id);
      else if (msg.volume) showVolumeHud(msg.volume);
      else if (msg.message) toast(msg.message);
      break;
    case 'levels':
      showLevels(msg.levels);
      break;
    default:
      if (typeof Tools !== 'undefined') Tools.onMessage(msg); // outils (fenêtres, fichiers, capture…)
  }
}

// ---------- Appairage ----------
// Code reçu par un QR code : "?pair=123456" (iPhone, navigateur) ou par l'appli Android
// (lien pcdeck://). On l'enlève tout de suite de l'adresse, pour qu'il ne reste pas dans
// l'icône de l'écran d'accueil.
let autoPairCode = null;
{
  const params = new URLSearchParams(location.search);
  if (/^\d{6}$/.test(params.get('pair') || '')) autoPairCode = params.get('pair');
  if (params.has('pair')) history.replaceState(null, '', location.pathname + location.hash);
  const fromApp = NATIVE?.takePairCode?.();
  if (/^\d{6}$/.test(fromApp || '')) autoPairCode = fromApp;
}

function showPairing() {
  setStatus('Non appairé', 'offline');
  $('pair').hidden = false;
  $('pairError').textContent = '';
  $('pairCode').value = '';
  if (autoPairCode) {
    $('pairCode').value = autoPairCode;
    autoPairCode = null; // une seule tentative automatique
    $('pairForm').requestSubmit();
    return;
  }
  $('pairCode').focus();
}

function deviceName() {
  const ua = navigator.userAgent;
  if (NATIVE) return 'Tablette Android (appli)';
  if (/iPad|Macintosh.*Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Téléphone Android' : 'Tablette Android';
  return 'Navigateur PC';
}

$('pairForm').addEventListener('submit', (e) => {
  e.preventDefault();
  $('pairError').textContent = '';
  send({ type: 'pair', code: $('pairCode').value.trim(), device: deviceName() });
});

// ---------- Application installable (PWA) ----------
// Le service worker garde une copie de l'interface. Il n'est autorisé que sur
// une adresse "sûre" : https, localhost (USB), ou une adresse autorisée dans Chrome.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker :', err));
}

// ---------- Plein écran ----------
// Mode « boutons seuls » : masque les infos (processeur, graphiques) ; retenu sur cet appareil
function setButtonsOnly(on) {
  document.documentElement.classList.toggle('buttons-only', on);
  $('onlyBtn').setAttribute('aria-pressed', String(on));
  $('onlyBtn').title = on ? 'Afficher aussi les infos' : 'Boutons seuls (masquer les infos)';
  try { localStorage.setItem('pcdeck-buttons-only', on ? '1' : '0'); } catch {}
}
try { setButtonsOnly(localStorage.getItem('pcdeck-buttons-only') === '1'); } catch {}
$('onlyBtn').addEventListener('click', () => { buzz(8); setButtonsOnly(!document.documentElement.classList.contains('buttons-only')); });

const fullscreenBtn = $('fullscreenBtn');
function updateFullscreenBtn() {
  const installedFullscreen = matchMedia('(display-mode: fullscreen)').matches && !document.fullscreenElement;
  fullscreenBtn.hidden = !document.documentElement.requestFullscreen || installedFullscreen || !!NATIVE;
}
fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
});
document.addEventListener('fullscreenchange', updateFullscreenBtn);
updateFullscreenBtn();

// ---------- Écran toujours allumé ----------
// Empêche la tablette de se mettre en veille tant que l'appli est affichée.
let wakeLock = null;
async function keepScreenOn() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    // refusé (économie d'énergie, adresse non sûre...) : on réessaiera au prochain toucher
  }
}
document.addEventListener('visibilitychange', keepScreenOn);
document.addEventListener('pointerdown', keepScreenOn);
keepScreenOn();

// ---------- Anti-marquage de l'écran ----------
// Toutes les 3 minutes, décale l'interface de 0 à 2 pixels, invisible à l'œil.
setInterval(() => {
  const dx = Math.round(Math.random() * 4 - 2);
  const dy = Math.round(Math.random() * 4 - 2);
  document.querySelector('.layout').style.transform = `translate(${dx}px, ${dy}px)`;
}, 3 * 60 * 1000);

connect();

// iPhone : Safari ignore parfois "user-scalable=no" ; on bloque le pincement de la page.
// (Les graphiques et l'écran du PC reçoivent toujours leurs gestes à 2 doigts.)
document.addEventListener('gesturestart', (e) => e.preventDefault());
