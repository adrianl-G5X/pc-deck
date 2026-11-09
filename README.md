# PC Deck

Un « Stream Deck » maison : une tablette Android posée sur le bureau sert de
panneau de boutons pour le PC et affiche ses infos en temps réel.

- **À gauche** : des boutons configurables (ouvrir un site ou une appli, raccourcis
  clavier, volume, verrouillage, macros) et des interrupteurs (ex. micro Discord).
- **À droite** : processeur, carte graphique, RAM, consommation, et deux graphiques
  sur 2 minutes (consommation CPU/GPU, débit Wi-Fi).
- Mode sombre, plein écran, écran toujours allumé, installable comme une application.

```
Tablette (Chrome / appli PC Deck)  ⇄  Wi-Fi (WebSocket)  ⇄  Serveur Node.js sur le PC
                                                              ├─ LibreHardwareMonitor (températures, watts, réseau)
                                                              └─ Windows (touches, volume, lancement d'applis)
```

---

## 1. Ce qu'il faut installer sur le PC

| Logiciel | À quoi il sert | Où le trouver |
|---|---|---|
| **Node.js** (déjà installé) | fait tourner le serveur | https://nodejs.org |
| **LibreHardwareMonitor** | lit températures, consommation, débit Wi-Fi | https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases |

### Réglage de LibreHardwareMonitor
1. Décompresser le `.zip` dans un dossier fixe (ex. `C:\Outils\LibreHardwareMonitor`).
2. Clic droit sur `LibreHardwareMonitor.exe` → **Exécuter en tant qu'administrateur**
   (obligatoire pour la température du processeur).
3. **Options → Remote Web Server → Run** (port **8085**). Si un réglage d'adresse
   est proposé, choisir **127.0.0.1**.
4. Conseillé : dans **Options**, cocher *Start Minimized*, *Minimize To Tray* et
   *Run On Windows Startup*.

Sans LibreHardwareMonitor, l'appli marche quand même : CPU (%) et RAM s'affichent,
le reste indique « — ».

---

## 2. Première installation du projet

Ouvrir un terminal (PowerShell) **dans le dossier du projet**, puis :

```bash
npm.cmd install
```

(`npm.cmd` plutôt que `npm` : PowerShell bloque parfois `npm` tout court.)

### Ouvrir l'accès réseau (une seule fois)
Dans **Terminal (administrateur)** :

```bash
Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
```

```bash
New-NetFirewallRule -DisplayName "PC Deck" -Direction Inbound -Protocol TCP -LocalPort 8787 -Profile Private -RemoteAddress LocalSubnet -Action Allow
```

La première commande déclare le Wi-Fi de la maison comme réseau **privé** ;
la seconde ouvre le port 8787 **seulement** sur les réseaux privés et pour les
appareils du réseau local.

