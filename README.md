# ControlsLab

**Plateforme libre de formation en automatisme industriel, dans le navigateur.**
Écrivez des programmes d'API (PLC), mesurez des circuits au multimètre, dépannez des pannes et cadenassez — sur une machine virtuelle, sans rien installer ni créer de compte.

🇬🇧 [English version](README.en.md)

> **Contenu original.** Le code, les leçons, les schémas et les illustrations sont tous écrits pour ce projet. ControlsLab n'est affilié à aucun fabricant ni à aucune plateforme de formation commerciale.

## Ce que contient la version 0.1 (MVP)

- **Moteur d'API en Structured Text** (IEC 61131-3) : parseur, vérification de types, cycle de balayage fixe, temporisateurs `TON`/`TOF`/`TP`, compteurs `CTU`/`CTD`/`CTUD`, détection de front `R_TRIG`/`F_TRIG`, bascules `SR`/`RS`. S'exécute dans un *Web Worker*.
- **Machines virtuelles** : démarreur direct 3 fils (câblé et commandé par API), **inverseur de marche** (deux contacteurs, verrouillage par contacts NF croisés, version câblée et version API) et **banc d'éclairage 120 V** (circuits en parallèle). Schéma SVG animé, multimètre virtuel (V~, Ω, continuité, **pince ampèremétrique**), défauts injectables (contact de surcharge ouvert, contacteur soudé, fusible grillé, bobine ouverte…), séquence de **cadenassage** avec vérification *vivant – mort – vivant*.
- **Éditeur Ladder** (LD) en plus du ST : contacts NO/NF/front, branches parallèles, bobines (normale, inversée, S/R), temporisateurs et compteurs, avec **écoulement de puissance en direct** pendant que l'automate tourne. Le Ladder est transcrit en ST lisible (visible dans l'éditeur) et exécuté par le même moteur.
- **Pont Modbus TCP** : un petit connecteur (un seul fichier Node.js, multiplateforme) expose les E/S de la machine en **serveur Modbus TCP** pour piloter la simulation avec un **automate externe** (matériel ou logiciel). Voir [packages/connector](packages/connector/README.md).
- **Cellule 3D** (three.js) : glissez-déposez un **panneau électrique**, des **convoyeurs**, un distributeur de boîtes, des **capteurs** (photoélectrique, inductif), un **vérin pousseur**, des boutons, voyants, colonnes lumineuses et bacs dans la scène. Chaque appareil se lie à une **adresse d'E/S** (`%IX1.0`, `%QX1.0`…) dans un inspecteur de propriétés, puis le programme ST pilote le tout. Double-clic sur le panneau pour l'ouvrir : même schéma interactif, multimètre et cadenassage que le laboratoire. **3 scénarios** inclus (convoyeur de base, lot de 3 boîtes, tri métal/plastique) + une **cellule libre**.
- **8 leçons en français québécois** : loi d'Ohm · multimètre · cadenassage · lecture de schéma · premier programme ST · inverseur et verrouillage · Ladder · pince ampèremétrique.
- **Bons de travail** avec vérificateur automatique et **point de contrôle noté** (sans indices, défaut tiré au hasard).
- **Progression locale** dans le navigateur, **dossier imprimable**, export/import (sauvegarde JSON, programmes `.st`, contenu communautaire YAML).

Prévu ensuite : pont Modbus TCP vers des automates réels ou logiciels, éditeur de câblage de panneau (glisser-déposer des composants), tableaux de bord pour formateurs.

## Démarrage rapide

### Avec Docker (un seul conteneur)

```bash
git clone https://github.com/Installation-04/controlslab.git
cd controlslab
./install.sh
```

L'application est ensuite disponible sur **http://localhost:12000**.
Autres commandes : `./install.sh --update` (mise à jour) · `./install.sh --uninstall` (désinstallation).

Ou directement avec Compose :

```bash
cp .env.example .env     # WEB_PORT=12000, TZ=America/Toronto
docker compose up -d --build
```

Le `docker-compose.yml` est commenté ligne par ligne et peut être déployé tel quel depuis une interface de gestion de piles (Arcane, Portainer, etc.). Un seul service (`controlslab-web`, nginx), un réseau dédié `controlslab_network`, aucun volume, aucun secret : la progression des apprenants reste **dans leur navigateur**.

### En développement

Node.js ≥ 20.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest (moteur, simulateur, contenu, interface)
npm run build      # site statique dans apps/web/dist
```

Test de bout en bout (Chromium via Playwright) :

```bash
npm run build && (cd apps/web && npx vite preview --port 4173 --host 127.0.0.1 &)
npm run e2e -w @controlslab/web
```

## Organisation du dépôt

| Dossier | Contenu |
|---|---|
| `packages/plc-engine` | Moteur d'API ST (sans dépendance au DOM) |
| `packages/sim` | Simulation de circuit (analyse nodale), multimètre, défauts, cadenassage |
| `packages/factory` | Cellule d'usine : convoyeurs, boîtes, capteurs, vérin, bacs; couplage API ⇄ panneau ⇄ usine |
| `packages/ladder` | Ladder : modèle, transcription vers ST, écoulement de puissance, validation |
| `packages/connector` | Pont Modbus TCP ⇄ WebSocket (programme Node.js autonome) |
| `packages/content` | Schémas zod, vérificateur de bons de travail, notation, co-simulation API↔machine |
| `apps/web` | Interface Vite + React |
| `content/` | **Leçons, machines, bons de travail, points de contrôle en YAML** |
| `docker/`, `docker-compose.yml`, `install.sh` | Déploiement |
| `PLAN.md` | Architecture et feuille de route |

## Contribuer

Les leçons et les machines sont de simples fichiers YAML : voir [CONTRIBUTING.md](CONTRIBUTING.md). Branches : `dev` → `beta` → `main` (version publiée avec une étiquette `vX.Y.Z`).

## Sécurité et avertissement

ControlsLab est un **outil d'apprentissage**. Il ne remplace ni la formation en sécurité électrique, ni les procédures de l'employeur, ni la réglementation applicable (au Québec : RSST; normes CSA Z460 et Z462). Les valeurs et séquences sont simplifiées à des fins pédagogiques. Le dossier imprimable n'est **pas** une attestation de compétence.

## Licence

[GNU AGPL-3.0](LICENSE). Si vous hébergez une version modifiée pour d'autres personnes, vous devez en publier les sources.
