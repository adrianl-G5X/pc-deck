// Morceau en cours (titre, artiste, pochette, progression) : lance media.ps1 et prévient
// la tablette seulement quand quelque chose change vraiment (la tablette fait avancer la barre elle-même).

const { spawnHelper } = require('./helper');

let media = null; // { title, artist, app, playing, position, duration, at, art } ou null
let child = null;
let onChange = null;

// Appli qui joue : nom lisible depuis son identifiant Windows (ex. "AppleInc.AppleMusicWin_..." -> "Apple Music")
function appName(id) {
  const known = [[/applemusic/i, 'Apple Music'], [/spotify/i, 'Spotify'], [/chrome/i, 'Chrome'], [/msedge/i, 'Edge'],
    [/firefox/i, 'Firefox'], [/opera/i, 'Opera'], [/zune|mediaplayer/i, 'Lecteur multimédia'], [/vlc/i, 'VLC'], [/deezer/i, 'Deezer']];
  const hit = known.find(([re]) => re.test(id || ''));
  return hit ? hit[1] : String(id || '').replace(/\.exe$/i, '').split(/[!_]/)[0].split('.').pop();
}

// La nouvelle mesure change-t-elle ce que montre la tablette ? (la position avance toute seule quand ça joue)
function differs(a, b) {
  if (!a || !b) return a !== b;
  if (['title', 'artist', 'app', 'playing', 'duration'].some((k) => a[k] !== b[k]) || b.art !== a.art) return true;
  const expected = a.position + (a.playing ? (b.at - a.at) / 1000 : 0);
  return Math.abs(expected - b.position) > 2; // avance rapide, retour en arrière
}

function start() {
  child = spawnHelper('media', process.pid);
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try {
        const m = JSON.parse(line);
        const next = m.title ? {
          title: m.title, artist: m.artist || '', app: appName(m.app), playing: !!m.playing,
          position: Number(m.position) || 0, duration: Number(m.duration) || 0, at: Number(m.at) || Date.now(),
          art: m.art !== undefined ? m.art : media?.art || '',
        } : null;
        const changed = differs(media, next);
        media = next;
        if (changed) onChange?.(media);
      } catch {}
    }
  });
  child.stderr.resume(); // messages d'erreur ignorés (sinon le tuyau se remplit)
  child.on('exit', () => {
    child = null;
    if (media) { media = null; onChange?.(null); }
    setTimeout(start, 30000);
  });
}

function startMedia(fn) {
  onChange = fn;
  start();
  process.on('exit', () => child?.kill());
}

const getMedia = () => media;

// Aller à un moment du morceau / de la vidéo (secondes) : YouTube, Netflix, Spotify… via les commandes média de Windows
function seek(seconds) {
  const ps = "Add-Type -AssemblyName System.Runtime.WindowsRuntime; " +
    "$at = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1; " +
    "function A($op, [type]$t) { $k = $at.MakeGenericMethod($t).Invoke($null, @($op)); [void]$k.Wait(3000); $k.Result }; " +
    "$M = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]; " +
    "$s = (A ($M::RequestAsync()) $M).GetCurrentSession(); if ($s) { A ($s.TryChangePlaybackPositionAsync([long]$env:PCDECK_POS)) ([bool]) }";
  return new Promise((resolve) => require('child_process').execFile('powershell.exe', ['-NoProfile', '-Command', ps],
    { windowsHide: true, timeout: 10000, env: { ...process.env, PCDECK_POS: String(Math.max(0, Math.round(seconds * 1e7))) } }, () => resolve()));
}

module.exports = { startMedia, getMedia, appName, differs, seek };
