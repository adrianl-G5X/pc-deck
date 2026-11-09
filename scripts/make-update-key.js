// À lancer UNE SEULE FOIS : crée la paire de clés qui signe les mises à jour.
//   node scripts/make-update-key.js "C:\chemin\hors\du\projet\pcdeck-update-private.pem"
// - clé publique  -> server/update-key.pem (dans le projet, livrée avec PC Deck)
// - clé PRIVÉE    -> le fichier indiqué, HORS du projet. À garder secrète et sauvegardée :
//   elle sert à chaque publication (secret GitHub PCDECK_UPDATE_KEY). Perdue = plus aucune
//   mise à jour possible pour les PC déjà installés.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const out = process.argv[2];
if (!out) throw new Error('Indique où ranger la clé privée (hors du projet).');
const pub = path.join(__dirname, '..', 'server', 'update-key.pem');
if (fs.existsSync(pub) && !process.argv.includes('--remplacer')) {
  throw new Error('Une clé existe déjà (server/update-key.pem). La remplacer casserait les mises à jour des PC installés. Ajoute --remplacer si tu es sûr.');
}
if (path.resolve(out).startsWith(path.resolve(__dirname, '..'))) throw new Error('La clé privée ne doit pas être dans le dossier du projet.');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));
console.log(`Clé publique : ${pub}\nClé privée   : ${out}  (à sauvegarder, ne jamais publier)`);
