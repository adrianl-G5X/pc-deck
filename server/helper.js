// Lance un des petits programmes Windows de PC Deck (clavier/son, écran, réseau, processus).
// Installé : le programme compilé helpers\pcdeck-<nom>.exe (rapide, sans PowerShell).
// Dossier de développement : le script server\<nom>.ps1, qui contient le même code.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { APP_DIR } = require('./paths');

function spawnHelper(name, parentPid) {
  const exe = path.join(APP_DIR, 'helpers', `pcdeck-${name}.exe`);
  if (fs.existsSync(exe)) return spawn(exe, parentPid ? [String(parentPid)] : [], { windowsHide: true });
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, `${name}.ps1`)];
  if (parentPid) args.push('-ParentPid', String(parentPid));
  return spawn('powershell.exe', args, { windowsHide: true });
}

module.exports = { spawnHelper };
