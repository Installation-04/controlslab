# ControlsLab

**A free, open-source, browser-based industrial controls trainer.**
Write PLC programs, measure circuits with a virtual multimeter, troubleshoot faults and lock out — on a virtual machine, with nothing to install and no account.

🇨🇦 [Version française](README.md) (reference language)

> **Original content.** All code, lessons, schematics and artwork were written for this project. ControlsLab is not affiliated with any manufacturer or commercial training platform.

## What's in 0.1 (MVP)

- **Structured Text PLC engine** (IEC 61131-3): parser, type checker, fixed scan cycle, `TON`/`TOF`/`TP` timers, `CTU`/`CTD`/`CTUD` counters, `R_TRIG`/`F_TRIG` edge detection, `SR`/`RS` latches. Runs in a Web Worker.
- **Virtual machines**: a 3-wire across-the-line starter (hardwired and PLC-controlled), a **reversing starter** (two contactors, cross-wired NC interlock, hardwired and PLC versions) and a **120 V lighting bench** (parallel circuits). Live SVG schematic, virtual multimeter (VAC, Ω, continuity, **clamp ammeter**), injectable faults (open overload contact, welded contactor, blown fuse, open coil…), and a **lockout/tagout** sequence with *live – dead – live* verification.
- **Ladder editor** (LD) alongside ST: NO/NC/edge contacts, parallel branches, coils (normal, negated, set/reset), timers and counters, with **live power flow** while the PLC runs. Ladder is transpiled to readable ST (shown in the editor) and run by the same engine.
- **Modbus TCP bridge**: a small connector (single cross-platform Node.js file) exposes the machine I/O as a **Modbus TCP server** so an **external PLC** (hardware or software) can drive the simulation. See [packages/connector](packages/connector/README.md).
- **3D cell** (three.js): drag-and-drop an **electrical panel**, **conveyors**, a box dispenser, **sensors** (photoelectric, inductive), a **pusher cylinder**, buttons, lights, stack lights and bins into the scene. Each device binds to a **PLC I/O address** (`%IX1.0`, `%QX1.0`…) in a property inspector, and the ST program drives it all. Double-click the panel to open it: same interactive schematic, multimeter and lockout as the lab. **3 scenarios** included (basic conveyor, batch of 3, metal/plastic sorter) plus a **free cell**.
- **8 lessons** (Québec French, English UI strings ready): Ohm's law · multimeter · LOTO · reading a schematic · first ST program · reversing starter & interlocking · Ladder · clamp meter.
- **Work orders** with an automatic checker, and **2 scored checkpoints** (no hints, random fault).
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
| `packages/ladder` | Ladder: model, transpiler to ST, power flow, validation |
| `packages/connector` | Modbus TCP ⇄ WebSocket bridge (standalone Node.js program) |
| `packages/content` | zod schemas, work-order checker, scoring, PLC↔machine co-simulation |
| `apps/web` | Vite + React UI |
| `content/` | **Lessons, machines, work orders, checkpoints as YAML** |

## Contributing

Lessons and machines are plain YAML: see [CONTRIBUTING.md](CONTRIBUTING.md). Branch flow: `dev` → `beta` → `main` (released with a `vX.Y.Z` tag).

## Safety disclaimer

ControlsLab is a **learning tool**. It does not replace electrical-safety training, your employer's procedures or applicable regulations (in Québec: RSST; CSA Z460 and Z462). Values and sequences are simplified for teaching. The printable record is **not** a certification.

## License

[GNU AGPL-3.0](LICENSE). If you host a modified version for others, you must publish your changes.
