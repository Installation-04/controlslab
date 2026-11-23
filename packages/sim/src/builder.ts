// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Panel builder model: pure functions that edit a MachineDef (place components, wire terminals, move, rotate,
 * delete) and check the behaviour of a learner-built starter by simulating it. The UI is a thin layer on top.
 */
import { addPt, rotate } from './geometry';
import { LIBRARY } from './library';
import { Machine, MachineError } from './machine';
import type { ComponentDef, MachineDef, Point, Rotation, WireDef } from './types';

/** Component types the learner can place (PLC points need a PLC machine and are not offered). */
export const BUILDER_TYPES = Object.keys(LIBRARY).filter((t) => t !== 'plc_input' && t !== 'plc_output');

const PREFIX: Record<string, string> = {
  source3: 'SRC', disconnect3: 'DS', fuse: 'F', contactor: 'K', overload: 'OL', motor3: 'M', motor6: 'M',
  timer_relay: 'KT', transformer: 'XF', pushbutton: 'PB', lamp: 'LT', ground: 'PE', terminal: 'J',
};

export const GRID = 10;
export const snap = (v: number, grid = GRID) => Math.round(v / grid) * grid;

export function emptyMachine(id = 'my-panel', title = 'Mon panneau'): MachineDef {
  return {
    id,
    version: 1,
    title,
    mode: 'hardwired',
    viewBox: [1100, 700],
    components: [],
    wires: [],
    loto: { isolators: [], knownLive: [], verifyPoints: [] },
    faults: [],
  };
}

const clone = (d: MachineDef): MachineDef => structuredClone(d);

