// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic kinematic simulation of a conveyor cell (no physics engine:
 * belts carry items, a pusher displaces them, sensors test overlaps).
 * Fixed sub-steps keep results independent of the caller's tick size.
 */
import { ITEM_KINDS, SPECS, dirOf, resolveParams, type EntityDef, type Item, type ItemKind } from './types';

const SUBSTEP_MS = 10;
export const BELT_WIDTH = 0.5;
const ITEM_SIZE: Record<ItemKind, [number, number, number]> = {
  plastic: [0.3, 0.3, 0.25],
  metal: [0.3, 0.3, 0.2],
  cardboard: [0.35, 0.3, 0.3],
};

export type Signals = Record<string, boolean | number>;

interface Rect {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
}

const itemRect = (i: Item): Rect => ({ cx: i.x, cz: i.z, hx: i.w / 2, hz: i.d / 2 });
const overlap = (a: Rect, b: Rect) => Math.abs(a.cx - b.cx) < a.hx + b.hx && Math.abs(a.cz - b.cz) < a.hz + b.hz;

/** Oriented rectangle → axis-aligned (entities only use 90° rotations). */
function entityRect(e: EntityDef, along: number, across: number, cx = e.x, cz = e.z): Rect {
  const horizontal = e.rot === 0 || e.rot === 180;
  return { cx, cz, hx: (horizontal ? along : across) / 2, hz: (horizontal ? across : along) / 2 };
}

