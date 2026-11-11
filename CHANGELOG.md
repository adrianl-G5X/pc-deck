# Historique des versions

Les nouveautés de chaque version. Avant de publier, écris-les sous « Prochaine version » :
le script de publication les range sous le bon numéro, et elles s'affichent dans la
notification de mise à jour de tes proches.

## Prochaine version
- Installation : PC Deck se lance toujours à la fin de l'installeur (plus de case à cocher). Si la page Paramètres ne trouve pas PC Deck, elle explique quoi faire.
- Thème personnalisable : couleur du fond, des touches, du texte et des deux courbes réseau en plus de l'accent (Paramètres → Affichage), 6 thèmes prêts à l'emploi (Graphite, Papier, Minuit, Forêt, Violet, Rose). Les logos prennent la couleur des touches.
- Vrais logos : un bouton de site, de programme, de fichier ou d'onglet peut afficher le logo du programme ou du site à la place de l'icône (case « Utiliser le vrai logo », cochée pour un nouveau bouton). Le PC les récupère et les envoie à tous les appareils, qui les mettent à jour tout seuls. Trouvés en direct, même pour les applis du Store, les dossiers ou n'importe quelle appli installée (par son nom) ; on peut aussi choisir le logo d'une autre appli ou envoyer sa propre image.
- Écran du PC sur la tablette : choix de la résolution (720p, 1080p, Max = la plus grande image que l'appareil peut afficher).
- Réseau : le graphique suit tout seul la connexion utilisée (câble Ethernet ou Wi-Fi) et affiche « Câble (Ethernet) » ou « Wi-Fi » ; il bascule si tu branches ou débranches le câble.
- Extension du navigateur : elle fonctionne aussi dans Firefox (à faire signer par Mozilla, voir DEVELOPPEUR.md).
- Paramètres : une case « activé » à côté de chaque interrupteur, de chaque appli de son et du « Volume par grands pas ». Décochée, l'élément disparaît de la tablette mais garde tous ses réglages.
- Le bouton Verrouiller demande « Tu es sûr ? » sur la tablette avant de verrouiller le PC. Chaque bouton peut avoir cette confirmation (case dans la fenêtre de modification).
- Paramètres : un « brouillon » à côté de l'aperçu de la tablette. On y met de côté des boutons (ils disparaissent de la tablette mais gardent tous leurs réglages) et on les remet quand on veut, par glisser-déposer ou avec ⇢ / ⇠.
- Premier démarrage : 11 boutons de base dès l'installation (navigateur, verrouiller, gestionnaire des tâches, bureau, capture d'écran, volume, son on/off, précédent, lecture/pause, suivant). Déjà installé ? Paramètres → « Ajouter un modèle » → « Boutons de base (tous) » ajoute ceux qui manquent.
- Paramètres : la liste des boutons devient un aperçu de la tablette (même touches, thème et nombre de colonnes en direct) ; glisser-déposer pour réordonner, clic pour modifier, ✕ pour supprimer, Alt + flèches au clavier.
- Appairage plus solide : fichier des appareils écrit en deux temps avec copie de secours ; la tablette réessaie 3 fois avant d'oublier l'appareil.
- Moins de saisies du code : un refus d'identification juste après un redémarrage du PC est réessayé avant d'oublier l'appareil ; le navigateur est prié de garder le laissez-passer ; iPhone : le QR utilise l'adresse Tailscale (un seul code, à la maison comme dehors).
- Son : plusieurs applis possibles (Apple Music, Spotify, Discord…). Sur la tablette, l'interrupteur « Son sur… » passe de Windows à chaque appli, puis revient à Windows.
- Paramètres : la section « Son » regroupe les applis et le volume par grands pas.
- Paramètres : la valeur du « Volume de 10 en 10 » se règle (1 à 50 %), dans la section Interrupteurs ; la tablette affiche la valeur choisie.

## 0.4.2 — 2026-11-09
- Un programme déjà ouvert (navigateur, appli, dossier) revient au premier plan au lieu de s'ouvrir une deuxième fois ; réduit, il est restauré.
- Double appui sur un bouton de navigateur : nouvel onglet dans la fenêtre déjà ouverte.
- Double appui sur un bouton de dossier : nouvel onglet de l'Explorateur sur ce dossier.
- Paramètres : pour chaque bouton, choix de l'appui simple et du double appui.
- Nouveau bouton : le type se règle tout seul d'après ce que tu colles (site, programme .exe, dossier) ou le nom (« Monter le son », « Verrouiller »…), avec l'icône qui va avec.
- Accès hors de chez soi : l'installeur propose d'installer Tailscale tout seul (programme officiel, signature vérifiée) et ouvre sa page de connexion. Menu de l'icône : « Accès hors de chez toi ». La page « Connecter un appareil » a un onglet « Hors de chez toi » (QR codes de Tailscale et de connexion).
- Double appui plus facile sur la tablette (400 ms) ; un bouton « Accueil » de l'Explorateur revient devant au lieu d'ouvrir une nouvelle fenêtre.
- Programme : choix de l'écran (là où il était, écran principal ou 2e écran, en grand).
- Un site web s'ouvre dans un onglet du navigateur déjà ouvert, qui revient au premier plan.
- Températures : si LibreHardwareMonitor ne tourne pas, PC Deck le relance tout seul ; sinon le menu de l'icône propose « Températures : réparer… ».
- Mise à jour de la tablette : le PC annonce le vrai numéro de l'appli qu'il fournit.

## 0.4.1 — 2026-11-09
- Première version publiée automatiquement (test des mises à jour) : aucune nouveauté pour l'instant.

## 0.4.0 — 2026-11-09
- Fenêtre « Paramètres » sur le PC : créer, modifier, réordonner et supprimer les boutons (nom, icône, couleur, action), interrupteurs, modèles prêts à l'emploi.
- Affichage réglable : thème clair ou sombre, couleur d'accent, nombre de colonnes, infos affichées, rythme de rafraîchissement.
- Liste des appareils connectés, avec suppression.
- Export et import de la configuration (l'import montre tout ce qu'elle pourra lancer avant d'accepter).
- Mises à jour automatiques du PC (vérifiées et signées) et de l'appli tablette (fournie par le PC).
- Programmes compilés disponibles en option (pour une future version signée numériquement).

## 0.3.0 — 2026-11-08
- Appairage sans taper d'adresse : QR codes, code à usage unique valable 5 minutes.
- L'appli Android trouve le PC toute seule sur le Wi-Fi.
- L'APK se télécharge directement depuis le PC.

## 0.2.0 — 2026-11-08
- Installeur Windows : tout en un seul fichier, démarrage avec Windows, pare-feu, désinstalleur.
- Réglages rangés dans %LOCALAPPDATA%\PC Deck (gardés lors des mises à jour).
