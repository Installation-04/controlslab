# Contribuer à ControlsLab / Contributing

Merci! Les leçons, machines et bons de travail sont des **données** (YAML) : on peut contribuer sans écrire de code.
*Lessons, machines and work orders are plain YAML data — no coding needed.*

## Règles du projet

1. **Contenu 100 % original.** N'y copiez, ne collez et n'imitez aucun texte, schéma, code ou exercice d'une plateforme commerciale, d'un manuel protégé ou d'un cours existant. Vous écrivez avec vos mots, d'après votre expérience. En ouvrant une PR, vous confirmez être l'auteur et accepter la licence **AGPL-3.0**.
2. **Pratique de terrain d'abord**, sécurité incluse : mesures réalistes, séquences correctes, pas de raccourcis dangereux présentés comme normaux.
3. **Français québécois professionnel** comme langue de référence. L'anglais est optionnel : ajoutez-le au besoin avec `{ fr: ..., en: ... }`.
4. **Branches** : travaillez sur une branche de fonctionnalité → PR vers **`dev`**. Les mainteneurs promeuvent `dev` → `beta` → `main`. Ne poussez jamais sur `main`. Une version est publiée (étiquette `vX.Y.Z`) quand `main` reçoit une nouvelle version dans `package.json`.
5. Commits courts et descriptifs (`feat(content): …`, `fix(sim): …`).

## Environnement

```bash
npm install
npm run dev          # interface sur http://localhost:5173
npm test             # tous les tests (le contenu YAML est validé!)
npm run typecheck && npm run lint
```

Le test `packages/content/test/content.test.ts` valide **tout** le YAML de `content/` : schéma, références croisées (machines, défauts, bornes de mesure, bons de travail liés aux leçons…). Si votre contenu passe `npm test`, il se chargera dans l'application.
Vous pouvez aussi l'essayer sans toucher au dépôt : page **Données → Importer du contenu YAML** (il reste local à votre navigateur et est marqué « local »).

---

## Ajouter une leçon — `content/lessons/NN-nom.yaml`

```yaml
id: mon-sujet            # unique; lettres, chiffres, - et _
order: 6                 # position dans la liste
title: { fr: Titre de la leçon, en: Lesson title }   # ou simplement une chaîne (français)
summary: Une phrase qui donne envie.
minutes: 30
prerequisites: [multimetre]     # ids de leçons (facultatif)
objectives:
  - Ce que l'apprenant saura faire à la fin.
blocks:
  - type: text
    md: |
      Markdown limité : `## titres`, listes, **gras**, *italique*, `code`, tableaux `| a | b |`, citations `>`.
  - type: callout
    kind: safety          # safety | warning | field | tip
    title: Un titre
    md: Un encadré.
  - type: code
    lang: st
    title: Exemple
    code: |
      PROGRAM Main … END_PROGRAM
  - type: schematic       # figure en lecture seule d'une machine
    machine: motor-starter-3w
    caption: Légende
    highlight: [DS]       # ids de composants ou de fils à mettre en évidence
  - type: quiz
    id: q-mon-sujet-1     # unique dans la leçon
    question: …
    choices: [Réponse A, Réponse B, Réponse C]
    answer: 1             # indice (à partir de 0)
    explain: Pourquoi (affiché après la vérification).
  - type: calc            # calculateur de la loi d'Ohm
    id: calc-1
    kind: ohm
    preset: { V: 120, R: 240 }
  - type: practice        # bouton vers un bon de travail
    workorder: wo-006-mon-exercice
references:
  - Normes ou documents à consulter.
