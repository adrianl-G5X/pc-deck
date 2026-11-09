# Publier PC Deck — guide du développeur

Ce guide explique comment mettre PC Deck en ligne la première fois, puis comment publier
chaque mise à jour en une commande. Les PC et tablettes de tes proches la proposeront ensuite
tout seuls.

---

## 1. Mise en place (une seule fois)

### 1.1 Les 3 secrets à garder précieusement

| Secret | Où il est | À quoi il sert |
|---|---|---|
| Clé de signature Android | `android\pcdeck.keystore` + `android\keystore-motdepasse.txt` | Signer l'APK. **Perdue = les tablettes ne peuvent plus être mises à jour** (il faut désinstaller/réinstaller). |
| Clé privée des mises à jour | `Documents\PC Deck - CLES SECRETES\pcdeck-update-private.pem` | Signer chaque version. **Perdue = plus aucune mise à jour automatique** pour les PC déjà installés. **Volée = quelqu'un pourrait envoyer une fausse mise à jour.** |
| Accès à ton compte GitHub | — | Active la validation en deux étapes (2FA). |

👉 Copie ces fichiers sur une clé USB (ou dans un gestionnaire de mots de passe) et range-la.
Ils ne sont **jamais** envoyés sur GitHub (le fichier `.gitignore` les exclut).

### 1.2 Créer le dépôt GitHub

1. Crée un compte sur github.com (si besoin) et active la **validation en deux étapes**.
2. Crée un dépôt, par exemple `pc-deck`. **Public** = mises à jour gratuites et sans réglage.
   (Privé possible, mais alors les PC ne peuvent pas télécharger les versions : il faudrait
   un 2e dépôt public juste pour les versions.)
3. Dans `package.json`, renseigne ton dépôt :
   ```json
   "pcdeck": { "updateRepo": "TON-COMPTE/pc-deck" }
   ```
4. Dans PowerShell, dans le dossier du projet :
   ```bash
   git config --global user.name "Ton nom"
   ```
   ```bash
   git config --global user.email "ton-adresse@exemple.com"
   ```
   ```bash
   git add -A
   ```
   ```bash
   git commit -m "PC Deck 0.4.0"
   ```
   ```bash
   git branch -M main
   ```
   ```bash
   git remote add origin https://github.com/TON-COMPTE/pc-deck.git
   ```
   ```bash
   git push -u origin main
   ```

### 1.3 Donner les secrets à GitHub

Sur GitHub : ton dépôt → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**. Crée ces 3 secrets (la commande copie la valeur dans le
presse-papiers, il suffit de la coller) :

| Nom du secret | Commande PowerShell (dans le dossier du projet) |
|---|---|
| `PCDECK_KEYSTORE_BASE64` | `[Convert]::ToBase64String([IO.File]::ReadAllBytes("android\pcdeck.keystore")) \| Set-Clipboard` |
| `PCDECK_KEYSTORE_PASSWORD` | `Get-Content android\keystore-motdepasse.txt -Raw \| Set-Clipboard` |
| `PCDECK_UPDATE_KEY` | `Get-Content "$HOME\Documents\PC Deck - CLES SECRETES\pcdeck-update-private.pem" -Raw \| Set-Clipboard` |

Vide le presse-papiers ensuite (copie n'importe quel autre texte).

---

## 2. Publier une mise à jour (à chaque fois)

1. **Fais tes modifications** et vérifie-les (lance `npm test`, essaie sur ton PC et ta tablette).
2. **Écris les nouveautés** dans `CHANGELOG.md`, sous `## Prochaine version`, une ligne par
   nouveauté, en mots simples (tes proches les verront) :
   ```markdown
   ## Prochaine version
   - Nouveau bouton « Capture d'écran ».
   - Correction : le volume ne remontait pas sur certains PC.
   ```
3. **Enregistre** : `git add -A` puis `git commit -m "Ce que j'ai fait"`.
4. **Publie** (remplace 0.5.0 par le nouveau numéro) :
   ```bash
   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 0.5.0
   ```
   Le script vérifie tout, lance les tests, affiche les nouveautés et demande confirmation (`o`).
5. **Suis la fabrication** : onglet **Actions** du dépôt (environ 10 minutes). À la fin, la
   version apparaît dans **Releases** avec l'installeur, l'APK et la signature (`update.json`,
   `update.json.sig`).
6. **C'est tout.** Les PC de tes proches vérifient toutes les 12 heures (et 2 minutes après le
   démarrage) : notification + clic droit sur l'icône → « Installer la mise à jour ». Les
   tablettes proposent leur nouvelle version dès que leur PC est à jour.

