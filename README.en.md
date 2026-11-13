# ControlsLab

**A free, open-source, browser-based industrial controls trainer.**
Write PLC programs, measure circuits with a virtual multimeter, troubleshoot faults and lock out — on a virtual machine, with nothing to install and no account.

🇨🇦 [Version française](README.md) (reference language)

> **Original content.** All code, lessons, schematics and artwork were written for this project. ControlsLab is not affiliated with any manufacturer or commercial training platform.

## What's in 0.1 (MVP)

- **Structured Text PLC engine** (IEC 61131-3): parser, type checker, fixed scan cycle, `TON`/`TOF`/`TP` timers, `CTU`/`CTD`/`CTUD` counters, `R_TRIG`/`F_TRIG` edge detection, `SR`/`RS` latches. Runs in a Web Worker.
- **Virtual machine**: a 3-wire across-the-line motor starter (600 V power, 120 V control), **hardwired** and **PLC-controlled** versions. Live SVG schematic, virtual multimeter (VAC, Ω, continuity), injectable faults (open overload contact, welded contactor, blown fuse, open coil…), and a **lockout/tagout** sequence with *live – dead – live* verification.
- **Ladder editor** (LD) alongside ST: NO/NC/edge contacts, parallel branches, coils (normal, negated, set/reset), timers and counters, with **live power flow** while the PLC runs. Ladder is transpiled to readable ST (shown in the editor) and run by the same engine.
- **3D cell** (three.js): drag-and-drop an **electrical panel**, **conveyors**, a box dispenser, **sensors** (photoelectric, inductive), a **pusher cylinder**, buttons, lights, stack lights and bins into the scene. Each device binds to a **PLC I/O address** (`%IX1.0`, `%QX1.0`…) in a property inspector, and the ST program drives it all. Double-click the panel to open it: same interactive schematic, multimeter and lockout as the lab. **3 scenarios** included (basic conveyor, batch of 3, metal/plastic sorter) plus a **free cell**.
- **5 lessons** (Québec French, English UI strings ready): Ohm's law · multimeter · LOTO · reading a schematic · first ST program (seal-in).
- **Work orders** with an automatic checker, and a **scored checkpoint** (no hints, random fault).
- **Local progress** in the browser, **printable record**, export/import (JSON backup, `.st` programs, community YAML content).

Planned: Modbus TCP bridge to real/soft PLCs, a drag-and-drop panel *wiring* editor, instructor dashboards.

## Quick start

### Docker (single container)

```bash
git clone https://github.com/Installation-04/controlslab.git
cd controlslab
./install.sh
```

Then open **http://localhost:12000**. Also: `./install.sh --update` · `./install.sh --uninstall`.

Or with Compose directly:

```bash
cp .env.example .env     # WEB_PORT=12000, TZ=America/Toronto
docker compose up -d --build
```

One service (`controlslab-web`, nginx), a dedicated `controlslab_network`, no volumes and no secrets: learner progress stays **in their browser**.

### Development

Node.js ≥ 20.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest
npm run build      # static site in apps/web/dist
```

## Repository layout

| Folder | Contents |
|---|---|
| `packages/plc-engine` | ST PLC engine (DOM-free) |
| `packages/sim` | Nodal-analysis circuit simulator, multimeter, faults, LOTO |
| `packages/factory` | Factory cell: conveyors, boxes, sensors, pusher, bins; PLC ⇄ panel ⇄ factory coupling |
| `packages/content` | zod schemas, work-order checker, scoring, PLC↔machine co-simulation |
| `apps/web` | Vite + React UI |
| `content/` | **Lessons, machines, work orders, checkpoints as YAML** |

## Contributing

Lessons and machines are plain YAML: see [CONTRIBUTING.md](CONTRIBUTING.md). Branch flow: `dev` → `beta` → `main` (released with a `vX.Y.Z` tag).

## Safety disclaimer

ControlsLab is a **learning tool**. It does not replace electrical-safety training, your employer's procedures or applicable regulations (in Québec: RSST; CSA Z460 and Z462). Values and sequences are simplified for teaching. The printable record is **not** a certification.

## License

[GNU AGPL-3.0](LICENSE). If you host a modified version for others, you must publish your changes.
