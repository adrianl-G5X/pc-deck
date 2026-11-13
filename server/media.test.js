const assert = require('assert');
const { differs, appName } = require('./media');

const a = { title: 't', artist: '', app: 'x', playing: true, position: 10, duration: 100, at: 0, art: '' };
assert.strictEqual(differs(a, { ...a, position: 13, at: 3000 }), false); // lecture normale : rien à envoyer
assert.strictEqual(differs(a, { ...a, position: 40, at: 3000 }), true); // avance rapide
assert.strictEqual(differs(a, { ...a, playing: false }), true); // pause
assert.strictEqual(differs(a, null), true); // plus rien ne joue
assert.strictEqual(appName('AppleInc.AppleMusicWin_nzyj5cx40ttqa!App'), 'Apple Music');
assert.strictEqual(appName('Spotify.exe'), 'Spotify');
assert.strictEqual(require('./weather').describe(0), 'Ensoleillé'); // météo : code -> mots
assert.strictEqual(require('./weather').describe(95), 'Orage');
assert.strictEqual(require('./weather').describe(0, 0), 'Dégagé'); // nuit claire
// Détail météo : les 12 heures partent de l'heure en cours
{
  const hours = Array.from({ length: 48 }, (_, i) => `2026-11-13T${String(i % 24).padStart(2, '0')}:00`).map((t, i) => (i < 24 ? t : t.replace('13T', '14T')));
  const n = hours.length;
  const w = require('./weather').shape('Lille', {
    current: { time: '2026-11-13T16:15', temperature_2m: 7.4, apparent_temperature: 4, relative_humidity_2m: 70, wind_speed_10m: 8, weather_code: 0 },
    hourly: { time: hours, temperature_2m: Array(n).fill(5), weather_code: Array(n).fill(61), precipitation_probability: Array(n).fill(30) },
    daily: { time: ['2026-11-13'], temperature_2m_max: [9], temperature_2m_min: [2], weather_code: [3], precipitation_probability_max: [40],
      sunrise: ['2026-11-13T07:59'], sunset: ['2026-11-13T17:04'] },
  });
  assert.strictEqual(w.temp, 7);
  assert.deepStrictEqual(w.hours.map((x) => x.h).slice(0, 3), ['16', '17', '18']);
  assert.strictEqual(w.hours.length, 12);
  assert.strictEqual(w.sunset, '17:04');
}
console.log('Morceau en cours, météo : OK');
