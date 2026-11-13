// Messages d'erreur compréhensibles : ce qui s'est passé + quoi faire, au lieu du message technique.
// Utilisé quand un bouton échoue (tablette) ; le message technique reste dans le journal du PC.

const lastPart = (p) => String(p || '').split(/[\\/]/).pop().replace(/\.exe$/i, '');

// rules : [expression sur le message d'origine, (match, bouton) => texte]
const RULES = [
  [/^programme introuvable : (.+)$/, (m) => `${lastPart(m[1])} est introuvable (déplacé ou désinstallé ?). Modifie le bouton : choisis le programme dans la liste.`],
  [/^appli du Store introuvable/, (m, b) => `${b.label} n'est pas installé sur ce PC (appli du Microsoft Store). Installe-le, ou modifie le bouton.`],
  [/^fichier ou dossier introuvable : (.+)$/, (m) => `« ${lastPart(m[1]) || m[1]} » est introuvable (déplacé, renommé ou supprimé ?). Modifie le bouton pour choisir le bon emplacement.`],
  [/impossible de lancer (.+?) \(/, (m) => `${lastPart(m[1])} ne se lance pas (introuvable ou bloqué par Windows). Modifie le bouton, ou lance-le une fois à la main.`],
  [/^(.+) n'est pas ouvert$/, (m) => `${m[1]} n'est pas ouvert. Ouvre-le d'abord, ou modifie le bouton : « S'il n'est pas ouvert, ouvrir ».`],
  [/^(.+) ne joue pas de son en ce moment/, (m) => `${m[1]} ne joue pas de son. Lance la lecture, puis réessaie.`],
  [/n'a pas laissé passer (.+?) au premier plan/, (m) => `Windows a refusé de mettre ${m[1]} devant. Réessaie dans un instant.`],
  [/^extension non connectée|l'extension ne répond pas/, () => `L'extension du navigateur n'est pas connectée. Ouvre ton navigateur (extension PC Deck activée), puis réessaie.`],
  [/Windows ne répond pas|programme Windows arrêté/, () => `Windows ne répond pas. Réessaie ; si ça continue : icône PC Deck près de l'horloge → Redémarrer le serveur.`],
  [/^OBS n'est pas ouvert|serveur WebSocket est désactivé/, () => `OBS n'est pas ouvert, ou son serveur WebSocket est désactivé (OBS : Outils → Paramètres du serveur WebSocket).`],
  [/Mot de passe OBS|OBS demande un mot de passe/, () => `Le mot de passe OBS ne correspond pas : vérifie-le dans les Paramètres de PC Deck (Avancé).`],
  [/^Connexion à OBS perdue|^OBS ne répond pas/, () => `OBS ne répond pas. Vérifie qu'il est ouvert, puis réessaie.`],
];

// Renvoie { message, technical } : message = ce qu'affiche la tablette
function explain(err, button) {
  const technical = String(err?.message || err || 'erreur inconnue');
  for (const [re, make] of RULES) {
    const m = re.exec(technical);
    if (m) return { message: make(m, button || { label: 'Ce bouton' }), technical };
  }
  // Message déjà rédigé en français pour l'utilisateur (OBS, config...) : on le garde, avec le nom du bouton
  return { message: `${button?.label ? button.label + ' : ' : ''}${technical}. Si ça continue, regarde le journal (icône PC Deck → Voir le journal).`, technical };
}

module.exports = { explain };
