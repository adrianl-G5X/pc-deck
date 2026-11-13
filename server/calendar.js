// Prochains rendez-vous sur la tablette, lus dans le lien « iCal » secret d'un agenda
// (Google Agenda : Paramètres de l'agenda → Adresse secrète au format iCal ; Outlook : Publier un calendrier → ICS ;
// iCloud : Partager l'agenda → Calendrier public). Rien n'est envoyé : le PC lit seulement ce lien, toutes les 10 min.
// Résultat : [{ title, start, end, allDay }] (au plus 3, triés), ou null si aucun lien.

const DAY = 86400000;

// Lignes repliées (une ligne qui commence par un espace continue la précédente)
const unfold = (text) => String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);

// Décalage (ms) d'un fuseau horaire à un instant donné, ex. Europe/Paris en été : +2 h
function tzOffset(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}

// "20261112T143000Z", "20261112T143000" (+ TZID), "20261112" (journée entière) -> { ms, allDay }
function parseDate(value, tz) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m;
  if (m[4] === undefined) return { ms: new Date(+y, mo - 1, +d).getTime(), allDay: true };
  const wall = Date.UTC(+y, mo - 1, +d, +h, +mi, +s);
  if (z) return { ms: wall, allDay: false };
  try {
    if (tz) { const guess = wall - tzOffset(wall, tz); return { ms: wall - tzOffset(guess, tz), allDay: false }; }
  } catch {} // fuseau inconnu (noms Windows d'Outlook) : heure locale du PC
  return { ms: new Date(+y, mo - 1, +d, +h, +mi, +s).getTime(), allDay: false };
}

// "PT1H30M", "P1D" -> ms
function parseDuration(v) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || ''));
  return m ? (((+m[1] || 0) * 7 + (+m[2] || 0)) * 24 * 3600 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0)) * 1000 : 0;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Dates de début d'un événement répété, entre from et to (ms).
// shortcut: BYDAY n'est compris que pour les répétitions hebdomadaires (pas « 1er lundi du mois »), BYMONTHDAY/BYSETPOS ignorés
function occurrences(startMs, rrule, exdates, from, to) {
  const r = Object.fromEntries(rrule.split(';').map((x) => x.split('=')));
  const freq = r.FREQ, interval = Math.max(1, +r.INTERVAL || 1);
  const until = r.UNTIL ? parseDate(r.UNTIL)?.ms ?? Infinity : Infinity;
  const count = +r.COUNT || Infinity;
  const days = freq === 'WEEKLY' && r.BYDAY ? r.BYDAY.split(',').map((d) => WEEKDAYS.indexOf(d.slice(-2))).filter((d) => d >= 0) : null;
  const out = [];
  let n = 0;
  for (let i = 0; i < 5000 && n < count; i++) {
    const base = new Date(startMs);
    if (freq === 'DAILY') base.setDate(base.getDate() + i * interval);
    else if (freq === 'WEEKLY') base.setDate(base.getDate() + i * 7 * interval);
    else if (freq === 'MONTHLY') base.setMonth(base.getMonth() + i * interval);
    else if (freq === 'YEARLY') base.setFullYear(base.getFullYear() + i * interval);
    else break;
    // Semaine avec plusieurs jours (ex. lundi et jeudi) : chaque jour de cette semaine-là
    const week = days ? days.map((d) => { const x = new Date(base); x.setDate(x.getDate() + ((d - base.getDay() + 7) % 7)); return x; }).sort((a, b) => a - b) : [base];
    for (const day of week) {
      const ms = day.getTime();
      if (ms < startMs) continue;
      if (ms > until || n >= count || ms > to) return out;
      n++;
      if (ms >= from && !exdates.has(ms)) out.push(ms);
    }
  }
  return out;
}

// Texte iCal -> 3 prochains rendez-vous (en cours ou à venir dans les 14 jours)
function nextEvents(text, now = Date.now()) {
  const events = [];
  let ev = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { ev = { exdates: new Set() }; continue; }
    if (line === 'END:VEVENT') { if (ev) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    const value = line.slice(i + 1);
    const tz = params.find((p) => p.startsWith('TZID='))?.slice(5).replace(/^"|"$/g, '');
    if (name === 'SUMMARY') ev.title = value.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ');
    else if (name === 'DTSTART') ev.start = parseDate(value, tz);
    else if (name === 'DTEND') ev.end = parseDate(value, tz);
    else if (name === 'DURATION') ev.duration = parseDuration(value);
    else if (name === 'RRULE') ev.rrule = value;
    else if (name === 'EXDATE') for (const v of value.split(',')) { const d = parseDate(v, tz); if (d) ev.exdates.add(d.ms); }
    else if (name === 'RECURRENCE-ID') ev.override = true; // shortcut: un rendez-vous répété déplacé à la main garde sa date d'origine
    else if (name === 'STATUS' && value === 'CANCELLED') ev.cancelled = true;
  }
  const list = [];
  const to = now + 14 * DAY;
  for (const e of events) {
    if (!e.start || e.cancelled || e.override) continue;
    const length = e.end ? e.end.ms - e.start.ms : e.duration || (e.start.allDay ? DAY : 0);
    const starts = e.rrule ? occurrences(e.start.ms, e.rrule, e.exdates, now - length, to) : [e.start.ms];
    for (const s of starts) {
      if (s + Math.max(length, 1) > now && s <= to) list.push({ title: e.title || '(sans titre)', start: s, end: s + length, allDay: e.start.allDay });
    }
  }
  return list.sort((a, b) => a.start - b.start).slice(0, 3);
}

let url = '', timer = null, current = null, text = '';

async function refresh(onChange) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`le lien d'agenda répond ${r.status}${r.status === 404 ? ' (lien changé ou supprimé ?)' : ''}`);
    text = await r.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('ce lien ne donne pas un agenda au format iCal');
  } catch (err) {
    console.error(`Agenda : ${err.message}`);
    if (!text) return;
  }
  update(onChange);
}
function update(onChange) {
  const next = nextEvents(text);
  if (JSON.stringify(next) !== JSON.stringify(current)) { current = next; onChange(current); }
}

// Lien changé dans les Paramètres (vide = pas d'agenda). « webcal:// » = https://
function setCalendar(link, onChange) {
  link = String(link || '').trim().replace(/^webcal:\/\//i, 'https://');
  if (link === url) return;
  url = link; current = null; text = '';
  clearInterval(timer);
  onChange(null);
  if (!url) return;
  refresh(onChange);
  // Toutes les 10 min (chaque minute tant que le lien n'a jamais répondu, ex. réseau pas prêt au démarrage du PC) ;
  // entre deux, la liste est recalculée chaque minute (un rendez-vous passé disparaît)
  let tick = 0;
  timer = setInterval(() => { if (++tick % 10 === 0 || !text) refresh(onChange); else update(onChange); }, 60000);
}

module.exports = { setCalendar, getAgenda: () => current, nextEvents };