```

> **Piège YAML (typographie française)** : une chaîne non guillemetée qui contient « ` : ` » (espace, deux-points, espace) est invalide. Utilisez un bloc `>-`, `|`, ou des guillemets : `explain: >-` puis le texte sur la ligne suivante.

Conseils : une leçon = une compétence; terminez par une pratique; un quiz doit *expliquer* la bonne réponse.

## Ajouter un bon de travail — `content/workorders/wo-NNN-nom.yaml`

```yaml
id: wo-006-mon-exercice
number: BT-0006
title: Titre du bon
machine: motor-starter-3w           # id d'une machine
priority: normal                    # low | normal | urgent
complaint: « Ce que dit l'opérateur. »
context: Contexte utile (facultatif).
faults: [f6_blown]                  # défauts injectés au départ (ids du catalogue de la machine)
requiresDiagnosis: true             # affiche le panneau de diagnostic
hints:
  - Premier indice (progressif).
objectives:                         # le bon est réussi quand TOUS sont vrais
  - { type: measured, points: ['F6:1', 'F6:2'], mode: VAC, min: 100, label: Tension en travers de F6 }
  - { type: diagnosis, label: Diagnostic correct }
  - { type: loto_step, step: verify, label: Cadenassage vérifié }
  - { type: replaced, target: F6, label: Fusible remplacé }
  - { type: faults_cleared, label: Défaut corrigé }
  - { type: loto_step, step: restore, label: Remise en service }
  - { type: no_violation, label: Aucune faute de sécurité }
