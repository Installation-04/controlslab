# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) · Versions: [SemVer](https://semver.org/lang/fr/).

## [0.1.0] — MVP (phase 1)

### Ajouté / Added
- **Moteur API** (`@controlslab/plc-engine`) : Structured Text IEC 61131-3 (parseur, vérification de types, interpréteur), cycle de balayage fixe sur horloge virtuelle, TON/TOF/TP, CTU/CTD/CTUD, R_TRIG/F_TRIG, SR/RS, fonctions standard, chien de garde, Web Worker.
- **Simulateur** (`@controlslab/sim`) : analyse nodale en phaseurs complexes (600 V triphasé, TC 120 V), multimètre virtuel, défauts injectables (surcharge ouverte, contacts soudés, fusibles grillés, etc.), séquence de cadenassage (vivant – mort – vivant).
- **Machine virtuelle** : démarreur direct 3 fils, version câblée et version commandée par API.
- **5 leçons** (français québécois) : loi d'Ohm, multimètre, cadenassage, lecture de schéma, premier programme ST.
- **Bons de travail** avec vérificateur, **point de contrôle noté** sans indices.
- **Progression locale** (navigateur), dossier imprimable, export/import (sauvegarde JSON, `.st`, contenu YAML).
- **Déploiement** : un seul conteneur Docker (nginx), `docker-compose.yml`, `install.sh`.
