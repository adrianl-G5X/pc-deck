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
        <b>${format(a)}</b>
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

function showStats(s) {
  lastStats = s;
  $('cpuUsage').textContent = s.cpu.usage ?? '—';
  $('cpuTemp').textContent = num(s.cpu.temp, ' °C');
  $('cpuPower').textContent = watts(s.cpu.power);
  $('gpuUsage').textContent = s.gpu.usage ?? '—';
  $('gpuTemp').textContent = num(s.gpu.temp, ' °C');
  $('gpuPower').textContent = watts(s.gpu.power);
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
$('bigStep').addEventListener('change', (e) => {
  send({ type: 'set-volume-step', big: e.target.checked });
});

// ---------- Interrupteurs (ex. micro Discord) ----------
const ICONS = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="3" y1="3" x2="21" y2="21"/></svg>',
};

function showToggles(toggles) {
  $('toggles').replaceChildren(
    ...toggles.map((t) => {
      const mic = t.style === 'mic';
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'toggle' + (mic ? '' : ' plain') + (t.active ? ' active' : '');
      el.setAttribute('role', 'switch');
      el.setAttribute('aria-checked', String(t.active));
      el.innerHTML =
        '<span class="name"></span>' +
        (mic ? `<span class="side on" title="Micro actif">${ICONS.mic}</span>` : '') +
        '<span class="switch-track"><span class="switch-thumb"></span></span>' +
        (mic ? `<span class="side off" title="Micro coupé">${ICONS.micOff}</span>` : '') +
        '<span class="state"></span>';
      el.querySelector('.name').textContent = t.label;
      el.querySelector('.state').textContent = mic
        ? (t.active ? 'Muet' : 'Micro actif')
        : (t.active ? 'Activé' : 'Désactivé');

      // Appui court : bascule. Appui long (1 s) : corrige seulement l'affichage,
      // si tu as changé l'état directement dans l'application.
      let timer = null;
      let longPress = false;
      el.addEventListener('pointerdown', () => {
        longPress = false;
        timer = setTimeout(() => {
          longPress = true;
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

// ---------- Message temporaire ----------
let toastTimer = null;
function toast(text, isError) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 4000 : 1800);
}

// ---------- Boutons ----------
// ---------- Versions : interface, appli tablette et PC ----------
// L'interface vient du PC, donc elle est toujours à sa version. Deux cas restent :
// - copie de l'interface plus ancienne que le PC (appli Android hors ligne) : on recharge ;
// - appli Android (la « coquille ») plus ancienne que celle fournie par le PC : on propose
//   de l'installer, et on bloque si elle est trop ancienne pour fonctionner.
const CLIENT_PROTOCOL = 2; // le PC annonce un protocole plus grand : la page se recharge une fois pour prendre la nouvelle interface
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
  for (const [key, el] of Object.entries(parts)) if (el) el.hidden = show[key] === false;
  const row = document.querySelector('.chart-row');
  if (row) row.hidden = show.cpuChart === false && show.gpuChart === false;
}

// ---------- Simple ou double appui ----------
// Pour un bouton qui a une action de double appui, on attend 300 ms un éventuel 2e appui,
// puis on envoie UNE seule commande au PC : « single » ou « double » (jamais les deux).
// Les autres boutons partent tout de suite.
const DOUBLE_TAP_MS = 400; // 300 ms était trop court au doigt sur une tablette
let pendingTap = null; // { id, timer }

// « Tu es sûr ? » : boîte maison (le confirm() du navigateur n'existe pas toujours dans l'appli Android)
function askConfirm(b) {
  return new Promise((resolve) => {
    $('confirmTitle').textContent = 'Tu es sûr ?';
    $('confirmText').textContent = b.label;
    $('confirmBox').hidden = false;
    $('confirmNo').focus();
    const done = (ok) => { $('confirmBox').hidden = true; $('confirmYes').onclick = $('confirmNo').onclick = null; resolve(ok); };
    $('confirmYes').onclick = () => done(true);
    $('confirmNo').onclick = () => done(false);
  });
}
function pressButton(b) {
  if (b.confirm) { if ($('confirmBox').hidden) askConfirm(b).then((ok) => ok && send({ type: 'run', id: b.id, press: 'single' })); return; }
  pressNow(b);
}
function pressNow(b) {
  if (pendingTap && pendingTap.id === b.id) {
    clearTimeout(pendingTap.timer);
    pendingTap = null;
    send({ type: 'run', id: b.id, press: 'double' });
    return;
  }
  if (pendingTap) { // un autre bouton attendait : on l'envoie tout de suite en appui simple
    clearTimeout(pendingTap.timer);
    send({ type: 'run', id: pendingTap.id, press: 'single' });
    pendingTap = null;
  }
  if (!b.double) {
    send({ type: 'run', id: b.id, press: 'single' });
    return;
  }
  pendingTap = {
    id: b.id,
    timer: setTimeout(() => {
      pendingTap = null;
      send({ type: 'run', id: b.id, press: 'single' });
    }, DOUBLE_TAP_MS),
  };
}

function showButtons(buttons) {
  const grid = $('buttons');
  const big = buttons.find((b) => b.volume?.bigStep)?.volume.bigStep || 10; // valeur réglée dans les Paramètres
  $('bigStepLabel').textContent = `${big} en ${big}`;
  grid.replaceChildren(
    ...buttons.map((b) => {
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
      if (b.color) el.style.setProperty('--btn-color', b.color);
      el.addEventListener('click', () => pressButton(b));
      return el;
    })
  );
}

function flashButton(id, ok) {
  const el = document.querySelector(`.deck-btn[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.classList.remove('ok', 'error');
  el.classList.add(ok ? 'ok' : 'error');
  setTimeout(() => el.classList.remove('ok', 'error'), 800);
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
}

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
  setStatus('Connexion…');
  for (const ep of endpoints()) {
    const sock = await openSocket(ep.host, ep.kind === 'usb' ? 2000 : 3000);
    if (sock) {
      attach(sock, ep);
      return;
    }
  }
  setStatus('PC injoignable — nouvel essai…', 'offline');
  // Appli Android : le PC a peut-être changé d'adresse (nouvelle box...). On le recherche
  // sur le Wi-Fi une fois sur trois ; s'il n'y en a qu'un, on retient sa nouvelle adresse.
  if (NATIVE?.discover && ++failedRounds % 3 === 0) {
    try {
      const found = JSON.parse(NATIVE.discover());
      if (found.length === 1) NATIVE.rememberHost(found[0].host);
    } catch {}
  }
  setTimeout(connect, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 5000);
}

function attach(sock, ep) {
  ws = sock;
  link = ep;
  retryDelay = 1000;
  failedRounds = 0;
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
    Remote.frame(event.data);
    return;
  }
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case 'screen':
      Remote.started(msg);
      break;
    case 'remote':
      Remote.setAvailable(msg.remote);
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
      applyDisplay(msg.display);
      if (checkVersions(msg)) return;
      showButtons(msg.buttons);
      showToggles(msg.toggles || []);
      levels = msg.levels || { system: null, app: null };
      showAudio(msg.audio);
      showStats(msg.stats);
      break;
    case 'buttons':
      showButtons(msg.buttons);
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
      if (!msg.ok) toast(msg.error, true);
      else if (msg.volume) showVolumeHud(msg.volume);
      else if (msg.message) toast(msg.message);
      break;
    case 'levels':
      showLevels(msg.levels);
      break;
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
