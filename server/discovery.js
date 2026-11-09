// Découverte automatique : l'appli Android envoie "PCDECK?" à tout le réseau local (UDP),
// le PC répond avec son nom et son port. Plus besoin de taper une adresse IP.
// On ne répond qu'aux appareils du réseau local (et Tailscale), jamais à Internet.

const dgram = require('dgram');
const os = require('os');
const { isLocalNetwork } = require('./network');

function startDiscovery(port, version, protocol) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('message', (msg, rinfo) => {
    if (msg.toString('utf8') !== 'PCDECK?' || !isLocalNetwork(rinfo.address)) return;
    const reply = JSON.stringify({ app: 'pcdeck', name: os.hostname(), port, version, protocol });
    sock.send(reply, rinfo.port, rinfo.address);
  });
  sock.on('error', (err) => console.error(`  Découverte automatique indisponible : ${err.message}`));
  sock.bind(port, () => console.log(`  Découverte automatique : prête (UDP ${port})`));
  return sock;
}

module.exports = { startDiscovery };
