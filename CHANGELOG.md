# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) · Versions: [SemVer](https://semver.org/lang/fr/).

## [Non publié / Unreleased]

### Ajouté / Added
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
