// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Virtual machine: owns component states, builds the network, steps time,
 * exposes operator actions (buttons, disconnect, locks), the multimeter,
 * repairs and fault injection. Everything the trainee does is logged as an
 * event for LOTO tracking, work-order checking and scoring.
 */
import { abs } from './complex';
import { addPt, rotate } from './geometry';
import { LIBRARY, type ComponentType, type CompState, type Ctx } from './library';
import { computeLoto, type LotoStatus } from './loto';
import { GND, Network, type Solution } from './mna';
import type { ComponentDef, FaultDef, MachineDef, MeterMode, MeterReading, Point, SimEvent, SimEventInput, ViolationCode } from './types';

interface CompRuntime {
  def: ComponentDef;
  type: ComponentType;
  params: Record<string, number | string | boolean>;
  state: CompState;
  faults: Set<string>;
}

export type ActionResult = { ok: true } | { ok: false; reason: string };

const LIVE_THRESHOLD = 2; // V: an ohmmeter on anything above this is "on a live circuit"
const OVERRANGE = 40e6;

export class MachineError extends Error {}

/** Resolve "COMP:TERM" to a node name (identity, validated). GND is the reference. */
function splitRef(ref: string): [string, string] {
  const i = ref.lastIndexOf(':');
  if (i <= 0) throw new MachineError(`Invalid terminal reference "${ref}"`);
  return [ref.slice(0, i), ref.slice(i + 1)];
}

export class Machine {
  readonly def: MachineDef;
  time = 0;
  readonly events: SimEvent[] = [];
  private readonly comps = new Map<string, CompRuntime>();
  private readonly wireFaults = new Set<string>();
  private plcOutputs: Record<string, boolean> = {};
  private sol!: Solution;
  private readonly injected = new Set<string>();
  private lastSig = '';

  constructor(def: MachineDef, library: Record<string, ComponentType> = LIBRARY) {
    this.def = def;
    for (const c of def.components) {
      const type = library[c.type];
      if (!type) throw new MachineError(`Unknown component type "${c.type}" (${c.id})`);
      if (this.comps.has(c.id)) throw new MachineError(`Duplicate component id "${c.id}"`);
      for (const p of Object.keys(c.parts)) {
        if (!type.parts[p]) throw new MachineError(`Component ${c.id}: unknown part "${p}" for type ${c.type}`);
      }
      const params = { ...type.defaults, ...c.params };
      this.comps.set(c.id, { def: c, type, params, state: type.init(params), faults: new Set() });
    }
    const ids = new Set<string>();
    for (const w of def.wires) {
      if (ids.has(w.id) || this.comps.has(w.id)) throw new MachineError(`Duplicate wire id "${w.id}"`);
      ids.add(w.id);
      this.checkTerminal(w.from);
      this.checkTerminal(w.to);
    }
    for (const f of def.faults) this.checkFault(f);
    for (const p of [...def.loto.knownLive, ...def.loto.verifyPoints].flat()) this.checkTerminal(p);
    for (const i of def.loto.isolators) {
      if (this.comps.get(i)?.def.type !== 'disconnect3') throw new MachineError(`LOTO isolator "${i}" must be a disconnect3`);
    }
    this.settle(0);
  }

  private checkTerminal(ref: string) {
    if (ref === GND) return;
    const [id, term] = splitRef(ref);
    const c = this.comps.get(id);
    if (!c) throw new MachineError(`Unknown component "${id}" in "${ref}"`);
    if (!Object.values(c.type.parts).some((p) => term in p.terminals)) {
      throw new MachineError(`Component ${id} (${c.def.type}) has no terminal "${term}"`);
    }
  }

  private checkFault(f: FaultDef) {
    if (f.kind === 'open' && this.def.wires.some((w) => w.id === f.target)) return;
    const c = this.comps.get(f.target);
    if (!c) throw new MachineError(`Fault ${f.id}: unknown target "${f.target}"`);
    if (!c.type.faults.includes(f.kind)) throw new MachineError(`Fault ${f.id}: ${c.def.type} does not support "${f.kind}"`);
  }

  // ---------- Network ----------
  private ctx(c: CompRuntime): Ctx {
    return {
      id: c.def.id,
      params: c.params,
      state: c.state,
      faults: c.faults,
      node: (t) => `${c.def.id}:${t}`,
      inner: (n) => `${c.def.id}#${n}`,
      plcOutputs: this.plcOutputs,
    };
  }

