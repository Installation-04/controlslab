# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) · Versions: [SemVer](https://semver.org/lang/fr/).

## [0.4.0] — Éditeur de câblage

### Ajouté / Added
- **Éditeur de câblage de panneau** (route `#/builder`) : placer des composants de la bibliothèque, déplacer, pivoter, tracer des fils en cliquant les bornes, éditer désignation et paramètres, essayer le panneau en mode Marche avec le vrai simulateur (mesures, défauts, cadenassage), exporter/importer en YAML et l'ajouter au laboratoire libre; défi « démarreur à 3 fils » vérifié par simulation (démarrage, auto-maintien, moteur, arrêt, pas de redémarrage). Modèle pur dans `@controlslab/sim` (`builder.ts`).

## [0.3.0] — Phase 3 (machines, leçons, anglais)

### Ajouté / Added
- **Anglais complet** : traductions des 9 leçons, 12 bons de travail, 2 points de contrôle et 6 scénarios dans `content/i18n/en/` (fichiers de superposition fusionnés au chargement, test de couverture), messages de test et noms d'entités localisés.
- **Démarreur étoile-triangle** (`star-delta-3w`) : relais temporisé à l'excitation (`timer_relay`) et moteur à six bornes (`motor6`) dans le simulateur; courant de démarrage ≈ 1/3 en étoile, verrouillage NF croisé, changement après 5 s; leçon 9 et bon de travail BT-0012; symboles de schéma correspondants.
- **Scénario 3D SC-0005** : deux convoyeurs en séquence (démarrage retardé de CV1 par TON, arrêt retardé de CV2 par TOF, arrêt d'urgence immédiat), avec solution modèle et tests négatifs.
- **Réservoir avec pompe** (entité 3D `tank`, pompe directe ou entraînée par le moteur du panneau, capteurs de niveau bas/haut, débordement et mise à sec comptabilisés) et **scénario SC-0006** (régulation de niveau par hystérésis); nouvelles étapes de test `expectLevel` et `expectTank`.

## [0.2.0] — Phase 2

### Ajouté / Added
- **Pont Modbus TCP** (`@controlslab/connector`) : serveur Modbus TCP (fonctions 01–06, 15, 16) ⇄ WebSocket local; un automate externe lit les capteurs (%IX → entrées discrètes) et pilote les sorties (%QX → bobines); origines contrôlées, sécurité intrinsèque à la déconnexion; fichier unique distribué dans l'application et les releases; sélecteur « Automate virtuel / externe » dans les bons de travail et la Cellule 3D.
- **Machines** : inverseur de marche (câblé et API) avec contacts NF croisés, sens de rotation réel du moteur (séquence des phases) et freinage à contre-courant; banc d'éclairage 120 V; interrupteur à bascule; contact NF 21-22 sur les contacteurs; **pince ampèremétrique** dans le multimètre.
- **Contenu** : leçons 6 (inverseur et verrouillage), 7 (Ladder) et 8 (pince et circuits en parallèle); bons de travail BT-0007 à BT-0009 et BT-0011; point de contrôle 2 (inverseur); scénario 3D SC-0004 (convoyeur réversible, bande entraînée selon le sens réel du moteur).
- **Éditeur Ladder** (`@controlslab/ladder`) : modèle, opérations d'édition, transcription Ladder → ST, écoulement de puissance en direct, validation; éditeur SVG dans les bons de travail et la Cellule 3D; bon de travail BT-0006 (démarrage temporisé), points de départ Ladder pour BT-0005 et les scénarios.

## [0.1.0] — MVP (phase 1)

### Ajouté / Added
- **Moteur API** (`@controlslab/plc-engine`) : Structured Text IEC 61131-3 (parseur, vérification de types, interpréteur), cycle de balayage fixe sur horloge virtuelle, TON/TOF/TP, CTU/CTD/CTUD, R_TRIG/F_TRIG, SR/RS, fonctions standard, chien de garde, Web Worker.
- **Simulateur** (`@controlslab/sim`) : analyse nodale en phaseurs complexes (600 V triphasé, TC 120 V), multimètre virtuel, défauts injectables (surcharge ouverte, contacts soudés, fusibles grillés, etc.), séquence de cadenassage (vivant – mort – vivant).
- **Machine virtuelle** : démarreur direct 3 fils, version câblée et version commandée par API.
- **5 leçons** (français québécois) : loi d'Ohm, multimètre, cadenassage, lecture de schéma, premier programme ST.
- **Bons de travail** avec vérificateur, **point de contrôle noté** sans indices.
- **Progression locale** (navigateur), dossier imprimable, export/import (sauvegarde JSON, `.st`, contenu YAML).
- **Cellule 3D** (`@controlslab/factory` + three.js) : convoyeurs, distributeur, capteurs photoélectrique et inductif, vérin, bacs, boutons, voyants; panneau électrique glissé-déposé dans la scène et lié à l'automate; inspecteur d'E/S avec validation; génération des déclarations ST; 3 scénarios + cellule libre; export/import de cellule.
- **Déploiement** : un seul conteneur Docker (nginx), `docker-compose.yml`, `install.sh`.
