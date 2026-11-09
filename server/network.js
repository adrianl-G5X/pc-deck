// Qui a le droit de parler au PC : ce PC, le réseau local, et Tailscale.

function cleanIp(ip = '') {
  return ip.replace(/^::ffff:/, '');
}

function isLoopback(ip) {
  ip = cleanIp(ip);
  return ip === '::1' || ip.startsWith('127.');
}

function isLocalNetwork(ip) {
  ip = cleanIp(ip);
  if (isLoopback(ip)) return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  // Tailscale (réseau privé chiffré pour l'accès hors de chez soi) : 100.64.0.0/10
  const t = /^100\.(\d+)\./.exec(ip);
  if (t && +t[1] >= 64 && +t[1] <= 127) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(ip); // IPv6 privée (fc00::/7)
}

module.exports = { cleanIp, isLoopback, isLocalNetwork };