  private build(mode: 'ac' | 'ohm'): Network {
    const net = new Network();
    for (const c of this.comps.values()) {
      for (const part of Object.values(c.type.parts)) for (const t of Object.keys(part.terminals)) net.touch(`${c.def.id}:${t}`);
      c.type.stamp({ ...this.ctx(c), mode, net });
    }
    for (const w of this.def.wires) {
      if (!this.wireFaults.has(w.id)) net.resistor(w.id, w.from, w.to, 0.001);
    }
    return net;
  }

  private emit = (e: SimEventInput) => {
    this.events.push({ ...e, t: this.time } as SimEvent);
  };

  /** Solve, let coils/inputs switch until stable, then integrate time-based behaviour. */
  private settle(dt: number) {
    let changed = true;
    for (let i = 0; i < 8 && changed; i++) {
      // The network only depends on component states, faults and PLC outputs:
      // when none changed since the last solve (steady state), reuse the solution.
      const sig = this.signature();
      if (sig !== this.lastSig || !this.sol) {
        this.sol = this.build('ac').solve();
        this.lastSig = sig;
      }
      changed = false;
      for (const c of this.comps.values()) {
        if (c.type.switching?.({ ...this.ctx(c), sol: this.sol, dt, emit: this.emit })) changed = true;
      }
    }
    if (dt > 0) {
      for (const c of this.comps.values()) c.type.integrate?.({ ...this.ctx(c), sol: this.sol, dt, emit: this.emit });
    }
  }

  /** Everything that influences the circuit equations (rounded so slow ramps still re-solve). */
  private signature(): string {
    let s = '';
    for (const c of this.comps.values()) {
      for (const [k, v] of Object.entries(c.state)) {
        if (k === 'heat' || k === 'lit' || k === 'state' || k === 'locks') continue;
        s += typeof v === 'number' ? `${k}${Math.round(v * 1000)}` : `${k}${String(v)}`;
      }
      if (c.faults.size) s += [...c.faults].join('+');
      s += '|';
    }
    for (const [k, v] of Object.entries(this.plcOutputs)) if (v) s += k;
    return s + [...this.wireFaults].join(',');
  }

  /** Advance simulated time. */
  tick(dtMs: number) {
    this.time += dtMs;
    const before = this.events.length;
    this.settle(dtMs);
    // Time-based devices (overload trip, fuse blow) may have changed the network.
    if (this.events.length !== before) this.settle(0);
  }

  /** Run for a duration in fixed steps (tests / fast-forward). */
  run(ms: number, step = 20) {
    for (let t = 0; t < ms; t += step) this.tick(step);
  }

  // ---------- Queries ----------
  component(id: string): CompRuntime {
    const c = this.comps.get(id);
    if (!c) throw new MachineError(`Unknown component "${id}"`);
    return c;
  }

  state<T = CompState>(id: string): T {
    return this.component(id).state as T;
  }

  /** Voltage magnitude of a node to ground (for wire colouring). */
  voltage(ref: string): number {
    return abs(this.sol.v(ref));
  }

  vab(a: string, b: string): number {
    return abs(this.sol.vab(a, b));
  }

  /** Absolute position of a terminal on the schematic (first part that has it). */
  terminalPosition(ref: string): Point | undefined {
    const [id, term] = splitRef(ref);
    const c = this.comps.get(id);
    if (!c) return undefined;
    for (const [name, place] of Object.entries(c.def.parts)) {
      const t = c.type.parts[name]?.terminals[term];
      if (t) return addPt(place.at, rotate(t, place.rot));
    }
    return undefined;
  }

  /** All probe-able terminals. */
  terminals(): string[] {
    const out: string[] = [];
    for (const c of this.comps.values()) {
      for (const name of Object.keys(c.def.parts)) {
        for (const t of Object.keys(c.type.parts[name]!.terminals)) out.push(`${c.def.id}:${t}`);
      }
    }
    return out;
  }

  loto(): LotoStatus {
    return computeLoto(this.def, this.events);
  }

  /** Faults injected and not yet repaired. */
  activeFaults(): FaultDef[] {
    return this.def.faults.filter((f) => this.injected.has(f.id));
  }

  violations(): ViolationCode[] {
    return this.events.flatMap((e) => (e.type === 'violation' ? [e.code] : []));
  }

