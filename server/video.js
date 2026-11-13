// Vidéos du PC sur la tablette, converties à la volée par ffmpeg (gratuit, installé en 1 clic avec winget) :
// 4K HEVC des drones / téléphones, MKV, AVI… -> H.264 1080p, lisible partout (appli, navigateur, iPhone)
// et plus léger sur le Wi-Fi (~8 Mbit/s). ffmpeg ne tourne que pendant qu'une vidéo est regardée.

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

// ffmpeg.exe : installé par winget (dossier Links ou Packages de l'utilisateur), ou déjà dans le PATH
let found = null;
function ffmpegPath() {
  if (found && fs.existsSync(found)) return found;
  const local = process.env.LOCALAPPDATA || '';
  const tries = [path.join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')];
  try {
    const pk = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    for (const d of fs.readdirSync(pk).filter((x) => /^Gyan\.FFmpeg/i.test(x))) {
      for (const sub of fs.readdirSync(path.join(pk, d))) tries.push(path.join(pk, d, sub, 'bin', 'ffmpeg.exe'));
    }
  } catch {}
  for (const dir of String(process.env.PATH || '').split(';')) if (dir) tries.push(path.join(dir, 'ffmpeg.exe'));
  found = tries.find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || null;
  return found;
}
const ffprobePath = () => ffmpegPath()?.replace(/ffmpeg\.exe$/i, 'ffprobe.exe');

// Installation (sans droits administrateur : winget l'installe pour l'utilisateur)
let installing = null;
function install() {
  if (ffmpegPath()) return Promise.resolve('ok');
  if (installing) return installing;
  installing = new Promise((resolve) => execFile('winget.exe', ['install', '--id', 'Gyan.FFmpeg', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'],
    { windowsHide: true, timeout: 10 * 60 * 1000 }, () => { found = null; installing = null; resolve(ffmpegPath() ? 'ok' : 'échec de l\'installation (winget)'); }));
  return installing;
}
const status = () => (installing ? 'installing' : ffmpegPath() ? 'on' : 'missing');

// Durée (secondes) et taille de l'image, pour la barre du lecteur
function probe(file) {
  return new Promise((resolve) => execFile(ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=duration:stream=width,height,codec_name', '-of', 'json', file],
    { windowsHide: true, timeout: 15000 }, (err, out) => {
      try { const j = JSON.parse(out); resolve({ duration: Number(j.format.duration) || 0, width: j.streams?.[0]?.width || 0, height: j.streams?.[0]?.height || 0, codec: j.streams?.[0]?.codec_name || '' }); }
      catch { resolve({ duration: 0, width: 0, height: 0, codec: '' }); }
    }));
}

// Carte graphique NVIDIA : conversion par la carte (rapide, presque rien sur le processeur) ; sinon le processeur
let nvenc = null;
function hasNvenc() {
  if (nvenc !== null) return Promise.resolve(nvenc);
  return new Promise((resolve) => execFile(ffmpegPath(), ['-hide_banner', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.1', '-c:v', 'h264_nvenc', '-f', 'null', '-'],
    { windowsHide: true, timeout: 15000 }, (err) => resolve((nvenc = !err))));
}

// Envoie la vidéo convertie à partir de « start » secondes (MP4 fragmenté, lu au fur et à mesure)
async function stream(file, start, req, res) {
  const gpu = await hasNvenc();
  const args = ['-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, start)), '-i', file,
    '-map', '0:v:0', '-map', '0:a:0?', '-vf', "scale=-2:'min(1080,ih)'",
    ...(gpu ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-b:v', '8M', '-maxrate', '10M', '-bufsize', '16M']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']),
    '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'];
  const ff = spawn(ffmpegPath(), args, { windowsHide: true });
  let err = '';
  ff.stderr.on('data', (d) => { err += d; });
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  ff.stdout.pipe(res);
  ff.on('exit', (code) => { if (code && err.trim()) console.error(`Vidéo (ffmpeg) : ${err.trim().split('\n').pop()}`); res.end(); });
  const stop = () => { try { ff.kill(); } catch {} };
  req.on('close', stop); // vidéo fermée ou autre moment demandé : ffmpeg s'arrête
}

module.exports = { ffmpegPath, install, status, probe, stream };