/** Next free component id for a type: F1, F2… */
export function nextComponentId(def: MachineDef, type: string): string {
  const prefix = PREFIX[type] ?? type.toUpperCase().slice(0, 3);
  const used = new Set([...def.components.map((c) => c.id), ...def.wires.map((w) => w.id)]);
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

/** Place a new component; secondary parts (coil, auxiliary contacts…) are laid out to the right of the main part. */
export function addComponent(def: MachineDef, type: string, at: Point, rot: Rotation = 0): { def: MachineDef; id: string } {
  const lib = LIBRARY[type];
  if (!lib || !BUILDER_TYPES.includes(type)) throw new MachineError(`Type de composant inconnu : ${type}`);
  const next = clone(def);
  const id = nextComponentId(def, type);
  const parts: ComponentDef['parts'] = {};
  Object.keys(lib.parts).forEach((name, i) => {
    const pos: Point = i === 0 ? at : [at[0] + 180, at[1] + (i - 1) * 70];
    parts[name] = rot ? { at: [snap(pos[0]), snap(pos[1])], rot } : { at: [snap(pos[0]), snap(pos[1])] };
  });
  next.components.push({ id, type, tag: id, parts });
  return { def: next, id };
}

/** Move every part of a component by a delta. */
export function moveComponent(def: MachineDef, id: string, dx: number, dy: number): MachineDef {
  const next = clone(def);
  const c = next.components.find((x) => x.id === id);
  if (!c) throw new MachineError(`Composant inconnu : ${id}`);
  for (const p of Object.values(c.parts)) p.at = [snap(p.at[0] + dx), snap(p.at[1] + dy)];
  return next;
}

/** Rotate a component by 90° about its first part. */
export function rotateComponent(def: MachineDef, id: string): MachineDef {
  const next = clone(def);
  const c = next.components.find((x) => x.id === id);
  if (!c) throw new MachineError(`Composant inconnu : ${id}`);
  const names = Object.keys(c.parts);
  const origin = c.parts[names[0]!]!.at;
  for (const p of Object.values(c.parts)) {
    const rot = (((p.rot ?? 0) + 90) % 360) as Rotation;
    const rel: Point = [p.at[0] - origin[0], p.at[1] - origin[1]];
    const moved = addPt(origin, rotate(rel, 90));
    p.at = [snap(moved[0]), snap(moved[1])];
    if (rot) p.rot = rot;
    else delete p.rot;
  }
  return next;
}

export function removeComponent(def: MachineDef, id: string): MachineDef {
  const next = clone(def);
  next.components = next.components.filter((c) => c.id !== id);
  const touches = (ref: string) => ref.startsWith(`${id}:`);
  next.wires = next.wires.filter((w) => !touches(w.from) && !touches(w.to));
  next.faults = next.faults.filter((f) => f.target !== id);
  return next;
}

export function setTag(def: MachineDef, id: string, tag: string): MachineDef {
  const next = clone(def);
  const c = next.components.find((x) => x.id === id);
  if (!c) throw new MachineError(`Composant inconnu : ${id}`);
  c.tag = tag.trim() || id;
  return next;
}

export function setParam(def: MachineDef, id: string, key: string, value: number | string | boolean): MachineDef {
  const next = clone(def);
  const c = next.components.find((x) => x.id === id);
  if (!c) throw new MachineError(`Composant inconnu : ${id}`);
  c.params = { ...c.params, [key]: value };
  return next;
}

const terminalsOf = (c: ComponentDef): string[] => {
  const lib = LIBRARY[c.type];
  if (!lib) return [];
  return Object.entries(lib.parts)
    .filter(([name]) => name in c.parts)
    .flatMap(([, part]) => Object.keys(part.terminals));
};

export type ConnectResult = { ok: true; def: MachineDef; id: string } | { ok: false; reason: 'same' | 'unknown' | 'duplicate' };

/** Draw a wire between two terminals ("COMP:TERM"). */
export function connect(def: MachineDef, a: string, b: string): ConnectResult {
  if (a === b) return { ok: false, reason: 'same' };
  const known = (ref: string) => {
    const i = ref.lastIndexOf(':');
    const c = def.components.find((x) => x.id === ref.slice(0, i));
    return !!c && terminalsOf(c).includes(ref.slice(i + 1));
  };
  if (!known(a) || !known(b)) return { ok: false, reason: 'unknown' };
  if (def.wires.some((w) => (w.from === a && w.to === b) || (w.from === b && w.to === a))) return { ok: false, reason: 'duplicate' };
  const next = clone(def);
  const used = new Set([...def.components.map((c) => c.id), ...def.wires.map((w) => w.id)]);
  let n = def.wires.length + 1;
  while (used.has(`W${n}`)) n++;
  const wire: WireDef = { id: `W${n}`, from: a, to: b };
  next.wires.push(wire);
  return { ok: true, def: next, id: wire.id };
}

export function removeWire(def: MachineDef, id: string): MachineDef {
  const next = clone(def);
  next.wires = next.wires.filter((w) => w.id !== id);
  next.faults = next.faults.filter((f) => f.target !== id);
  return next;
}

export function withoutWires(def: MachineDef, ids: string[]): MachineDef {
  const drop = new Set(ids);
  const next = clone(def);
  next.wires = next.wires.filter((w) => !drop.has(w.id));
  next.faults = next.faults.filter((f) => !drop.has(f.target));
  return next;
}

/**
 * Make a learner-built definition runnable: the LOTO section is derived from the isolators present, and the
 * sheet is sized to fit the parts.
 */
export function finalize(def: MachineDef): MachineDef {
  const next = clone(def);
  const iso = next.components.filter((c) => c.type === 'disconnect3').map((c) => c.id);
  const pair = (a: string, b: string): [string, string] => [a, b];
  next.loto = {
    isolators: iso,
    knownLive: iso.length ? [pair(`${iso[0]}:L1`, `${iso[0]}:L2`), pair(`${iso[0]}:L2`, `${iso[0]}:L3`), pair(`${iso[0]}:L1`, `${iso[0]}:L3`)] : [],
    verifyPoints: iso.length ? [pair(`${iso[0]}:T1`, `${iso[0]}:T2`), pair(`${iso[0]}:T2`, `${iso[0]}:T3`), pair(`${iso[0]}:T1`, `${iso[0]}:T3`)] : [],
    tryStart: next.components.find((c) => c.type === 'pushbutton' && (c.params?.contact ?? 'NO') === 'NO')?.id,
  };
  let w = 1100;
  let h = 700;
  for (const c of next.components) {
    for (const p of Object.values(c.parts)) {
      w = Math.max(w, p.at[0] + 260);
      h = Math.max(h, p.at[1] + 160);
    }
  }
  next.viewBox = [Math.ceil(w / 50) * 50, Math.ceil(h / 50) * 50];
  return next;
}

export interface BuildIssue {
  level: 'error' | 'warning';
  code: 'invalid' | 'no_source' | 'no_wires' | 'empty';
  detail?: string;
}

/** Static checks of a learner-built panel. */
export function validateBuild(def: MachineDef): BuildIssue[] {
  const issues: BuildIssue[] = [];
  if (!def.components.length) return [{ level: 'warning', code: 'empty' }];
  if (!def.components.some((c) => c.type === 'source3')) issues.push({ level: 'warning', code: 'no_source' });
  if (!def.wires.length) issues.push({ level: 'warning', code: 'no_wires' });
  try {
    new Machine(finalize(def));
  } catch (e) {
    issues.push({ level: 'error', code: 'invalid', detail: (e as Error).message });
  }
  return issues;
}

// ---------------- Behaviour check of a built 3-wire starter ----------------
export interface BuildCheckStep {
  id: 'valid' | 'idle' | 'start' | 'seal_in' | 'motor' | 'stop' | 'no_restart' | 'no_fault';
  pass: boolean;
  detail?: string;
}
export interface BuildCheckResult {
  passed: boolean;
  steps: BuildCheckStep[];
}

const paramOf = (c: ComponentDef, key: string) => (c.params?.[key] ?? LIBRARY[c.type]?.defaults?.[key]) as string | number | boolean | undefined;

/**
 * Simulates the learner's panel as a 3-wire motor starter: START (momentary NO) pulls the contactor in, it seals
 * in, the motor runs, STOP (momentary NC) drops it and it does not restart by itself. The roles are found by type,
 * so any component ids work.
 */
export function checkStarterBuild(def: MachineDef): BuildCheckResult {
  const steps: BuildCheckStep[] = [];
  const push = (id: BuildCheckStep['id'], pass: boolean, detail?: string) => steps.push({ id, pass, detail });
  let m: Machine;
  try {
    m = new Machine(finalize(def));
    push('valid', true);
  } catch (e) {
    push('valid', false, (e as Error).message);
    return { passed: false, steps };
  }
  const momentary = def.components.filter((c) => c.type === 'pushbutton' && paramOf(c, 'kind') === 'momentary');
  const start = momentary.find((c) => paramOf(c, 'contact') === 'NO');
  const stop = momentary.find((c) => paramOf(c, 'contact') === 'NC');
  const contactor = def.components.find((c) => c.type === 'contactor');
  const motor = def.components.find((c) => c.type === 'motor3' || c.type === 'motor6');
  if (!start || !stop || !contactor || !motor) {
    push('idle', false, 'missing: ' + [!start && 'START (NO)', !stop && 'STOP (NC)', !contactor && 'contactor', !motor && 'motor'].filter(Boolean).join(', '));
    return { passed: false, steps };
  }
  const on = () => m.state<{ energized: boolean }>(contactor.id).energized === true;
  push('idle', !on());
  m.press(start.id);
  m.run(300);
  push('start', on());
  m.release(start.id);
  m.run(1000);
  push('seal_in', on());
  m.run(3000);
  const ms = m.state<{ speed: number }>(motor.id);
  push('motor', ms.speed > 0.5);
  m.press(stop.id);
  m.run(300);
  m.release(stop.id);
  m.run(500);
  push('stop', !on());
  m.run(1500);
  push('no_restart', !on());
  const blown = m.events.some((e) => e.type === 'fuse_blown' || e.type === 'ol_trip');
  push('no_fault', !blown);
  return { passed: steps.every((s) => s.pass), steps };
}