function segmentHitsRect(x0: number, z0: number, x1: number, z1: number, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const d = [x1 - x0, z1 - z0];
  const o = [x0 - r.cx, z0 - r.cz];
  const h = [r.hx, r.hz];
  for (let k = 0; k < 2; k++) {
    if (Math.abs(d[k]!) < 1e-9) {
      if (Math.abs(o[k]!) > h[k]!) return false;
    } else {
      let a = (-h[k]! - o[k]!) / d[k]!;
      let b = (h[k]! - o[k]!) / d[k]!;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function distToRect(px: number, pz: number, r: Rect): number {
  const dx = Math.max(Math.abs(px - r.cx) - r.hx, 0);
  const dz = Math.max(Math.abs(pz - r.cz) - r.hz, 0);
  return Math.hypot(dx, dz);
}

export interface BinStats {
  count: number;
  byKind: Record<ItemKind, number>;
}

export class FactorySim {
  time = 0;
  items: Item[] = [];
  spawned = 0;
  /** Items that left the belts without reaching a bin. */
  lost = 0;
  readonly bins: Record<string, BinStats> = {};
  private nextItem = 1;
  private spawnAt: Record<string, number> = {};
  private spawnCount: Record<string, number> = {};
  /** Pusher stroke position 0 (retracted) … 1 (extended). */
  readonly stroke: Record<string, number> = {};
  /** Belt speed factor 0..1 (and sign) as currently applied, for the renderer. */
  readonly belt: Record<string, number> = {};
  private pressed: Record<string, boolean> = {};
  private external: Record<string, number> = {};
  readonly entities: EntityDef[];

  constructor(entities: EntityDef[]) {
    this.entities = entities;
    for (const e of entities) {
      if (e.type === 'bin') this.bins[e.id] = { count: 0, byKind: { plastic: 0, metal: 0, cardboard: 0 } };
      if (e.type === 'pusher') this.stroke[e.id] = 0;
      if (e.type === 'conveyor') this.belt[e.id] = 0;
      if (e.type === 'spawner') {
        this.spawnAt[e.id] = 0;
        this.spawnCount[e.id] = 0;
      }
    }
  }

  /** Motor-driven belts (drive: "panel"): factor from the real motor speed (0..1). */
  setExternalDrive(id: string, factor: number) {
    this.external[id] = factor;
  }

  press(id: string) {
    const e = this.entities.find((x) => x.id === id);
    if (!e || e.type !== 'button') return;
    this.pressed[id] = resolveParams(e).latching ? !this.pressed[id] : true;
  }

  release(id: string) {
    const e = this.entities.find((x) => x.id === id);
    if (e && e.type === 'button' && !resolveParams(e).latching) this.pressed[id] = false;
  }

  isPressed = (id: string) => !!this.pressed[id];

  /** Advance time. `outputs` are PLC outputs by address. */
  step(dtMs: number, outputs: Signals): void {
    let left = dtMs;
    while (left > 1e-9) {
      const dt = Math.min(SUBSTEP_MS, left);
      this.sub(dt, outputs);
      left -= dt;
    }
  }

  private out(e: EntityDef, signal: string, outputs: Signals): boolean {
    const a = e.io?.[signal];
    return !!a && !!outputs[a];
  }

  private sub(dt: number, outputs: Signals) {
    this.time += dt;

    // Pushers
    for (const e of this.entities) {
      if (e.type !== 'pusher') continue;
      const p = resolveParams(e);
      const speed = dt / Number(p.strokeMs);
      const s = this.stroke[e.id]! + (this.out(e, 'extend', outputs) ? speed : -speed);
      this.stroke[e.id] = Math.max(0, Math.min(1, s));
    }

    // Belts
    for (const e of this.entities) {
      if (e.type !== 'conveyor') continue;
      const p = resolveParams(e);
      const run = p.drive === 'panel' ? (this.external[e.id] ?? 0) : this.out(e, 'run', outputs) ? 1 : 0;
      this.belt[e.id] = run * (p.reverse ? -1 : 1);
    }

    // Spawners
    for (const e of this.entities) {
      if (e.type !== 'spawner') continue;
      const p = resolveParams(e);
      this.spawnAt[e.id]! += dt;
      if (this.spawnAt[e.id]! < Number(p.intervalMs)) continue;
      if (this.spawnCount[e.id]! >= Number(p.max)) continue;
      const pattern = String(p.pattern)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is ItemKind => (ITEM_KINDS as string[]).includes(s));
      const kind = pattern.length ? pattern[this.spawnCount[e.id]! % pattern.length]! : 'plastic';
      const [w, d, h] = ITEM_SIZE[kind];
      const candidate: Item = { id: 0, kind, x: e.x, z: e.z, w, d, h, onFloor: false };
      if (this.items.some((i) => overlap(itemRect(i), itemRect(candidate)))) continue; // wait until the spot is free
      candidate.id = this.nextItem++;
      this.items.push(candidate);
      this.spawned++;
      this.spawnCount[e.id]!++;
      this.spawnAt[e.id] = 0;
    }

    // Item motion: belts, then pushers (pushers win)
    const belts = this.entities.filter((e) => e.type === 'conveyor');
    for (const it of this.items) {
      if (it.onFloor) continue;
      const belt = belts.find((b) => {
        const p = resolveParams(b);
        return overlapsPoint(entityRect(b, Number(p.length), BELT_WIDTH), it.x, it.z);
      });
      if (!belt) continue;
      const v = this.belt[belt.id]! * Number(resolveParams(belt).speed);
      if (!v) continue;
      const [dx, dz] = dirOf(belt.rot);
      const step = (v * dt) / 1000;
      const moved = { ...it, x: it.x + dx * step, z: it.z + dz * step };
      // Items that already fell to the floor no longer block the belt.
      if (!this.items.some((o) => !o.onFloor && o.id !== it.id && overlap(itemRect(o), itemRect(moved)))) {
        it.x = moved.x;
        it.z = moved.z;
      }
    }
    for (const e of this.entities) {
      if (e.type !== 'pusher') continue;
      const p = resolveParams(e);
      const [dx, dz] = dirOf(e.rot);
      const reach = 0.05 + this.stroke[e.id]! * Number(p.stroke);
      const plate = entityRect(e, 0.1, 0.3, e.x + dx * reach, e.z + dz * reach);
      const frontAlong = (e.x + dx * (reach + 0.05)) * dx + (e.z + dz * (reach + 0.05)) * dz;
      for (const it of this.items) {
        if (!overlap(plate, itemRect(it))) continue;
        const half = Math.abs(dx) * (it.w / 2) + Math.abs(dz) * (it.d / 2);
        const along = it.x * dx + it.z * dz;
        const target = frontAlong + half;
        if (along < target) {
          it.x += dx * (target - along);
          it.z += dz * (target - along);
        }
      }
    }

    // Bins & floor
    for (const it of [...this.items]) {
      const bin = this.entities.find((b) => b.type === 'bin' && overlapsPoint(entityRect(b, Number(resolveParams(b).size), Number(resolveParams(b).size)), it.x, it.z));
      if (bin) {
        const s = this.bins[bin.id]!;
        s.count++;
        s.byKind[it.kind]++;
        this.items.splice(this.items.indexOf(it), 1);
        continue;
      }
      if (!it.onFloor) {
        const onBelt = belts.some((b) => {
          const p = resolveParams(b);
          return overlapsPoint(entityRect(b, Number(p.length), BELT_WIDTH), it.x, it.z);
        });
        const nearPlate = this.entities.some((e) => e.type === 'pusher' && distToRect(it.x, it.z, entityRect(e, 0.3, 0.3)) < 1.2 && this.stroke[e.id]! > 0);
        if (!onBelt && !nearPlate) {
          it.onFloor = true;
          this.lost++;
        }
      }
    }
  }

  /** Sensor / switch states by PLC address (inputs). */
  readInputs(): Record<string, boolean> {
    const r: Record<string, boolean> = {};
    for (const e of this.entities) {
      const p = resolveParams(e);
      const set = (signal: string, v: boolean) => {
        const a = e.io?.[signal];
        if (a) r[a] = v;
      };
      switch (e.type) {
        case 'photo': {
          const [dx, dz] = dirOf(e.rot);
          const range = Number(p.range);
          set('detect', this.items.some((i) => segmentHitsRect(e.x, e.z, e.x + dx * range, e.z + dz * range, itemRect(i))));
          break;
        }
        case 'prox':
          set('detect', this.items.some((i) => i.kind === 'metal' && distToRect(e.x, e.z, itemRect(i)) <= Number(p.range)));
          break;
        case 'pusher':
          set('retracted', this.stroke[e.id]! <= 0.001);
          set('extended', this.stroke[e.id]! >= 0.999);
          break;
        case 'button':
          set('state', p.contact === 'NC' ? !this.pressed[e.id] : !!this.pressed[e.id]);
          break;
      }
    }
    return r;
  }

  /** Visual states of actuators, for the renderer and tests. */
  lampState(e: EntityDef, signal: string, outputs: Signals): boolean {
    return this.out(e, signal, outputs);
  }

  total(binId: string, kind?: ItemKind): number {
    const s = this.bins[binId];
    if (!s) return 0;
    return kind ? s.byKind[kind] : s.count;
  }
}

function overlapsPoint(r: Rect, x: number, z: number) {
  return Math.abs(x - r.cx) <= r.hx && Math.abs(z - r.cz) <= r.hz;
}

export { SPECS };
