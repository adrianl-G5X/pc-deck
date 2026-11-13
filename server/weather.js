// Météo sur la tablette, seulement si une ville est indiquée dans les Paramètres (Affichage → Météo).
// Source : open-meteo.com (gratuit, sans compte). Le nom de la ville est envoyé à ce site, rien d'autre.
// Relue toutes les 30 minutes. Résultat : { city, temp, min, max, text, feels, humidity, wind, rain, sunrise, sunset,
// hours: [{ h, temp, text, rain }] (12 prochaines heures), days: [{ date, min, max, text, rain }] (7 jours) } ou null.

const TEXT = [ // codes météo de l'OMS -> mots
  [0, 'Ensoleillé'], [2, 'Éclaircies'], [3, 'Couvert'], [48, 'Brouillard'], [57, 'Bruine'], [67, 'Pluie'],
  [77, 'Neige'], [82, 'Averses'], [86, 'Averses de neige'], [99, 'Orage'],
];
// La nuit, un ciel clair est « Dégagé » (pas « Ensoleillé »)
const describe = (code, day = 1) => (code <= 1 && !day ? 'Dégagé' : (TEXT.find(([max]) => code <= max) || TEXT[TEXT.length - 1])[1]);

const get = (url) => fetch(url, { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`code ${r.status}`))));

let city = '', place = null, timer = null, current = null;

async function refresh(onChange) {
  try {
    if (!place) {
      const g = await get(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=fr&name=${encodeURIComponent(city)}`);
      if (!g.results?.length) throw new Error(`ville « ${city} » introuvable`);
      place = g.results[0];
    }
    const w = await get(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day' +
      '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
      '&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset&forecast_days=7&timezone=auto');
    current = shape(place.name, w);
  } catch (err) {
    console.error(`Météo : ${err.message}`);
    if (!current) return; // jamais réussi : rien à afficher
  }
  onChange(current);
}

// Réponse d'open-meteo -> ce qu'affiche la tablette (heures locales de la ville)
function shape(name, w) {
  const c = w.current, h = w.hourly, d = w.daily;
  const now = h.time.findIndex((t) => t.slice(0, 13) === c.time.slice(0, 13)); // heure en cours
  const hours = [];
  for (let i = Math.max(0, now); i < h.time.length && hours.length < 12; i++) {
    hours.push({ h: h.time[i].slice(11, 13), temp: Math.round(h.temperature_2m[i]), text: describe(h.weather_code[i], h.is_day?.[i] ?? 1), rain: h.precipitation_probability[i] ?? null });
  }
  return {
    city: name, temp: Math.round(c.temperature_2m), text: describe(c.weather_code, c.is_day ?? 1),
    min: Math.round(d.temperature_2m_min[0]), max: Math.round(d.temperature_2m_max[0]),
    feels: Math.round(c.apparent_temperature), humidity: Math.round(c.relative_humidity_2m), wind: Math.round(c.wind_speed_10m),
    rain: d.precipitation_probability_max[0] ?? null, sunrise: d.sunrise[0].slice(11, 16), sunset: d.sunset[0].slice(11, 16),
    hours,
    days: d.time.map((date, i) => ({ date, min: Math.round(d.temperature_2m_min[i]), max: Math.round(d.temperature_2m_max[i]),
      text: describe(d.weather_code[i]), rain: d.precipitation_probability_max[i] ?? null })),
  };
}

// Ville changée dans les Paramètres (vide = météo désactivée)
function setCity(name, onChange) {
  name = String(name || '').trim();
  if (name === city) return;
  city = name; place = null; current = null;
  clearInterval(timer);
  onChange(null);
  if (!city) return;
  refresh(onChange);
  timer = setInterval(() => refresh(onChange), 30 * 60 * 1000);
}

module.exports = { setCity, getWeather: () => current, describe, shape };