Conseillé : dans l'appli de la box, réserver l'adresse IP du PC (« réservation
d'adresse ») pour qu'elle ne change jamais.

---

## 3. Lancer le serveur

**Usage normal : double-clic sur `Lancer PC Deck.bat`.** PC Deck tourne alors
**en arrière-plan**, sans fenêtre : une icône apparaît dans la zone de notification
(à côté de l'horloge ; flèche ^ si elle est masquée). Il se lance aussi tout seul à
l'ouverture de la session Windows.

Clic droit sur l'icône :
- **Code d'appairage** (affiché en haut du menu)
- **Ouvrir PC Deck** (aussi : double-clic sur l'icône)
- **Voir le journal** (messages du serveur, fichier `%LOCALAPPDATA%\PC Deck\server.log`)
- **Redémarrer le serveur** (après une modification du code)
- **Quitter PC Deck**

Si le serveur s'arrête tout seul (plantage), l'icône le relance en quelques secondes.
Relancer `Lancer PC Deck.bat` remplace l'instance en cours (jamais deux à la fois).

**Pour dépanner** : `PC Deck - mode fenetre (debug).bat` arrête la version en
arrière-plan et lance le serveur dans une fenêtre où l'on voit les messages en direct
(équivalent de `npm.cmd start`). Le terminal affiche :

```
PC Deck démarré.
  Sur ce PC : http://localhost:8787
  Sur la tablette (Wi-Fi) : http://192.168.1.24:8787
  Code d'appairage : 123456
```

- Pour l'arrêter : `Ctrl+C` dans ce terminal.
- **Un seul serveur à la fois.** Après une modification du code (dossier `server/`),
  l'arrêter puis le relancer. Les modifications de `config.json` et du dossier
  `client/`, elles, sont prises en compte sans redémarrer (recharger la page pour `client/`).

---

## 4. Installer l'appli sur la tablette Android

### Méthode conseillée : la vraie appli Android (APK)

Le fichier `android\PC-Deck.apk` est une vraie application : icône dans la liste des
applis, plein écran, écran toujours allumé, passage Wi-Fi ⇄ USB automatique.
L'interface vient toujours du PC : un changement de design ne demande **pas** de
réinstaller l'appli.

1. Sur la tablette : **Paramètres → À propos → appuyer 7 fois sur « Numéro de build »**,
   puis **Options pour les développeurs → Débogage USB** (déjà fait si le mode USB marche).
2. Brancher la tablette en USB (accepter « Autoriser le débogage USB »).
3. Sur le PC, dans le dossier du projet :
   ```
   powershell -ExecutionPolicy Bypass -File android\build.ps1 -Install
   ```
4. Ouvrir **PC Deck** sur la tablette et taper le **code d'appairage** (une seule fois).
   Au premier lancement par USB, l'appli apprend toute seule l'adresse Wi-Fi du PC.
   Sans câble, l'écran « PC introuvable » permet de taper l'adresse (ex. `192.168.1.24`).

Fabriquer l'APK demande Java 17 et l'Android SDK (installés dans
`%LOCALAPPDATA%\Android\Sdk`). **Garder** `android\pcdeck.keystore` et
`android\keystore-motdepasse.txt` : sans eux, une mise à jour de l'appli oblige à la
désinstaller d'abord.

### Autre méthode : appli web installée depuis Chrome

1. **Autoriser l'adresse du PC dans Chrome** (nécessaire pour l'installation, le mode
   hors ligne et l'écran toujours allumé) :
   - aller sur `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
   - écrire `http://192.168.1.24:8787` (l'adresse affichée par le serveur)
   - mettre sur **Enabled** → **Relaunch**
2. Ouvrir `http://192.168.1.24:8787` et taper le **code d'appairage**.
3. Menu **⋮** → **Installer l'application**. Lancer ensuite **PC Deck** depuis son icône :
   plein écran, paysage.

L'appairage n'est demandé qu'une fois par appareil. Si le PC est éteint, l'appli
s'ouvre quand même et se reconnecte toute seule quand il revient.

---

## 4 bis. Mode USB de secours

Si le Wi-Fi tombe, la tablette passe toute seule par le **câble USB**, puis revient
au Wi-Fi dès qu'il remarche (vérification toutes les 30 s). Le statut en haut à
gauche indique **« Connecté · Wi-Fi »** ou **« Connecté · USB »**.

Comment ça marche : le serveur repère la tablette branchée et crée un tunnel
`adb reverse` ; sur la tablette, `localhost:8787` mène alors au PC.

### Installation (une seule fois)
1. **Sur le PC**, installer les outils Android (adb) :
   ```bash
   winget install Google.PlatformTools
   ```
   puis **redémarrer le serveur** (il trouve adb tout seul).
2. **Sur la tablette**, activer le débogage USB :
   - **Paramètres → À propos de la tablette → Informations sur le logiciel** →
     toucher **7 fois** « Numéro de version » (« Vous êtes développeur »).
   - **Paramètres → Options pour les développeurs** → activer **Débogage USB**.
3. Brancher la tablette au PC et accepter **« Autoriser le débogage USB »**
   (cocher « Toujours autoriser sur cet ordinateur »).

Le terminal du serveur affiche alors
`Tablette USB (…) : tunnel activé`. Le tunnel est recréé automatiquement si on
débranche puis rebranche le câble.

- Si Chrome demande l'autorisation d'**accéder aux appareils du réseau local / de
  cet appareil**, l'accepter (c'est le chemin USB).
- Pour désactiver ce mode : `"usb": { "enabled": false }` dans `config.json`.
- Si adb est installé ailleurs : indiquer son chemin dans `"usb": { "adbPath": "C:\\…\\adb.exe" }`.

---

## 4 ter. Écrans de détails et applis réseau

- **Tuile Processeur → « Détails ›»** : chaque cœur avec son usage, sa fréquence,
  sa fréquence effective, sa tension et sa puissance.
- **Tuile Carte graphique → « Détails ›»** : mémoire vidéo utilisée, fréquences,
  températures (cœur, point chaud, mémoire), tension, ventilateurs.
- **Bouton ⛶ sur chaque graphique** : affichage en plein écran (✕ ou Échap pour revenir).
- **Applis réseau** : à côté du graphique Wi-Fi, les applis qui utilisent le plus le
  réseau en ce moment (3 normalement, 8 en plein écran).

### Applis réseau : autorisation Windows (une seule fois)
Windows ne donne le trafic par appli qu'aux administrateurs et au groupe
**« Utilisateurs du journal de performances »**. Pour que le serveur y ait droit sans
tourner en administrateur, ajouter son compte à ce groupe, dans
**Terminal (administrateur)** :

```bash
Add-LocalGroupMember -SID "S-1-5-32-559" -Member "$env:USERDOMAIN\$env:USERNAME"
```

puis **se déconnecter de Windows et se reconnecter** (ou redémarrer), et relancer
le serveur. Sans ce réglage, tout le reste fonctionne ; la liste affiche seulement
« Droits Windows manquants ».

Le trafic interne au PC (127.0.0.1) n'est pas compté. Les débits affichés incluent
toutes les cartes réseau (Wi-Fi, Ethernet…).

---

## 4 quater. Extension du navigateur (onglets Gmail, iCloud…)

Windows ne voit pas les onglets d'un navigateur. La petite extension du dossier
[`extension/`](extension) permet aux boutons de type `tab` de retrouver un onglet
déjà ouvert (même caché derrière un autre) ou d'en ouvrir un nouveau. Elle se connecte
**uniquement** au serveur PC Deck de ce PC (`127.0.0.1:8787`) et ne fait rien d'autre.

### Installation dans Opera GX (une seule fois)
1. Dans la barre d'adresse : `opera://extensions`
2. En haut à droite, activer **Mode développeur**.
3. Cliquer **Charger l'extension non empaquetée** et choisir le dossier
   `extension` du projet.
4. Le terminal du serveur affiche **« Extension navigateur connectée (onglets) »**.

Fonctionne aussi dans Chrome et Edge (`chrome://extensions`, `edge://extensions`).
Sans l'extension, les boutons `tab` ouvrent simplement un nouvel onglet.

- `match` : modèle des adresses à retrouver, avec `*` comme joker
  (ex. `https://*.icloud.com/*` pour tous les sites iCloud). S'il est omis :
  le site de `url` (ex. `https://mail.google.com/*`).
- Si le port du serveur change, modifier aussi `SERVER` dans `extension/background.js`
  puis cliquer « Recharger » sur la page des extensions.

---

## 4 quinquies. Contrôle à distance et version Windows

### Voir et piloter l'écran du PC

Le bouton **écran** (en haut à gauche, à côté de l'état de connexion) affiche le PC en
direct, sur la tablette comme sur un autre PC.

- **Fluidité** (retenue sur chaque appareil) : **Éco 15**, **Normal 30** ou **Élevé 60**
  images/s. À 60 img/s, le PC utilise environ 2 cœurs et le Wi-Fi 5 à 8 Mo/s.
- L'écran est capturé par la carte graphique (Desktop Duplication). Quand rien ne
  bouge, rien n'est envoyé (« écran immobile »). Si cette capture est impossible,
  l'ancienne méthode, plus lente, prend le relais.

- **Souris** : comme d'habitude (clic gauche, droit, molette).
- **Doigt** : appui court = clic · glisser = cliquer-glisser · appui long = clic droit ·
  deux doigts = défiler. Le bouton **Clic droit** transforme le prochain appui en clic droit.
- **Clavier** : celui de l'ordinateur marche directement ; sur tablette, bouton **Clavier**.
- **Écran 1 / Écran 2** : choisir l'écran à afficher.

Réglage dans `config.json` :
```json
"remoteControl": { "enabled": true, "viewOnly": false }
```
`enabled: false` coupe complètement la fonction ; `viewOnly: true` permet de voir sans
piloter. Seuls les appareils appairés y ont accès, et seulement sur le réseau local.

### Installer PC Deck sur un autre PC Windows

1. Copier le dossier `windows` sur l'autre PC (clé USB…).
2. Double-cliquer **Installer PC Deck.bat**, taper l'adresse du PC principal
   (Entrée = `192.168.1.24`).
3. L'icône **PC Deck** apparaît sur le Bureau et dans le menu Démarrer. Au premier
   lancement, taper le **code d'appairage**.

L'appli s'ouvre dans sa propre fenêtre (Microsoft Edge en mode application, avec un
profil séparé). Pour la désinstaller : supprimer les raccourcis et le dossier
`%LOCALAPPDATA%\PC Deck`.

---

## 4 sexies. Utiliser PC Deck hors de chez soi (Tailscale)

PC Deck n'est jamais ouvert sur Internet. Pour y accéder ailleurs, on utilise
**Tailscale** : un réseau privé chiffré, gratuit, entre tes appareils.

1. Installer Tailscale sur le **PC fixe** (tailscale.com/download) et se connecter.
2. Installer l'appli Tailscale sur le **téléphone** / la tablette / le portable, avec le
   **même compte**.
3. Dans Tailscale sur le PC, noter l'adresse du PC (`100.x.y.z`).
4. Sur le téléphone, ouvrir `http://100.x.y.z:8787` (marche aussi à la maison) et
   l'ajouter à l'écran d'accueil ; taper le code d'appairage.

L'appli Android apprend toute seule l'adresse Tailscale (rien à faire).
Le serveur accepte les adresses Tailscale (`100.64.0.0/10`) en plus du réseau local.

---

## 4 septies. Installeur Windows (pour distribuer PC Deck)

`PCDeck-Setup-<version>.exe` installe tout en un seul fichier, **sans rien d'autre à installer** :

- le serveur et son icône près de l'horloge (clic droit : code d'appairage, ouvrir, journal,
  redémarrer, quitter) ;
- Node.js (fourni), LibreHardwareMonitor (températures, consommation ; son port 8085 est fermé au
  réseau par une règle du pare-feu) et son pilote signé PawnIO (installé seulement s'il manque) ;
- la règle du pare-feu (réseau de la maison uniquement : profil Privé, sous-réseau local, Tailscale) ;
- LibreHardwareMonitor lancé à chaque ouverture de session avec les droits nécessaires,
  par une tâche planifiée, donc sans demande à chaque fois ;
- le démarrage automatique (réglage `"autostart": true` dans `config.json`) ;
- l'APK Android (`tablet\PC-Deck.apk`), que le PC proposera à la tablette (étape suivante).

**Réseau de type « Public »** : Windows y bloque PC Deck (la tablette ne se connecte pas,
alors que `localhost` marche sur le PC). L'installeur le détecte et propose de passer le
réseau en « Privé ». Plus tard (nouveau Wi-Fi, nouvelle box), l'icône PC Deck prévient au
démarrage et son menu affiche « Réseau « Public » : autoriser la tablette... ».

Les réglages restent dans `%LOCALAPPDATA%\PC Deck` : une mise à jour ou une réinstallation
ne les efface pas. Le désinstalleur (Paramètres Windows → Applications) retire tout et
demande s'il faut aussi supprimer les réglages. Il laisse le pilote PawnIO, qui peut servir à
d'autres logiciels.

**Fabriquer l'installeur** (sur ton PC de développement) :
```bash
powershell -ExecutionPolicy Bypass -File installer\build.ps1
```
Il télécharge Node, LibreHardwareMonitor et PawnIO en vérifiant leur empreinte SHA-256,
reconstruit l'APK, puis crée `dist\PCDeck-Setup-<version>.exe` (+ son fichier `.sha256`).
Il faut Inno Setup 6 (`winget install JRSoftware.InnoSetup`). `-SkipApk` réutilise l'APK déjà
construit. Le numéro de version vient de `package.json`.

---

## 4 octies. Connecter un appareil (sans taper d'adresse)

Sur le PC : **clic droit sur l'icône PC Deck → « Connecter une tablette ou un téléphone »**
(la page s'ouvre toute seule au premier lancement, tant qu'aucun appareil n'est connecté).
La page `http://localhost:8787/connect` (ouvrable seulement sur ce PC) affiche :

- **Tablette Android** : un QR code pour **télécharger l'appli depuis le PC** (pas besoin
  d'envoyer l'APK), puis un QR code `pcdeck://` qui ouvre l'appli et la connecte. Sans QR
  code, l'appli **trouve le PC toute seule sur le Wi-Fi** (recherche UDP) et demande le code.
- **iPhone / iPad** : un QR code qui ouvre Safari et connecte tout seul, puis « Sur l'écran
  d'accueil ».
- **Autre ordinateur** : l'adresse à ouvrir et le code.

Le **code à 6 chiffres sert une seule fois et expire au bout de 5 minutes** (10 essais ratés
l'annulent). Pour un autre appareil : « Nouveau code ». Les appareils déjà connectés le restent.
Si le PC change d'adresse (nouvelle box), l'appli Android le retrouve d'elle-même.

---

## 4 nonies. Paramètres, mises à jour, publication

- **Paramètres** : clic droit sur l'icône PC Deck → « Paramètres… » (page `http://localhost:8787/settings`,
  ouvrable seulement sur ce PC). Boutons (nom, icône, couleur, action ; modèles prêts à
  l'emploi), interrupteurs, affichage (thème, accent, colonnes, infos, rythme), son d'une appli,
  appareils connectés (avec suppression), port, démarrage avec Windows, contrôle à distance,
  export / import. La configuration est vérifiée avant d'être écrite et s'applique tout de suite.
- **Mises à jour** : le PC vérifie GitHub Releases toutes les 12 h. Chaque version est signée
  (Ed25519, clé publique `server/update-key.pem`) : une version non signée par ta clé est
  ignorée. La tablette reçoit sa nouvelle appli depuis son PC.
- **Publier** : voir [GUIDE-PUBLICATION.md](GUIDE-PUBLICATION.md). **Installer chez un proche** :
  [GUIDE-UTILISATEUR.md](GUIDE-UTILISATEUR.md).
- **Tests** : `npm test` (filtre d'adresses, configuration, cartes graphiques, appairage, mises à jour).

---

## 5. Configurer les boutons : `config.json`

Tout se règle dans `config.json`, **sans toucher au code**. Depuis la version 0.2, ce fichier
vit dans **`%LOCALAPPDATA%\PC Deck\config.json`** (colle ça dans l'Explorateur), avec
l'appairage (`devices.json`, `pairing.json`), l'état (`state.json`) et les journaux.
Au premier lancement, il est créé à partir de `config.default.json` (boutons de base) ;
`templates.json` contient des boutons prêts à copier (Apple Music, Discord, Gmail, iCloud).
L'ancien `config.json` du dossier du programme est repris automatiquement, puis renommé
`config.json.migrated`.
À l'enregistrement, les boutons se mettent à jour sur la tablette. En cas d'erreur,
le terminal l'explique et garde l'ancienne configuration.

### Un bouton

```json
{
  "id": "gmail",
  "label": "Gmail",
  "icon": "✉️",
  "action": { "type": "open", "target": "https://mail.google.com" }
}
```

- `id` : nom unique, en minuscules, chiffres et tirets.
- `label` : texte affiché. `icon` : un emoji.
- Les boutons s'affichent dans l'ordre du fichier, 3 par ligne.

### Les types d'action

| `type` | Ce qu'il fait | Exemple |
|---|---|---|
| `open` | ouvre un lien (navigateur par défaut), un fichier ou un dossier | `{ "type": "open", "target": "https://youtube.com" }` |
| `app` | lance un programme (`path`) ou une appli du Microsoft Store (`appId`) | `{ "type": "app", "path": "C:\\Windows\\notepad.exe" }` |
| `keys` | appuie sur un raccourci clavier (`repeat` facultatif, 1 à 50) | `{ "type": "keys", "keys": "ctrl+shift+esc" }` |
| `volume` | volume + / − / couper (`op` : `up`, `down`, `mute`) | `{ "type": "volume", "op": "up", "step": 2, "bigStep": 10 }` |
| `window` | affiche en grand la fenêtre d'un programme déjà ouvert (même réduit dans la barre des tâches) ; sinon lance `ifNotRunning` | voir ci-dessous |
| `tab` | retrouve l'**onglet** d'un site déjà ouvert et le met au premier plan, sinon ouvre un onglet ; 2e appui dans les 5 s = nouvel onglet (nécessite l'extension, voir 4 quater) | `{ "type": "tab", "url": "https://mail.google.com", "match": "https://mail.google.com/*" }` |
| `lock` | verrouille le PC | `{ "type": "lock" }` |
| `macro` | enchaîne plusieurs actions, avec des pauses `wait` (en ms) | voir ci-dessous |

**Touches utilisables dans `keys`** : `ctrl`, `shift`, `alt`, `win`, `a`…`z`, `0`…`9`,
`f1`…`f24`, `enter`, `esc`, `tab`, `space`, `backspace`, `delete`, `insert`, `home`,
`end`, `pageup`, `pagedown`, `up`, `down`, `left`, `right`, `printscreen`,
`volumeup`, `volumedown`, `volumemute`, `mediaplaypause`, `medianext`, `mediaprev`, `mediastop`.

**Trouver l'`appId` d'une appli du Store** : dans PowerShell, `Get-StartApps` liste les
applis et leur `AppID` (ex. Apple Music : `AppleInc.AppleMusicWin_nzyj5cx40ttqa!App`).

**Action `window`** (ex. bouton Apple Music) :

```json
{
  "type": "window",
  "process": "AppleMusic",
  "screen": "secondary",
  "ifNotRunning": { "type": "app", "appId": "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App" }
}
```

- `process` : nom du programme sans `.exe` (voir le Gestionnaire des tâches → Détails).
- `screen` : `"same"` = en grand sur le dernier écran où la fenêtre était affichée ;
  `"secondary"` = en grand sur l'écran secondaire ; `"primary"` = sur l'écran principal.
- `ifNotRunning` : action lancée si aucune fenêtre ne correspond. Avec
  `"secondary"`/`"primary"`, la fenêtre est placée dès qu'elle apparaît.
- `title` (facultatif) : seule une fenêtre dont le **titre contient ce texte** compte
  (majuscules ignorées). Pour un site dans le navigateur, le titre est celui de
  l'**onglet actif** de chaque fenêtre : un onglet caché derrière un autre n'est pas vu.
- `secondClick` (facultatif) : action lancée si on **rappuie sur le bouton dans les
  5 secondes**.

Exemple (bouton Gmail) : 1er appui = réaffiche la fenêtre Gmail déjà ouverte (ou en
ouvre une s'il n'y en a pas) ; 2e appui rapide = ouvre une nouvelle fenêtre Gmail.

```json
{
  "type": "window",
  "process": "opera",
  "title": "Gmail",
  "screen": "same",
  "ifNotRunning": { "type": "open", "target": "https://mail.google.com", "newWindow": true },
  "secondClick": { "type": "open", "target": "https://mail.google.com", "newWindow": true }
}
```

Pour `open`, `"newWindow": true` ouvre le lien dans une **nouvelle fenêtre** du
navigateur par défaut (au lieu d'un nouvel onglet).

**Exemple de macro** (ouvrir le Bloc-notes puis écrire la date du jour avec F5) :

```json
{
  "id": "note-du-jour",
  "label": "Note du jour",
  "icon": "📝",
  "action": {
    "type": "macro",
    "steps": [
      { "type": "app", "path": "C:\\Windows\\notepad.exe" },
      { "type": "wait", "ms": 1000 },
      { "type": "keys", "keys": "f5" }
    ]
  }
}
```

### Les boutons de son

- `step` : pas normal en % (ici 2 : le volume tombe toujours sur un nombre pair).
- `bigStep` : pas quand la case **« Volume de 10 en 10 »** est cochée.
- La case **« Son sur Apple Music »** fait agir ces boutons sur une seule appli au lieu
  de Windows. L'appli est définie dans `audioApp` :

```json
"audioApp": { "label": "Apple Music", "processes": ["AppleMusic", "AMPLibraryAgent"] }
```

`processes` = noms des programmes **sans `.exe`**. Le volume d'une appli n'est
réglable qu'une fois qu'elle a joué du son depuis son ouverture.

### Les interrupteurs (`toggles`)

Un interrupteur lance la même action à chaque bascule et retient sa position :

```json
"toggles": [
  { "id": "discord-micro", "label": "Micro Discord", "style": "mic",
    "action": { "type": "keys", "keys": "ctrl+shift+alt+m" } }
]
```

- `style` : `"mic"` (micro / micro barré) ou `"switch"` (interrupteur simple).
- Pour Discord : **Paramètres utilisateur → Raccourcis clavier → Ajouter un raccourci →
  « Activer/désactiver la sourdine »**, avec le même raccourci que dans `config.json`.
- Si l'affichage ne correspond plus (micro coupé directement dans Discord) :
  **appui long (1 s)** sur l'interrupteur pour corriger l'affichage sans rien envoyer.

### Autres réglages

| Réglage | Rôle |
|---|---|
| `server.host` | `"0.0.0.0"` = accessible depuis le réseau local ; `"127.0.0.1"` = PC seulement |
| `server.port` | port du serveur (8787). S'il change : redémarrer, adapter la règle du pare-feu et le réglage Chrome |
| `usb.enabled` / `usb.adbPath` | mode USB de secours (voir 4 bis) |

Variables d'environnement facultatives (avant `npm.cmd start`, ex. `$env:NET_ADAPTER = "Ethernet"`) :
`NET_ADAPTER` (carte réseau du graphique, `Wi-Fi` par défaut), `OTHER_PARTS_W` (watts
estimés hors CPU/GPU, 50), `PSU_EFFICIENCY` (rendement de l'alimentation, 0.9),
`LHM_URL` (adresse de LibreHardwareMonitor).

---

## 6. Sécurité

- Le serveur n'accepte que les appareils du **réseau local** (adresses privées) et
  seulement les pages servies par lui-même : un autre site ouvert sur la tablette ne
  peut pas piloter le PC.
- **Appairage obligatoire** : sans le code à 6 chiffres, ni boutons, ni infos.
  5 mauvais codes → blocage de 5 minutes. L'appareil reçoit ensuite un jeton secret.
- La tablette envoie seulement **le nom d'un bouton** : l'action exécutée vient toujours
  de `config.json`. **Aucune commande arbitraire** ne peut être envoyée.
- Le dossier `data/` contient le code d'appairage, les appareils reconnus (jetons
  chiffrés) et l'état des cases. **Supprimer `data/`** = oublier toutes les tablettes
  et générer un nouveau code.

---

## 7. Dépannage

| Problème | Solution |
|---|---|
| « LibreHardwareMonitor injoignable » | Le lancer **en administrateur** et activer **Options → Remote Web Server → Run** |
| Température CPU « — » | LibreHardwareMonitor pas lancé en administrateur |
| La tablette n'ouvre pas la page | Même Wi-Fi que le PC ? Serveur lancé ? Wi-Fi en « Privé » ? Règle « PC Deck » présente ? L'adresse du PC a-t-elle changé ? |
| Pas de proposition d'installation | Vérifier le réglage `chrome://flags` (adresse exacte, avec `http://` et `:8787`) |
| Ancienne interface affichée | Un ancien serveur tourne encore : fermer tous les terminaux du serveur et relancer `npm.cmd start` |
| « … ne joue pas de son en ce moment » | Lancer la lecture dans l'appli, puis réessayer |
| Un raccourci n'agit pas sur une fenêtre | Windows bloque les touches simulées vers les fenêtres ouvertes **en administrateur** |
| « Code incorrect » / « Trop d'essais » | Le code est dans le terminal du serveur ; attendre 5 min après 5 erreurs |
| « Droits Windows manquants » (applis réseau) | Voir 4 ter : ajouter son compte au groupe, se déconnecter / reconnecter, relancer le serveur |
| « Mode USB : adb introuvable » | Installer adb (`winget install Google.PlatformTools`) puis redémarrer le serveur |
| Tablette branchée mais pas de « tunnel activé » | Débogage USB activé ? Autorisation acceptée sur la tablette ? Essayer un autre câble (certains ne font que la charge) |

---

## 8. Organisation des fichiers

```
config.default.json    configuration de départ (copiée dans %LOCALAPPDATA%\PC Deck au 1er lancement)
templates.json         boutons prêts à l'emploi (Apple Music, Discord, Gmail, iCloud)
server/
  server.js            serveur web + WebSocket, sécurité réseau
  stats.js             infos système (Node.js + LibreHardwareMonitor)
  actions.js           exécution des actions
  keys.js / keys.ps1   touches clavier et volume (Windows)
  auth.js              appairage
  usb.js               mode USB de secours (adb reverse)
  netmon.js / .ps1     trafic réseau par application (ETW)
  config.js            lecture et vérification de config.json
client/                interface de la tablette (PWA)
  index.html, style.css, app.js, chart.js
  manifest.webmanifest, sw.js, icons/
extension/             extension de navigateur (onglets) à charger dans Opera
tools/tray.ps1         PC Deck en arrière-plan + icône de notification
tools/launch-hidden.vbs  lance tray.ps1 sans aucune fenêtre
tools/make-icons.ps1   régénère les icônes
data/                  créé automatiquement (code, appareils, état)
```
