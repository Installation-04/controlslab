# ControlsLab — Plan (phase 1)

## Context
Repo `installation-04/controlslab` is empty (only a stub README). Goal: a free, self-hostable, clean-room browser trainer for PLC programming and electrical troubleshooting, French (Québec) first with i18n. Branch flow dev → beta → main with tagged releases (see Branching). First commit = this plan as `PLAN.md`.

## Stack
- npm workspaces monorepo, TypeScript strict, Node 22.
- `packages/plc-engine` — pure TS, zero DOM deps, runs in a Web Worker.
- `packages/sim` — circuit/machine simulator (pure TS).
- `apps/web` — Vite + React 18, react-router, i18next (`fr-CA` default, `en` stub), no UI framework (plain CSS modules, print stylesheet).
- Content as YAML in `content/`, validated by zod schemas at build + in tests.
- Vitest everywhere; coverage thresholds on engine + sim (≥90% lines).

## Folder layout
```
PLAN.md  README.md  README.en.md  LICENSE  CONTRIBUTING.md
package.json (workspaces)  tsconfig.base.json  vitest.workspace.ts
packages/
  plc-engine/src/
    lexer.ts  parser.ts  ast.ts          # IEC 61131-3 ST subset
    interpreter.ts  types.ts             # BOOL/INT/DINT/REAL/TIME, expressions, IF/CASE/FOR/WHILE/REPEAT
    stdlib/ton.ts tof.ts tp.ts ctu.ts ctd.ts ctud.ts r_trig.ts f_trig.ts sr.ts rs.ts
    runtime.ts                           # fixed scan: read inputs → execute → write outputs; watchdog
    io.ts                                # %IX0.0 / %QX0.0 addressing + AT binding
    worker.ts  protocol.ts               # postMessage API (load, run, stop, step, setInput, snapshot)
  plc-engine/test/*.test.ts
  sim/src/
    circuit.ts                           # netlist + MNA solver (Gaussian elim.) → node voltages, branch currents
    components.ts                        # source, resistor, fuse, switch NO/NC, pushbutton, E-stop (latching), contactor coil + contacts, overload heater + NC aux, motor load, PLC I/O points
    machine.ts                           # loads machine YAML → circuit; ties coils↔contacts each tick
    meter.ts                             # multimeter: V AC/DC, Ω (only valid de-energized; warns/“blows” if misused), continuity
    faults.ts                            # inject/clear: open_overload, welded_contact, blown_fuse, (+ open_wire, coil_open for checkpoint pool)
    loto.ts                              # LOTO state machine: notify → shutdown → isolate → lock/tag → release stored energy → verify zero energy (live-dead-live) → work → restore
    events.ts                            # event log consumed by checker
  sim/test/*.test.ts
content/
  machines/motor-starter-3w.yaml         # components, nets, SVG layout coords, I/O map, fault catalog
  lessons/01-loi-ohm.yaml 02-multimetre.yaml 03-cadenassage.yaml 04-lire-schema.yaml 05-premier-programme-st.yaml
  workorders/*.yaml                      # task + objectives (declarative predicates)
  checkpoints/cp1-demarreur.yaml
  i18n/fr-CA/*.yaml  i18n/en/*.yaml      # UI strings; lesson text lives in lesson files keyed by locale
  schema/*.ts                            # zod schemas shared by web + tests
apps/web/src/
  routes/ Home, Lessons, Lesson, Lab (machine + editor), WorkOrder, Checkpoint, Record (printable)
  components/ SchematicSvg, Multimeter, StEditor (CodeMirror 6 + ST highlighting), FaultPanel, LotoPanel, IoTable
  checker/ evaluate.ts                   # predicate evaluator over sim state + event log + PLC test harness
  store/ progress.ts                     # localStorage, versioned, export/import JSON
docker/ Dockerfile  nginx.conf
docker-compose.yml  .env.example  install.sh
```

