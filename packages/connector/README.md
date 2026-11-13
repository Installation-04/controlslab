# ControlsLab connector (Modbus TCP)

🇨🇦 **Français** · 🇬🇧 [English below](#english)

Petit programme (Node.js ≥ 20, Windows / macOS / Linux, **un seul fichier, sans installation de dépendances**) qui expose les entrées/sorties de la machine virtuelle ControlsLab comme un **serveur Modbus TCP**. Un **automate externe** (matériel, ou logiciel comme OpenPLC, CODESYS Control, un script Python…) agit comme **maître Modbus** : il lit les capteurs et pilote les actionneurs de la machine simulée.

```text
 Automate externe  ──Modbus TCP──▶  connecteur  ◀──WebSocket (local)──  page ControlsLab (navigateur)
 (maître / client)   port 1502      (esclave)         127.0.0.1:8765      machine virtuelle
```

## Démarrage

1. Téléchargez `controlslab-connector.mjs` (lien dans le panneau **Automate externe** de l'application, ou dans la page *Releases*).
2. Lancez-le :
   ```bash
   node controlslab-connector.mjs
   ```
3. Dans ControlsLab, ouvrez un bon de travail ou une cellule 3D avec un **panneau commandé par API**, choisissez **Automate externe (Modbus TCP)**, puis **Connecter**.
4. Pointez votre automate (maître) sur `127.0.0.1:1502`.

Options : `--modbus-port` (1502; le 502 standard exige les droits administrateur), `--modbus-host` (`0.0.0.0` pour un automate sur le réseau), `--ws-port` (8765), `--allow-origin <origine>` (répétable).

## Cartographie des adresses

Base 0, ID d'unité ignoré.

| Adresse ControlsLab | Rôle | Table Modbus | Fonctions |
|---|---|---|---|
| `%IXb.p` | capteurs, boutons → automate | **entrée discrète** n° `8·b + p` | 02 (lecture) |
| `%QXb.p` | automate → bobines, voyants | **bobine** n° `8·b + p` | 01 (lecture), 05, 15 (écriture) |
| — | réservé | registres de maintien / d'entrée | 03, 04, 06, 16 (stockés, sans effet pour l'instant) |

Exemples : `%QX0.1` = bobine 1; `%IX1.2` = entrée discrète 10. Le panneau de l'application affiche la table pour la machine ouverte.

## Sécurité

- Le WebSocket n'écoute que sur **127.0.0.1** et n'accepte que les pages dont l'**origine** est autorisée (par défaut `localhost` / `127.0.0.1`). Si ControlsLab est hébergé ailleurs (ex. `http://10.0.0.5:12000`), lancez le connecteur avec `--allow-origin http://10.0.0.5:12000`.
- Le serveur Modbus écoute sur `127.0.0.1` par défaut. N'exposez `0.0.0.0` que sur un réseau de confiance : **Modbus TCP n'a aucune authentification**.
- **Sécurité intrinsèque** : si le navigateur se déconnecte, toutes les bobines sont remises à zéro et les entrées effacées.
- Ne le connectez **jamais** à une vraie machine : il ne pilote que la simulation.

## Développement

```bash
npm run connector:build     # produit dist-connector/controlslab-connector.mjs
npm run connector           # construit et lance
npm test                    # protocole, pont, sockets réels, client Modbus tiers
```

---

<a id="english"></a>

## English

A tiny program (Node.js ≥ 20, Windows / macOS / Linux, **single file, no dependencies to install**) that exposes the ControlsLab virtual machine's I/O as a **Modbus TCP server**. An **external PLC** (hardware, or software such as OpenPLC, CODESYS Control, a Python script…) acts as the **Modbus master**: it reads the simulated sensors and drives the actuators.

**Quick start:** download `controlslab-connector.mjs` (link in the app's **External PLC** panel, or the *Releases* page) → `node controlslab-connector.mjs` → in ControlsLab choose **External PLC (Modbus TCP)** on a PLC-controlled panel and click **Connect** → point your master at `127.0.0.1:1502`.

**Address map** (zero-based, unit ID ignored): `%IXb.p` (sensors → PLC) = **discrete input** `8·b + p` (function 02); `%QXb.p` (PLC → actuators) = **coil** `8·b + p` (01 read, 05/15 write). Registers (03/04/06/16) are stored but unused for now.

**Security:** the WebSocket listens on 127.0.0.1 only and checks the page **Origin** (default: localhost). If ControlsLab is hosted elsewhere, add `--allow-origin <origin>`. Modbus TCP has **no authentication**: bind `0.0.0.0` only on a trusted network. Fail-safe: when the browser disconnects, every coil is cleared. Never connect it to a real machine.