```

Types d'objectifs : `faults_cleared` · `no_violation` (`code` optionnel : `ohms_on_live`, `work_without_loto`, `disconnect_under_load`, `lock_removed_before_restore`) · `loto_step` (`notify` `shutdown` `isolate` `lockout` `stored_energy` `try_start` `verify` `restore`) · `measured` (`points`, `mode` VAC/VDC/OHM/CONT, `min`/`max`, l'ordre des sondes est indifférent) · `diagnosis` · `state` (`component`, `key`, `equals`) · `lamp_lit` · `replaced` · `plc_test`.

**Bon de travail avec programme d'API** (la machine doit être en `mode: plc`) :

```yaml
plc:
  starter: |          # programme de départ affiché dans l'éditeur
    PROGRAM Main … END_PROGRAM
  tests:
    - id: t-demarrage
      title: …
      steps:          # exécuté sur une machine neuve, couplée à l'automate
        - { press: PB_START }
        - { wait: 100 }
        - { release: PB_START }
        - { wait: 300 }
        - { expect: { component: M, key: energized, equals: true }, msg: Message d'échec ciblé }
        - { expectOutput: '%QX0.0', equals: true }
objectives:
  - { type: plc_test, test: t-demarrage, label: Démarrage }
```

Les messages `msg` sont ce que l'apprenant lit quand il échoue : rendez-les **instructifs** (dites ce qui a été observé, pas la solution).

**Ladder ou ST.** Ajoutez `ldStarter` (programme Ladder de départ) dans `plc:` pour offrir le Ladder à l'apprenant (`languages: [st, ld]`, `defaultLang: ld` pour l'imposer par défaut). Le Ladder est transcrit en ST puis exécuté par le même moteur : **les mêmes tests scriptés** valident les deux langages. Format d'un échelon (JSON/YAML) : `logic` = arbre `contact` (`k`: NO/NC/P/N) / `cmp` / `series` / `parallel`; `outputs` = `coil` (`normal`, `negated`, `set`, `reset`), `timer` (TON/TOF/TP) ou `counter` (CTU/CTD). Voir `packages/ladder/src/types.ts`; les contacts sur la sortie d'un bloc s'écrivent `T1.Q`, `C1.CV`.

**Ajoutez toujours un test de « solution modèle »** dans `packages/content/test/golden.test.ts` : il prouve que votre bon est réalisable et que l'état initial échoue.

## Ajouter un point de contrôle — `content/checkpoints/*.yaml`

Même idée, sans indices : `pool` (défauts tirés au hasard), `weights` (somme 100 : `diagnosis`, `loto`, `efficiency`, `restore`), `efficiency` (`freeMeasurements`, `perExtraMeasurement`, `perWrongPart`), `passScore`, `timeLimitMinutes`. Chaque défaut du `pool` doit être résoluble : ajoutez-le au test « expert » du point de contrôle.

## Ajouter une machine — `content/machines/*.yaml`

Une machine est : des **composants** (types de la bibliothèque), des **fils**, un **plan de cadenassage** et un **catalogue de défauts**.

```yaml
id: ma-machine
version: 1
title: { fr: Ma machine, en: My machine }
mode: hardwired            # hardwired | plc
viewBox: [1100, 700]       # taille du schéma SVG
components:
  - id: DS
    type: disconnect3
    tag: SA                # désignation affichée
    label: { fr: Sectionneur principal, en: Main disconnect }   # infobulle
    params: {}             # surcharge des valeurs par défaut du type
    parts:
      main: { at: [60, 80] }          # position (+ rot: 90 | 180 | 270)
wires:
  - { id: W1, label: L1, from: 'SRC:L1', to: 'DS:L1' }          # "COMPOSANT:BORNE"
  - { id: W2, from: 'F1:2', to: 'F4:1', via: [[60, 250]], junctions: [[60, 250]] }
loto:
  isolators: [DS]                          # sectionneurs (type disconnect3) à cadenasser
  knownLive: [['DS:L1', 'DS:L2']]          # sources connues pour « vivant »
  verifyPoints: [['DS:T1', 'DS:T2']]       # points qui doivent lire ~0 V
  tryStart: PB_START
faults:
  - { id: f6_blown, target: F6, kind: blown, label: Fusible F6 grillé }
  - { id: wire_open, target: W2, kind: open, label: Fil coupé }   # défaut sur un fil : kind "open"
```

**Bibliothèque de composants** (`packages/sim/src/library.ts`) :

| Type | Parties (`parts`) → bornes | Défauts (`kind`) |
|---|---|---|
| `source3` | `main` → L1 L2 L3 | `phase_loss` |
| `disconnect3` | `main` → L1 L2 L3 / T1 T2 T3 | `pole_open` |
| `fuse` | `main` → 1 2 | `blown` |
| `contactor` | `poles` → L1-3/T1-3 · `coil` → A1 A2 · `aux` → 13 14 | `coil_open` `welded` `aux_open` |
| `overload` | `heaters` → L1-3/T1-3 · `nc` → 95 96 · `no` → 97 98 | `nc_open` |
| `motor3` | `main` → T1 T2 T3 | `winding_open` |
| `transformer` | `main` → H1 H2 X1 X2 | `primary_open` |
| `pushbutton` | `main` → 1 2 (`params.contact` NO/NC, `kind` momentary/mushroom, `color`) | `contact_open` `welded` |
| `lamp` | `main` → X1 X2 | `burnt` |
| `plc_input` | `main` → IN COM (`params.address`) | `dead` |
| `plc_output` | `main` → C O (`params.address`) | `welded` |
| `ground` | `main` → G | — |
| `terminal` | `main` → T | — |

Le simulateur résout un vrai circuit : tout ce que vous câblez produira des tensions et des résistances cohérentes. Après avoir écrit une machine, écrivez des tests de symptômes (voir `packages/sim/test/machine.test.ts`) : « avec ce défaut, voici ce que le multimètre doit lire ».

Un **nouveau type de composant** demande du code TypeScript : `packages/sim/src/library.ts` (électrique) + un symbole dans `apps/web/src/lab/Schematic.tsx` (dessin), avec tests. Ouvrez d'abord une discussion/issue.

## Ajouter un scénario 3D — `content/scenarios/sc-NN-nom.yaml`

Un scénario place des appareils dans la cellule 3D, donne un programme de départ et des **tests scriptés** exécutés sur la simulation.

```yaml
id: sc-04-mon-scenario
number: SC-0004
title: Titre
complaint: « La plainte du client. »
context: >-
  Contexte, adresses d'E/S utiles.
hints:
  - "Indices progressifs (guillemets si le texte contient « : »)."
editable: true                      # l'apprenant peut ajouter/déplacer des appareils non verrouillés
entities:                           # x, z en mètres (vue de dessus); rot : 0 → +x, 90 → +z, 180 → −x, 270 → −z
  - { id: PN1, type: panel, x: -1.6, z: -1.7, rot: 0, params: { machine: motor-starter-plc }, locked: true }
  - { id: CV1, type: conveyor, x: 0, z: 0, rot: 0, params: { length: 3, drive: panel }, locked: true }
  - { id: PH1, type: photo, x: 0.9, z: -0.6, rot: 90, params: { range: 0.8 }, io: { detect: '%IX1.0' } }
plc:
  starter: |
    PROGRAM Main … END_PROGRAM      # doit déclarer (AT) toutes les adresses utilisées par les appareils
  tests:
    - id: t-un
      title: …
      steps:
        - { panelPress: PB_START }  # boutons du panneau (ids de la machine)
        - { run: 300 }              # durée simulée en ms
        - { panelRelease: PB_START }
        - { run: 30000 }
        - { expectBin: { bin: BN1, kind: metal, min: 3 }, msg: Message ciblé }
objectives:
  - { type: plc_test, test: t-un, label: Ce qui est vérifié }
```

**Types d'appareils** (`packages/factory/src/types.ts`, tableau `SPECS`) :

| Type | Signaux (E/S de l'API) | Paramètres principaux |
|---|---|---|
| `conveyor` | `run` (sortie) | `length`, `speed`, `drive` (`direct` : piloté par `run`; `panel` : entraîné par le moteur du panneau), `reverse` |
| `spawner` | — | `intervalMs`, `max`, `pattern` (ex. `plastic,metal`; types : plastic, metal, cardboard) |
| `photo` | `detect` (entrée) | `range` — faisceau dans le sens de `rot` |
| `prox` | `detect` (entrée, **métal seulement**) | `range` |
| `pusher` | `extend` (sortie), `retracted`, `extended` (entrées) | `stroke`, `strokeMs` — pousse dans le sens de `rot` |
| `button` | `state` (entrée) | `contact` (NO/NC), `latching`, `color` |
| `light` / `stacklight` | `on` / `green`,`amber`,`red` (sorties) | `color` |
| `bin` | — | `size` — compte et retire les boîtes qui y entrent |
| `panel` | — | `machine` (id d'une machine `mode: plc`) |

**Étapes de test** : `run`, `press`/`release` (boutons de la scène), `panelPress`/`panelRelease` (boutons du panneau), `inject` (défaut du panneau), `expectBin` (`bin`, `kind`, `min`, `max`), `expectInput`/`expectOutput` (`address`, `equals`), `expectBelt` (`id`, `running`), `expectLost` (`max`). Une boîte « perdue » est tombée d'un convoyeur sans atteindre un bac.

**Règles d'E/S** : les adresses du câblage du panneau (ex. `%IX0.0–0.4`, `%QX0.0–0.1`) sont réservées; les appareils de terrain utilisent `%IX1.x` / `%QX1.x`. Deux capteurs ne peuvent pas partager une adresse d'entrée.

**Ajoutez toujours une solution modèle** dans `packages/content/test/scenarios.test.ts` : elle doit réussir tous les tests, et le programme de départ doit échouer. Pensez aux timings : le moteur met ~1,5 s à accélérer et ~4 s à s'arrêter par inertie.

Un **nouveau type d'appareil** demande du code : `packages/factory/src/types.ts` (spécification) + `sim.ts` (comportement) + `apps/web/src/cell/scene3d.ts` (dessin 3D), avec tests.

## Contribuer au moteur d'API

`packages/plc-engine`. Toute fonctionnalité ST arrive avec des tests dans `packages/plc-engine/test/` (couverture ≥ 90 %). Les erreurs ont un `code` stable et un message FR/EN (`errors.ts`).

## Traduire l'interface

Les chaînes de l'interface sont dans `apps/web/src/strings.ts` (`s('français', 'english')`). Le texte des leçons/machines accepte `{ fr, en }`.

## Avant d'ouvrir la PR

```bash
npm run lint && npm run typecheck && npm test
```
