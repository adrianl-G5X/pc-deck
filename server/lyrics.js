// Paroles du morceau en cours, cherchées sur LRCLIB (lrclib.net, gratuit, sans compte), seulement si l'option
// « Paroles » est cochée dans les Paramètres : le titre et l'artiste sont alors envoyés à ce site.
// Résultat : { synced: [{ t, text }] } (paroles minutées) ou { plain: "..." } ou { none: true }.

const cache = new Map(); // "artiste|titre" -> résultat (gardé tant que PC Deck tourne)
const BASE = 'https://lrclib.net/api';

// Apple Music donne « Artiste — Album » : on garde l'artiste
const mainArtist = (a) => String(a || '').split(/\s[—–-]\s/)[0].trim();

function parseLrc(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/.exec(raw.trim());
    if (m) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
  }
  return lines.sort((a, b) => a.t - b.t);
}

async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'PC-Deck (https://github.com/adrianl-G5X/pc-deck)' } });
  return r.ok ? r.json() : null;
}

async function getLyrics({ title, artist, duration }) {
  const art = mainArtist(artist);
  const key = `${art}|${title}`.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  let result = { none: true };
  try {
    const q = new URLSearchParams({ track_name: title, artist_name: art });
    if (duration) q.set('duration', String(Math.round(duration)));
    let hit = await get(`${BASE}/get?${q}`);
    let synced = hit?.syncedLyrics ? parseLrc(hit.syncedLyrics) : [];
    if (!synced.length) { // pas de minutage pour cette version : une autre version du même morceau peut en avoir
      const list = (await get(`${BASE}/search?${new URLSearchParams({ track_name: title, artist_name: art })}`)) || [];
      const alt = list.find((x) => x.syncedLyrics && (!duration || Math.abs(x.duration - duration) < 6));
      if (alt) synced = parseLrc(alt.syncedLyrics);
      if (!hit) hit = list[0];
    }
    if (synced.length) result = { synced };
    else if (hit?.plainLyrics) result = { plain: String(hit.plainLyrics) }; // texte seul : défilement approximatif sur la tablette
  } catch { return { none: true, offline: true }; } // pas de réseau : on ne retient pas l'échec
  cache.set(key, result);
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return result;
}

module.exports = { getLyrics, parseLrc, mainArtist };
