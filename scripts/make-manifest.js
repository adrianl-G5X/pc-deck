// Prépare les fichiers d'une version (appelé par la publication automatique) :
//   dist/update.json      version, empreintes SHA-256 de l'installeur et de l'APK, notes
//   dist/update.json.sig  signature Ed25519 de update.json (clé privée du développeur)
//   dist/notes.md         notes de version (tirées de CHANGELOG.md)
// Clé privée : variable PCDECK_UPDATE_KEY (contenu PEM) ou PCDECK_UPDATE_KEY_FILE (chemin).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const dist = path.join(root, 'dist');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Notes : la partie "## <version>" de CHANGELOG.md
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const m = new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(changelog);
if (!m) throw new Error(`CHANGELOG.md n'a pas de partie "## ${version}"`);
const notes = m[1].trim();

const setupName = `PCDeck-Setup-${version}.exe`;
const setupFile = path.join(dist, setupName);
const apkFile = path.join(root, 'android', 'PC-Deck.apk');
for (const f of [setupFile, apkFile]) if (!fs.existsSync(f)) throw new Error(`Fichier manquant : ${f}`);
const [maj, min, pat] = version.split('-')[0].split('.').map(Number);

const manifest = {
  version,
  date: new Date().toISOString().slice(0, 10),
  setup: { name: setupName, sha256: sha256(setupFile) },
  apk: { name: 'PC-Deck.apk', sha256: sha256(apkFile), versionCode: (maj * 10000 + min * 100 + pat) * 100 },
  notes,
};
const data = Buffer.from(JSON.stringify(manifest, null, 2));

const pem = process.env.PCDECK_UPDATE_KEY || (process.env.PCDECK_UPDATE_KEY_FILE && fs.readFileSync(process.env.PCDECK_UPDATE_KEY_FILE, 'utf8'));
if (!pem) throw new Error('Clé privée absente : PCDECK_UPDATE_KEY ou PCDECK_UPDATE_KEY_FILE');
const signature = crypto.sign(null, data, crypto.createPrivateKey(pem)).toString('base64');

// Vérification avec la clé publique livrée dans PC Deck (évite de publier une version que les PC refuseraient)
const pub = crypto.createPublicKey(fs.readFileSync(path.join(root, 'server', 'update-key.pem')));
if (!crypto.verify(null, data, pub, Buffer.from(signature, 'base64'))) {
  throw new Error('La clé privée ne correspond pas à server/update-key.pem');
}

fs.writeFileSync(path.join(dist, 'update.json'), data);
fs.writeFileSync(path.join(dist, 'update.json.sig'), signature);
fs.writeFileSync(path.join(dist, 'notes.md'), notes + '\n');
console.log(`update.json signé pour la version ${version}`);