## Key design points
- **PLC engine**: hand-written recursive-descent parser (no generator dep) producing typed AST; interpreter is tree-walking with per-POU instance state; `PROGRAM` + `FUNCTION_BLOCK` + `VAR/VAR_INPUT/VAR_OUTPUT/VAR_GLOBAL`, `AT %IX…`. Time is injected (virtual clock), so timer tests are deterministic. Scan period configurable (default 10 ms); watchdog aborts infinite loops. Clear French/English error messages with line:col.
- **Simulator**: real nodal analysis (not just connectivity) so the Ohm's-law lesson and multimeter readings are physically consistent (voltage drop across an open overload contact shows 120 V, etc.). Control circuit 120 VAC from CPT with fused secondary; power circuit 600 V 3φ modeled per-phase as RMS magnitudes. Contactor coil pickup → contacts change next tick (with chatter guard).
- **Machine ↔ PLC**: machine YAML has `mode: hardwired | plc`. In `plc` mode, the seal-in contact is removed and START/STOP/OL/E-stop wire to PLC inputs, PLC output drives the coil via interposing relay.
- **Work-order checker**: objectives are data, e.g. `fault_cleared`, `loto_completed_before: replace_part`, `measured {from,to,mode,range}`, `plc_test {script: [set START=1 @0ms, expect MOTOR=1 @50ms, …]}`. Pass/fail + per-objective feedback.
- **Checkpoint**: random fault from a pool, hints disabled; score = diagnosis correct (40) + LOTO compliance (30, any skipped step = 0 on this item, energized Ω measurement = penalty) + efficiency (measurements/parts swapped, 20) + restore & test run (10). Pass ≥ 80.
- **Export / import** (`apps/web/src/store/transfer.ts`, zod-validated, versioned with migrations):
  - ST program → `.st` file (plain IEC text, usable elsewhere); import `.st` into the editor (parsed first, errors shown).
  - Full backup → `controlslab-backup-YYYYMMDD.json`: programs, progress, work-order/checkpoint results, settings. Import = merge or replace (user choice), with preview.
  - Content packs: import a lesson / machine / work-order YAML (or a `.zip` of them) for local testing — validated against the same schemas, stored in IndexedDB, badged "local". Export any lesson/machine back to YAML (helps contributors).
- **Progress**: localStorage (`controlslab.progress.v1`), printable record page (name entered locally, date, lessons, WO results, checkpoint score) with `@media print`.
- **Lesson content (FR-CA)**: field-practice tone (CSA Z462, RSST LOTO references in general terms, live-dead-live verification, CAT III meter rating, never Ω on a live circuit). All original text and SVGs.

## Implementation order (one commit or a few per step)
1. Scaffold: workspaces, tsconfig, Vitest, lint (eslint + prettier), `PLAN.md`.
2. `plc-engine`: lexer → parser → interpreter → stdlib FBs → runtime/scan → worker protocol; tests for each (aim ~150 cases incl. timer edge cases, counters, R_TRIG/F_TRIG, operator precedence, errors).
3. `sim`: MNA solver → components → machine loader → meter → faults → LOTO; tests (each fault produces the expected symptom & meter readings; LOTO order enforcement).
4. `content` schemas + motor starter machine YAML + content-validation test.
5. `apps/web`: shell + i18n, Lab view (SVG schematic, live wire coloring, meter probes by click, fault panel in instructor/debug mode), ST editor wired to worker.
6. 5 lessons + work orders + checker.
7. Checkpoint + scoring + progress store + printable record.
8. Docker — **one container only** (`controlslab-web`): multi-stage Dockerfile (node:22-alpine build → nginx-unprivileged:alpine runtime serving the static build, listen 8080, `/healthz`, HEALTHCHECK). `docker-compose.yml` with inline comments, single service, bridge network `controlslab_network`, port `${WEB_PORT:-12000}:8080`. Generic `.env.example` (WEB_PORT=12000, TZ=America/Toronto) — no host-specific paths, no NAS/Homepage config. No volumes needed (progress lives in the browser).
   - `install.sh` (POSIX sh): checks docker + compose plugin, copies `.env.example` → `.env` if missing, `docker compose up -d --build`, waits for healthcheck, prints the URL. Supports `--uninstall` and `--update` (git pull + rebuild). Idempotent, `set -eu`.
9. README (FR + EN), LICENSE (AGPL-3.0, chosen by author; SPDX headers in source), CONTRIBUTING.md (how to add a lesson / machine / work order, schema reference, test command).
10. Push, PRs through the promotion chain (see Branching).

## Branching & releases
- Branches: `dev` → `beta` → `main`. I create `dev` and `beta` from `main` (one-time push of the empty branches).
- Daily work on the session branch `installation-04/brave-wright-menyxq` (small commits) → draft PR into `dev`.
- Promotion: PR `dev` → `beta` (pre-release testing), PR `beta` → `main`. I open these PRs; **you merge** them (I never push to `main`).
- CI (`.github/workflows/ci.yml`): typecheck, test, build, docker build on every PR to dev/beta/main.
- Release (`.github/workflows/release.yml`, on push to `main`): reads `version` from root `package.json` (starts at `0.1.0`); if tag `v<version>` doesn't exist, creates the tag + GitHub Release with changelog (commits since previous tag) and the built `dist` tarball attached. Bump version in the `beta`→`main` PR for later releases. Optional: on push to `beta`, publish a pre-release `v<version>-beta.N`.
- `CHANGELOG.md` (Keep a Changelog) updated per promotion.

## Verification
- `npm test` (Vitest, all packages) + coverage thresholds; `npm run typecheck`; `npm run build`.
- Content validation test fails on any malformed YAML.
- Playwright smoke (preinstalled Chromium): open Lab, run seal-in ST program, press START → motor runs, inject open OL → motor stops, meter reads 120 V across OL contact.
- `shellcheck install.sh`; run `install.sh` end-to-end if Docker is available in the container (curl `/healthz` on 12000), otherwise validate with `docker compose config` and say so.