  // ---------- PLC coupling ----------
  setPlcOutputs(outputs: Record<string, boolean | number>) {
    const next: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(outputs)) next[k] = Boolean(v);
    const same = Object.keys({ ...next, ...this.plcOutputs }).every((k) => !!next[k] === !!this.plcOutputs[k]);
    this.plcOutputs = next;
    if (!same) this.settle(0);
  }

  getPlcInputs(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const c of this.comps.values()) {
      if (c.def.type === 'plc_input') out[String(c.params.address)] = c.state.on === true;
    }
    return out;
  }

  // ---------- Operator actions ----------
  press(id: string): ActionResult {
    const c = this.component(id);
    if (c.def.type !== 'pushbutton') return { ok: false, reason: 'not_a_button' };
    // A toggle switch flips on each press; momentary/mushroom buttons engage.
    c.state.pressed = c.params.kind === 'toggle' ? !c.state.pressed : true;
    this.emit({ type: 'press', component: id });
    this.settle(0);
    return { ok: true };
  }

  release(id: string): ActionResult {
    const c = this.component(id);
    if (c.def.type !== 'pushbutton') return { ok: false, reason: 'not_a_button' };
    if (c.params.kind !== 'mushroom' && c.params.kind !== 'toggle') c.state.pressed = false;
    this.emit({ type: 'release', component: id });
    this.settle(0);
    return { ok: true };
  }

  /** Twist-to-release a latched E-stop. */
  resetEStop(id: string): ActionResult {
    const c = this.component(id);
    if (c.def.type !== 'pushbutton' || c.params.kind !== 'mushroom') return { ok: false, reason: 'not_an_estop' };
    c.state.pressed = false;
    this.emit({ type: 'estop_reset', component: id });
    this.settle(0);
    return { ok: true };
  }

  private isRunning(): boolean {
    for (const c of this.comps.values()) {
      if (c.def.type === 'motor3' && (c.state.speed as number) > 0.02) return true;
    }
    return false;
  }

  setDisconnect(id: string, on: boolean): ActionResult {
    const c = this.component(id);
    if (c.def.type !== 'disconnect3') return { ok: false, reason: 'not_a_disconnect' };
    const locks = c.state.locks as string[];
    if (on && locks.length) return { ok: false, reason: 'locked' };
    if (c.state.on === on) return { ok: true };
    const underLoad = !on && this.isRunning();
    c.state.on = on;
    this.emit({ type: 'disconnect', component: id, on, underLoad });
    if (underLoad) this.violation('disconnect_under_load', id);
    this.settle(0);
    return { ok: true };
  }

  applyLock(id: string, owner = 'moi'): ActionResult {
    const c = this.component(id);
    if (c.def.type !== 'disconnect3') return { ok: false, reason: 'not_lockable' };
    if (c.state.on) return { ok: false, reason: 'must_be_off' };
    const locks = c.state.locks as string[];
    if (locks.includes(owner)) return { ok: false, reason: 'already_locked' };
    locks.push(owner);
    this.emit({ type: 'lock_applied', component: id, owner });
    return { ok: true };
  }

  removeLock(id: string, owner = 'moi'): ActionResult {
    const c = this.component(id);
    const locks = (c.state.locks as string[] | undefined) ?? [];
    const i = locks.indexOf(owner);
    if (i < 0) return { ok: false, reason: 'not_locked' };
    locks.splice(i, 1);
    if (this.loto().workAllowed) this.violation('lock_removed_before_restore', id);
    this.emit({ type: 'lock_removed', component: id, owner });
    return { ok: true };
  }

  /** Procedural LOTO acknowledgements that have no physical action in the sim. */
  acknowledge(type: 'notify' | 'stored_energy_checked' | 'work_done'): ActionResult {
    if (type === 'stored_energy_checked' && this.isRunning()) return { ok: false, reason: 'still_moving' };
    this.emit({ type });
    return { ok: true };
  }

  resetOverload(id: string): ActionResult {
    const c = this.component(id);
    if (c.def.type !== 'overload') return { ok: false, reason: 'not_an_overload' };
    const ok = (c.state.heat as number) < 0.6;
    if (ok) c.state.tripped = false;
    this.emit({ type: 'ol_reset', component: id, ok });
    this.settle(0);
    return ok ? { ok: true } : { ok: false, reason: 'too_hot' };
  }

  /** Replace a component or a wire. Clears its faults. Must be done under LOTO. */
  replace(target: string): ActionResult {
    const isWire = this.def.wires.some((w) => w.id === target);
    if (!isWire && !this.comps.has(target)) return { ok: false, reason: 'unknown' };
    const lotoOk = this.loto().workAllowed;
    if (!lotoOk) this.violation('work_without_loto', target);
    let hadFault: boolean;
    if (isWire) {
      hadFault = this.wireFaults.delete(target);
    } else {
      const c = this.component(target);
      hadFault = c.faults.size > 0 || c.state.blown === true || c.state.tripped === true;
      c.faults.clear();
      c.state = c.type.replaced?.(this.ctx(c)) ?? c.type.init(c.params);
    }
    this.emit({ type: 'replace', target, hadFault, lotoOk });
    for (const f of this.def.faults) {
      if (f.target === target && this.injected.delete(f.id)) this.emit({ type: 'fault_cleared', fault: f.id });
    }
    this.settle(0);
    return { ok: true };
  }

  recordDiagnosis(faultId: string): boolean {
    const correct = this.injected.has(faultId);
    this.emit({ type: 'diagnosis', fault: faultId, correct });
    return correct;
  }

  private violation(code: ViolationCode, detail?: string) {
    this.emit({ type: 'violation', code, detail });
  }

  // ---------- Faults (instructor / scenario) ----------
  injectFault(faultId: string): ActionResult {
    const f = this.def.faults.find((x) => x.id === faultId);
    if (!f) return { ok: false, reason: 'unknown_fault' };
    if (f.kind === 'open' && this.def.wires.some((w) => w.id === f.target)) this.wireFaults.add(f.target);
    else this.component(f.target).faults.add(f.kind);
    this.injected.add(f.id);
    this.emit({ type: 'fault_injected', fault: f.id });
    this.settle(0);
    return { ok: true };
  }

  clearFaults() {
    for (const id of [...this.injected]) {
      const f = this.def.faults.find((x) => x.id === id)!;
      this.wireFaults.delete(f.target);
      this.comps.get(f.target)?.faults.delete(f.kind);
      this.injected.delete(id);
      this.emit({ type: 'fault_cleared', fault: id });
    }
    this.settle(0);
  }

  // ---------- Multimeter ----------
  measure(a: string, b: string, mode: MeterMode): MeterReading {
    if (mode === 'AAC') return this.clamp(a);
    if (a !== GND) this.checkTerminal(a);
    if (b !== GND) this.checkTerminal(b);
    const vab = this.vab(a, b);
    // A powered panel is live even where a node happens to sit near 0 V (e.g. a coil tied to X2):
    // an ohmmeter must only be used after isolation, so any closed isolator counts as energized.
    const powered = [...this.comps.values()].some((c) => c.def.type === 'disconnect3' && c.state.on === true);
    const energized = powered || Math.max(vab, this.voltage(a), this.voltage(b)) > LIVE_THRESHOLD;
    let reading: MeterReading;
    switch (mode) {
      case 'VAC':
        reading = { mode, a, b, value: round(vab, vab < 10 ? 2 : 1), unit: 'V~', display: fmtV(vab) };
        break;
      case 'VDC':
        // The sim is AC-only: a DC voltmeter averages a sine to ~0.
        reading = { mode, a, b, value: 0, unit: 'V⎓', display: '0.00' };
        break;
      case 'OHM':
      case 'CONT': {
        if (energized) {
          reading = { mode, a, b, value: NaN, unit: 'Ω', display: '----', warning: 'ohms_on_live' };
          this.violation('ohms_on_live', `${a}–${b}`);
          break;
        }
        const r = this.resistance(a, b);
        if (mode === 'OHM') reading = { mode, a, b, value: r, unit: 'Ω', display: fmtOhm(r) };
        else reading = { mode, a, b, value: r, unit: 'Ω', display: fmtOhm(r), beep: r < 50 };
        break;
      }
    }
    this.emit({ type: 'measure', reading, energized });
    return reading;
  }

  /** Clamp-on ammeter around a wire: AC current magnitude (A). Works live; never needs isolation. */
  clamp(wireId: string): MeterReading {
    if (!this.def.wires.some((w) => w.id === wireId)) throw new MachineError(`Unknown wire "${wireId}"`);
    const amps = this.wireFaults.has(wireId) ? 0 : abs(this.sol.current(wireId));
    const value = Math.round(amps * 1000) / 1000;
    const display = value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : value.toFixed(0);
    const reading: MeterReading = { mode: 'AAC', a: wireId, b: '', value, display, unit: 'A~' };
    this.emit({ type: 'measure', reading, energized: amps > 1e-3 });
    return reading;
  }

  /** Resistance between two points with all sources de-energized (1 mA test current). */
  resistance(a: string, b: string): number {
    if (a === b) return 0;
    const net = this.build('ohm');
    net.isource('meter', b, a, { re: 1e-3, im: 0 });
    const sol = net.solve();
    const r = abs(sol.vab(a, b)) / 1e-3;
    return r > OVERRANGE ? Infinity : r;
  }
}

function round(v: number, d: number) {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

function fmtV(v: number): string {
  if (v < 10) return v.toFixed(2);
  if (v < 100) return v.toFixed(1);
  return v.toFixed(0);
}

export function fmtOhm(r: number): string {
  if (!Number.isFinite(r)) return 'OL';
  if (r < 1000) return `${r.toFixed(1)}`;
  if (r < 1e6) return `${(r / 1000).toFixed(2)} k`;
  return `${(r / 1e6).toFixed(2)} M`;
}
