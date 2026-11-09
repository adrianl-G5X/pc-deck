# Historique des versions

Les nouveautés de chaque version. Avant de publier, écris-les sous « Prochaine version » :
le script de publication les range sous le bon numéro, et elles s'affichent dans la
notification de mise à jour de tes proches.

## Prochaine version
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