### Quel numéro choisir ?
- Correction seulement : `0.4.0` → `0.4.1`
- Nouveautés : `0.4.1` → `0.5.0`
- Le numéro doit toujours augmenter.

### Si le PC et la tablette ne se comprennent plus
Si tu changes la façon dont l'appli Android et le PC communiquent (méthodes `PcDeckNative`),
augmente `MIN_APP_VERSION_CODE` dans `server/server.js` : les tablettes trop anciennes
afficheront « Cette appli est trop ancienne, installe la version X » au lieu de planter. Si tu
changes les messages entre l'interface et le serveur, augmente `PROTOCOL` dans
`server/version.js` et `CLIENT_PROTOCOL` dans `client/app.js`.

### En cas de problème
- **La fabrication a échoué** (croix rouge dans Actions) : clique dessus pour lire l'erreur,
  corrige, puis supprime l'étiquette et republie :
  `git push --delete origin v0.5.0` puis `git tag -d v0.5.0`, puis relance le script.
- **Retirer une version ratée** : sur GitHub, Releases → la version → Delete. Les PC qui ne
  l'ont pas encore installée ne la verront plus. (Ceux qui l'ont installée recevront la suivante.)
- **Fabriquer sans GitHub** (pour essayer) : `powershell -ExecutionPolicy Bypass -File installer\build.ps1`
  → `dist\PCDeck-Setup-<version>.exe`.

---

## 3. Limites à connaître (et solutions)

| Limite | Ce que voit l'utilisateur | Solution |
|---|---|---|
| **SmartScreen** (installeur non signé) | « Windows a protégé votre PC » | « Informations complémentaires » → « Exécuter quand même » (expliqué dans le guide utilisateur). Disparaît avec une signature de code. |
| **Contrôle intelligent des applications** (Windows 11, actif sur ton PC) | « Une stratégie de contrôle d'application a bloqué ce fichier » — **aucun moyen de passer outre** | Seule vraie solution : **signer l'installeur**. Sinon, l'utilisateur doit désactiver ce contrôle (Sécurité Windows → Contrôle des applications et du navigateur), et il ne peut **pas** être réactivé sans réinstaller Windows : à éviter. |
| **Antivirus** | Alerte ou mise en quarantaine | PC Deck envoie des touches, filme l'écran et tourne en arrière-plan : des heuristiques peuvent s'y tromper. Signaler le faux positif (Microsoft : https://www.microsoft.com/wdsi/filesubmission), signer le code. |
| **Android : sources inconnues** | « Pour votre sécurité, l'installation d'applis inconnues… » | Une fois par source : autoriser Chrome (1re installation) puis PC Deck (mises à jour). |
| **Play Protect** | « Appli non reconnue » | « Plus de détails » → « Installer quand même ». |
| **Réseau « Public »** sur le PC | La tablette ne trouve pas le PC | L'installeur et l'icône proposent de passer en « Privé ». |
| **Wi-Fi invité / isolation des appareils** | La tablette ne trouve pas le PC | Utiliser le Wi-Fi principal de la box. |

### Signer le code (recommandé avant de distribuer largement)
- **Azure Trusted Signing** (Microsoft) : environ 10 $/mois, reconnu par SmartScreen et par le
  Contrôle intelligent des applications. Disponibilité selon le pays et le statut (particulier,
  entreprise) : à vérifier sur la page du service.
- **Certificat de signature classique** (« OV ») : environ 70 à 300 €/an selon le vendeur.
- **SignPath Foundation** : gratuit pour les projets open source.

Une fois la signature en place : signe `dist\PCDeck-Setup-<version>.exe` dans la GitHub Action
(étape « Fabriquer l'installeur »), et tu peux construire avec `-Compiled` (programmes `.exe` au
lieu des scripts PowerShell : plus rapides et moins suspects pour les antivirus), en les signant aussi.
