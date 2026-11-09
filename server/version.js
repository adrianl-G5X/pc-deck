// Numéro de version (une seule source : package.json) et numéro de "protocole".
// Le protocole change seulement quand le PC et la tablette ne se comprennent plus :
// la tablette et le PC s'affichent alors un message clair au lieu de planter.
const { version } = require('../package.json');

module.exports = { VERSION: version, PROTOCOL: 1 };
