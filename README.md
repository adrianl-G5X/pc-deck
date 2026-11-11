# PC Deck

**Transforme ta tablette (ou ton téléphone) en télécommande pour ton PC Windows.**

Un « Stream Deck » maison : des gros boutons pour lancer tes programmes, ouvrir tes sites,
régler le son, verrouiller le PC… et, à côté, les infos du PC en direct (processeur, carte
graphique, températures, consommation, Wi-Fi).

```
Tablette ou téléphone  ⇄  ton Wi-Fi  ⇄  PC Deck sur ton PC Windows
```

## Ce que tu peux faire

- **Lancer** un programme, un site web, un dossier, un fichier.
- **Un appui = ouvrir ou ramener devant** : si le programme est déjà ouvert, il revient au
  premier plan (jamais en double). **Deux appuis rapides = nouvel onglet** (navigateur, dossier).
- **Régler le son** : monter, baisser, couper. Le volume d'une seule appli est possible aussi.
- **Raccourcis clavier**, verrouillage du PC, enchaînements d'actions (macros).
- **Choisir l'écran** où s'ouvre un programme (principal ou 2e écran).
- **Voir et piloter l'écran du PC** depuis la tablette.
- **Hors de chez toi** : ça marche aussi à distance, via Tailscale (gratuit, installé pour toi).
- **Mises à jour automatiques**, signées : tes proches reçoivent chaque nouvelle version tout seuls.

Tout se règle dans une fenêtre simple, **sans toucher au code** : clic droit sur l'icône PC Deck
→ **Paramètres**. En créant un bouton, colle un lien, un `.exe` ou un dossier : PC Deck devine
le type et choisit l'icône.

## Installer (5 minutes)

1. **Sur le PC** : télécharge `PCDeck-Setup-….exe` dans la
   [dernière version](https://github.com/adrianl-G5X/pc-deck/releases/latest) et ouvre-le.
   Tout est inclus, il n'y a rien d'autre à installer. Laisse cochée la case
   « Utiliser PC Deck hors de chez moi » pour l'accès à distance.
2. **Sur la tablette** : sur la page « Connecter un appareil » qui s'ouvre, scanne le QR code
   pour installer l'appli, puis tape le code à 6 chiffres.
3. **iPhone / iPad** : scanne le QR code, puis Safari → Partager → « Sur l'écran d'accueil ».

Le guide pas à pas, avec les écrans de Windows, est dans
**[GUIDE-UTILISATEUR.md](GUIDE-UTILISATEUR.md)**.

## Questions fréquentes

| Problème | Solution |
|---|---|
| La tablette ne trouve pas le PC | Le PC est allumé, avec l'icône PC Deck près de l'horloge ? Même Wi-Fi (pas « invité ») ? Clic droit sur l'icône : si tu vois « Réseau « Public » », clique dessus. |
| « Code incorrect » ou « expiré » | Sur le PC : **Connecter un appareil** → **Nouveau code**. Le code ne sert qu'une fois, pendant 5 minutes. |
| Températures vides (« — ») | Attends une minute après le démarrage, ou clic droit sur l'icône → « Températures : réparer… ». |
| Le double appui ne fait rien | Appuie deux fois assez vite (moins d'une demi-seconde). Tu peux aussi le changer dans Paramètres → Modifier le bouton. |
| L'icône a disparu | Menu Démarrer → **PC Deck**. |

## Sécurité, en bref

- PC Deck n'est **jamais ouvert sur Internet** : seulement ton réseau local et tes appareils Tailscale.
- Chaque appareil doit être **appairé** avec un code à usage unique.
- La tablette envoie seulement le nom d'un bouton : **aucune commande libre** ne peut être
  envoyée au PC. Les actions viennent toujours de ta configuration.
- Les mises à jour sont **signées** : une version qui n'est pas signée par ta clé est refusée.

## Pour aller plus loin

| Document | Pour qui |
|---|---|
| [GUIDE-UTILISATEUR.md](GUIDE-UTILISATEUR.md) | Tes proches : installer et utiliser PC Deck |
| [GUIDE-PUBLICATION.md](GUIDE-PUBLICATION.md) | Toi : publier une nouvelle version |
| [DEVELOPPEUR.md](DEVELOPPEUR.md) | Les détails techniques : `config.json`, types d'actions, mode USB, extension du navigateur, installeur, organisation des fichiers |
| [CHANGELOG.md](CHANGELOG.md) | Ce qui change à chaque version |

Pour lancer les tests : `npm test`.

## Licence et signature

PC Deck est sous [licence MIT](LICENSE). Voir la [politique de signature du code](CODE_SIGNING_POLICY.md).

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).
