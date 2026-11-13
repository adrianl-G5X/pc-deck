const assert = require('assert');
const { explain } = require('./errors');

const b = { label: 'Apple Music' };
const msg = (text) => explain(new Error(text), b).message;

assert.match(msg('programme introuvable : C:\\Program Files\\Foo\\bar.exe'), /bar est introuvable.*Modifie le bouton/);
assert.match(msg('appli du Store introuvable : X!App'), /Apple Music n'est pas installé.*Microsoft Store/);
assert.match(msg('fichier ou dossier introuvable : D:\\Films\\old'), /« old » est introuvable/);
assert.match(msg('impossible de lancer foo.exe (spawn foo.exe ENOENT)'), /foo ne se lance pas/);
assert.match(msg('discord n\'est pas ouvert'), /discord n'est pas ouvert.*Ouvre-le d'abord/);
assert.match(msg('Apple Music ne joue pas de son en ce moment (lance la lecture d\'abord)'), /ne joue pas de son.*Lance la lecture/);
assert.match(msg('extension non connectée'), /extension du navigateur/);
assert.match(msg('Windows ne répond pas'), /Redémarrer le serveur/);
assert.match(msg('Windows n\'a pas laissé passer opera au premier plan : réessaie'), /refusé de mettre opera devant/);
// Erreur inconnue : le message d'origine est gardé, avec le nom du bouton et où regarder
const other = explain(new Error('truc bizarre'), b);
assert.match(other.message, /^Apple Music : truc bizarre\. .*journal/);
assert.strictEqual(other.technical, 'truc bizarre');
console.log('Messages d\'erreur : OK');
