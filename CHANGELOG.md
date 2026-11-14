# Historique des versions

Les nouveautés de chaque version. Avant de publier, écris-les sous « Prochaine version » :
le script de publication les range sous le bon numéro, et elles s'affichent dans la
notification de mise à jour de tes proches.

## Prochaine version

## 0.4.5 — 2026-11-14
- Fond d’écran image ou vidéo : à choisir sur le PC (Paramètres → Affichage), pour toutes les tablettes ; chaque appareil peut le redimensionner, l’assombrir, mettre le sien ou n’en avoir aucun (Outils → Cet appareil).
- Avec un fond d’écran, les boutons, cartes et graphiques deviennent translucides.
- Nouveau graphique Disque (lecture / écriture du SSD et place utilisée).
- Le nom du processeur, de la carte graphique et de la mémoire est affiché à côté de chaque mesure.
- Mise à jour : si Windows bloque l’installeur, Paramètres explique pourquoi au lieu de ne rien dire.

## 0.4.4 — 2026-11-14
- PC Deck ne fait plus apparaître de fenêtre noire au démarrage (Windows 11 avec Windows Terminal).
- Boutons « Ouvrir un programme » : les jeux installés avec Steam et Epic Games sont proposés dans la liste.

## 0.4.3 — 2026-11-14
- Tablette et téléphone : Outils → Cet appareil affiche les données utilisées par PC Deck (aujourd'hui et 30 jours, écran du PC, fichiers et vidéos, le reste).
- Toutes les vidéos du PC se lisent sur la tablette (4K HEVC des drones et téléphones, MKV…) : le PC les convertit à la volée (ffmpeg, installé en 1 clic). PDF, musique, textes et documents s'ouvrent aussi dans l'appli.
- Tablette, menu « Outils » : fenêtres ouvertes du PC, lancer n'importe quel programme, fichiers du PC à télécharger, capture d'écran, historique du presse-papiers, dictée et commandes vocales, fond d'écran et son des touches, plusieurs PC.
- Choix de la sortie son (casque, enceintes…) dans le mélangeur et sur un bouton ; lecteur avec −10 s / +10 s et barre cliquable (YouTube, Netflix…).
- Nouveaux boutons : éteindre l'écran, mode d'alimentation, luminosité (portable), boutons à plusieurs états, valeur affichée sous le nom (température, volume, heure…), lumière qui montre son état (Home Assistant).
- Famille : temps d'écran par programme et limite par jour (le programme se ferme à la limite).
- Fermer un programme figé depuis le détail processeur / mémoire ; « Les plus utilisés » dans les Paramètres ; Pack Canapé.
- Plus simple pour débuter : nom sous les icônes de la tablette, écran « Le PC ne répond pas » qui dit quoi vérifier, erreurs qui restent affichées avec « Réessayer », astuces au premier lancement.
- Paramètres : mode simple (l'essentiel) et mode avancé, « Annuler » sur les 20 derniers changements, aide intégrée et diagnostic « Pourquoi ça ne marche pas ? ».
- Sauvegarde automatique des réglages chaque jour (7 jours) avec retour en arrière, et « Tout remettre à zéro ».
- Modèles prêts à l'emploi : Gaming, Musique, Bureautique, Montage vidéo.
- Tablette : veille avec grande horloge, disposition verrouillable (enfants, invités).
- Le code de connexion se renouvelle tout seul ; la fin d'un minuteur s'affiche en notification Windows.
- Écran du PC sur la tablette : bouton « Son » pour entendre le son du PC sur l'appareil qui regarde.
- Nouveaux interrupteurs sur la tablette : curseur qui glisse, petites animations, état affiché, micro coupé en rouge.
- Page Paramètres plus claire : menu à gauche, une section à la fois, moins de texte (détails dans les « ? »), thème clair ou sombre.
- Boutons qui s'allument en rouge quand le micro est coupé, le son coupé, ou quand OBS enregistre ou est en direct.
- Nouveaux boutons : couper / remettre le micro ; éteindre, redémarrer ou mettre le PC en veille (toujours avec « Tu es sûr ? ») ; lumières et requêtes web (Home Assistant, Philips Hue, webhooks).
- Appli Android : bouton « Allumer le PC » quand le PC est éteint ou en veille (Wake-on-LAN, à activer sur le PC).
- Actions programmées : un bouton lancé tout seul à une heure choisie (ex. éteindre le PC à 23 h) ; pour éteindre, redémarrer ou mettre en veille, le PC et la tablette demandent d'abord « Le lancer maintenant ? » (annulé sans réponse en 2 minutes).
- Pavé tactile sur la tablette : souris, clics, défilement à deux doigts, texte tapé sur le PC et presse-papiers partagé.
- Envoyer une photo ou un fichier du téléphone vers le PC, dans le dossier de ton choix (Paramètres → Avancé ; par défaut Téléchargements\PC Deck).
- Météo sur la tablette (ville à choisir dans les Paramètres) ; toucher la carte affiche le détail : heure par heure, 7 jours, vent, pluie, soleil.
- Prochains rendez-vous sur la tablette, depuis le lien iCal de ton agenda Google, Outlook ou iCloud.
- FPS du jeu en cours dans la tuile Carte graphique. Paramètres → Affichage → « Installer (1 clic) » installe et lance RivaTuner tout seul.
- Modèle Discord : micro et casque.
- Quand un bouton échoue, la tablette explique le problème et la solution (« Apple Music n'est pas installé : modifie le bouton ») au lieu d'un message technique.
- Morceau en cours : accents corrigés, carte plus grande, et lecteur plein écran (toucher la carte) avec pochette, précédent / pause / suivant, volume de l'appli de musique et paroles à droite (option, cherchées en ligne sur lrclib.net).
- Tablette : appui long sur un bouton pour le renommer, le déplacer, changer sa page ou le mettre de côté ; cercle de chargement puis ✓ ou ✗ ; vibration au toucher ; mode « boutons seuls » ; taille des boutons réglable.
- Fenêtre d'un bouton plus simple : les réglages avancés sont repliés sous « Plus d'options », un aperçu montre le bouton tel qu'il sera sur la tablette, et « Tester » lance l'action sur le PC sans l'enregistrer.
- Paramètres : plus besoin de cliquer sur « Enregistrer », chaque changement s'applique tout seul (avec « Annuler » pendant quelques secondes).
- Ajouter un bouton en 1 clic : PC Deck propose les programmes ouverts sur le PC et des sites courants.
- Assistant de bienvenue après l'installation : connecter la tablette, choisir ses boutons, choisir un thème.
- En tapant un nom de programme ou de site (Discord, YouTube…), PC Deck propose le bon chemin ou la bonne adresse.
- Pages de boutons : range tes boutons sur plusieurs pages (Jeux, Travail, Musique…). Sur la tablette, onglets en haut et glisser le doigt pour changer de page ; un bouton « dossier » ouvre une page.
- Pages automatiques : quand un programme passe au premier plan sur le PC (un jeu…), la tablette affiche sa page.
- Macros : un bouton peut enchaîner plusieurs actions (ouvrir des programmes, raccourcis, volume…) avec des pauses, réglables dans les Paramètres.
- Morceau en cours : pochette, titre, artiste et progression du morceau (Apple Music, Spotify…) sur la tablette.
- Mélangeur de volume : un curseur pour Windows et pour chaque appli qui joue du son.
- Minuteur et chronomètre sur un bouton, avec une alerte sur le PC à la fin.
- OBS Studio : boutons pour changer de scène, lancer ou arrêter l'enregistrement ou le direct, couper le micro.
- iPhone : deux icônes possibles sur l'écran d'accueil, « PC Deck Maison » (Wi-Fi de la maison, sans VPN) et « PC Deck Dehors » (Tailscale), chacune avec sa propre image.
- Logos : un logo qui se voit mal sur les touches (noir sur thème sombre, blanc sur thème clair) reçoit tout seul un petit fond contrasté. En thème sombre, les logos à carré blanc (Apple Music, iCloud…) perdent ce carré ; une note noire devient de la couleur du texte.
- Écran du PC sur la tablette : le bouton « Clavier » affiche aussi les touches spéciales (Échap, Tab, Win, Alt+Tab, Copier, Coller, Annuler, Tout, Suppr, flèches) ; l'écran choisi sur un PC à 2 écrans est retenu.
- Paramètres : le thème est à gauche de l'aperçu de la tablette, les infos affichées à droite.
- Installation : PC Deck se lance toujours à la fin de l'installeur (plus de case à cocher). Si la page Paramètres ne trouve pas PC Deck, elle explique quoi faire.
- Thème personnalisable : couleur du fond, des touches, du texte et des deux courbes réseau en plus de l'accent (Paramètres → Affichage), 6 thèmes prêts à l'emploi (Graphite, Papier, Minuit, Forêt, Violet, Rose). Les logos prennent la couleur des touches.
- Vrais logos : un bouton de site, de programme, de fichier ou d'onglet peut afficher le logo du programme ou du site à la place de l'icône (case « Utiliser le vrai logo », cochée pour un nouveau bouton). Le PC les récupère et les envoie à tous les appareils, qui les mettent à jour tout seuls. Trouvés en direct, même pour les applis du Store, les dossiers ou n'importe quelle appli installée (par son nom) ; on peut aussi choisir le logo d'une autre appli ou envoyer sa propre image.
- Écran du PC : sur un ordinateur, choix de la résolution (720p, 1080p, Max = la plus grande image que l'appareil peut afficher) ; sur téléphone et tablette, 1080p, qui passe tout seul en 720p en données mobiles ou si l'image consomme trop.
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
