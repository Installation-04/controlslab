// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Component library. Each type declares its drawable parts (terminal
 * geometry, used by both the simulator and the SVG renderer), the faults it
 * supports, and how it stamps itself into the network.
 *
 * Electrical values are typical of a small 600 V / 5 HP across-the-line
 * starter with a 600:120 V control power transformer.
 */
import { C, abs, div, polar, type Complex } from './complex';
import type { Network, Solution } from './mna';
import { GND } from './mna';
import type { Point, SimEventInput } from './types';

export type CompState = Record<string, unknown>;

export interface PartGeom {
  /** Symbol name for the renderer. */
  symbol: string;
  terminals: Record<string, Point>;
}

export interface Ctx {
  id: string;
  params: Record<string, number | string | boolean>;
  state: CompState;
  faults: Set<string>;
  /** Node name for a terminal of this component. */
  node(term: string): string;
  /** Internal node name. */
  inner(name: string): string;
  plcOutputs: Record<string, boolean>;
}

export interface StampCtx extends Ctx {
  mode: 'ac' | 'ohm';
  net: Network;
}

export interface UpdateCtx extends Ctx {
  sol: Solution;
  dt: number;
  emit(e: SimEventInput): void;
}

export interface ComponentType {
  parts: Record<string, PartGeom>;
  faults: string[];
  defaults?: Record<string, number | string | boolean>;
  init(params: Record<string, number | string | boolean>): CompState;
  stamp(ctx: StampCtx): void;
  /** Instantaneous switching (coils, inputs). Return true if anything changed. */
  switching?(ctx: UpdateCtx): boolean;
  /** Time-based behaviour, once per tick after the network has settled. */
  integrate?(ctx: UpdateCtx): void;
  /** Called when the part is replaced: return a fresh state (default: init). */
  replaced?(ctx: Ctx): CompState;
}

const R_CLOSED = 0.002;
const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);

const POLE3: PartGeom['terminals'] = {
  L1: [0, 0], L2: [50, 0], L3: [100, 0], T1: [0, 50], T2: [50, 50], T3: [100, 50],
};
const TWO = (a: string, b: string, symbol: string): PartGeom => ({
  symbol,
  terminals: { [a]: [0, 0], [b]: [60, 0] },
});

function poles(ctx: StampCtx, closed: (phase: number) => boolean, r = R_CLOSED) {
  for (let k = 1; k <= 3; k++) {
    if (closed(k)) ctx.net.resistor(`${ctx.id}.p${k}`, ctx.node(`L${k}`), ctx.node(`T${k}`), r);
  }
}

/** Utility supply, grounded wye. */
const source3: ComponentType = {
  parts: { main: { symbol: 'source3', terminals: { L1: [0, 0], L2: [50, 0], L3: [100, 0] } } },
  faults: ['phase_loss'],
  defaults: { vLL: 600, hz: 60 },
  init: () => ({}),
  stamp(ctx) {
    const vph = num(ctx.params.vLL, 600) / Math.sqrt(3);
    const star = ctx.inner('n');
    ctx.net.resistor(`${ctx.id}.gnd`, star, GND, 0.001);
    [0, -120, 120].forEach((deg, i) => {
      const k = i + 1;
      if (k === 2 && ctx.faults.has('phase_loss')) return;
      const internal = ctx.inner(`L${k}`);
      if (ctx.mode === 'ac') ctx.net.vsource(`${ctx.id}.v${k}`, internal, star, polar(vph, deg));
      else ctx.net.resistor(`${ctx.id}.v${k}`, internal, star, 0.01);
      ctx.net.resistor(`${ctx.id}.r${k}`, internal, ctx.node(`L${k}`), 0.02);
    });
  },
};

/** Fusible / non-fusible 3-pole disconnect switch, lockable in OFF. */
const disconnect3: ComponentType = {
  parts: { main: { symbol: 'disconnect3', terminals: POLE3 } },
  faults: ['pole_open'],
  init: () => ({ on: true, locks: [] as string[] }),
  stamp(ctx) {
    if (!ctx.state.on) return;
    poles(ctx, (k) => !(k === 2 && ctx.faults.has('pole_open')));
  },
  replaced: (ctx) => ({ on: false, locks: ctx.state.locks }),
};

const fuse: ComponentType = {
  parts: { main: TWO('1', '2', 'fuse') },
  faults: ['blown'],
  defaults: { rating: 2 },
  init: () => ({ blown: false }),
  stamp(ctx) {
    if (!ctx.state.blown && !ctx.faults.has('blown')) ctx.net.resistor(ctx.id, ctx.node('1'), ctx.node('2'), 0.01);
  },
  integrate(ctx) {
    if (ctx.state.blown) return;
    const i = abs(ctx.sol.current(ctx.id));
    if (i > num(ctx.params.rating, 2) * 8) {
      ctx.state.blown = true;
      ctx.emit({ type: 'fuse_blown', component: ctx.id });
    }
  },
};

/** 3-pole contactor with coil and one NO auxiliary (13-14). */
const contactor: ComponentType = {
  parts: {
    poles: { symbol: 'contacts3', terminals: POLE3 },
    coil: TWO('A1', 'A2', 'coil'),
    aux: TWO('13', '14', 'contact_no'),
    /** NC auxiliary (21-22): the electrical interlock of reversing starters. */
    aux_nc: TWO('21', '22', 'contact_nc'),
  },
  faults: ['coil_open', 'welded', 'aux_open', 'aux_nc_open', 'aux_nc_stuck'],
  defaults: { coilV: 120, coilVA: 8, coilR: 110 },
  init: () => ({ energized: false }),
  stamp(ctx) {
    const welded = ctx.faults.has('welded');
    const closed = welded || ctx.state.energized === true;
    poles(ctx, () => closed);
    if (welded || (closed && !ctx.faults.has('aux_open'))) {
      ctx.net.resistor(`${ctx.id}.aux`, ctx.node('13'), ctx.node('14'), R_CLOSED);
    }
    // NC auxiliary: closed at rest, opens when the contactor picks up. "stuck" = fused closed (interlock defeated).
    const ncClosed = ctx.faults.has('aux_nc_stuck') || (!closed && !ctx.faults.has('aux_nc_open'));
    if (ncClosed) ctx.net.resistor(`${ctx.id}.auxnc`, ctx.node('21'), ctx.node('22'), R_CLOSED);
    if (!ctx.faults.has('coil_open')) {
      const v = num(ctx.params.coilV, 120);
      const r = ctx.mode === 'ac' ? (v * v) / num(ctx.params.coilVA, 8) : num(ctx.params.coilR, 110);
      ctx.net.resistor(`${ctx.id}.coil`, ctx.node('A1'), ctx.node('A2'), r);
    }
  },
  switching(ctx) {
    const vn = num(ctx.params.coilV, 120);
    const v = ctx.faults.has('coil_open') ? 0 : abs(ctx.sol.vab(ctx.node('A1'), ctx.node('A2')));
    const was = ctx.state.energized === true;
    const now = was ? v >= 0.5 * vn : v >= 0.8 * vn;
    ctx.state.energized = now;
    return now !== was;
  },
};

/** Thermal overload relay: 3 heaters, NC 95-96 (trip), NO 97-98 (alarm). */
const overload: ComponentType = {
  parts: {
    heaters: { symbol: 'heaters3', terminals: POLE3 },
    nc: TWO('95', '96', 'ol_nc'),
    no: TWO('97', '98', 'ol_no'),
  },
  faults: ['nc_open'],
  defaults: { fla: 5, tripClass: 10 },
  init: () => ({ tripped: false, heat: 0 }),
  stamp(ctx) {
    poles(ctx, () => true, 0.05);
    if (!ctx.state.tripped && !ctx.faults.has('nc_open')) {
      ctx.net.resistor(`${ctx.id}.nc`, ctx.node('95'), ctx.node('96'), R_CLOSED);
    }
    if (ctx.state.tripped) ctx.net.resistor(`${ctx.id}.no`, ctx.node('97'), ctx.node('98'), R_CLOSED);
  },
  integrate(ctx) {
    const fla = num(ctx.params.fla, 5);
    let imax = 0;
    for (let k = 1; k <= 3; k++) imax = Math.max(imax, abs(ctx.sol.current(`${ctx.id}.p${k}`)));
    const ratio = imax / fla;
    let heat = ctx.state.heat as number;
    const dts = ctx.dt / 1000;
    // Class 10: ~10 s to trip at 600 % FLA. Cools with a ~10 s time constant.
    const k = num(ctx.params.tripClass, 10) * 35;
    if (ratio > 1.15) heat += (dts * (ratio * ratio - 1)) / k;
    else heat *= Math.exp(-dts / 10);
    ctx.state.heat = heat;
    if (!ctx.state.tripped && heat >= 1) {
      ctx.state.tripped = true;
      ctx.emit({ type: 'ol_trip', component: ctx.id });
    }
  },
};

/** Squirrel-cage induction motor, wye connected. Impedance falls toward locked-rotor when slow. */
const motor3: ComponentType = {
  parts: { main: { symbol: 'motor3', terminals: { T1: [0, 0], T2: [50, 0], T3: [100, 0] } } },
  faults: ['winding_open'],
  defaults: { vLL: 600, fla: 5, rpm: 1750, rDC: 1.6, accelMs: 1500, coastMs: 4000 },
  init: () => ({ speed: 0, state: 'stopped', rot: 0, dir: 'none' }),
  stamp(ctx) {
    const star = ctx.inner('star');
    for (let k = 1; k <= 3; k++) {
      if (k === 2 && ctx.faults.has('winding_open')) continue;
      const id = `${ctx.id}.w${k}`;
      if (ctx.mode === 'ohm') {
        ctx.net.resistor(id, ctx.node(`T${k}`), star, num(ctx.params.rDC, 1.6));
        continue;
      }
      const zRun = num(ctx.params.vLL, 600) / Math.sqrt(3) / num(ctx.params.fla, 5);
      const s = ctx.state.speed as number;
      const run = polar(zRun, 31.8); // pf 0.85
      const lr = polar(zRun / 6, 72.5); // pf 0.30
      const z: Complex = C(lr.re + (run.re - lr.re) * s, lr.im + (run.im - lr.im) * s);
      ctx.net.admittance(id, ctx.node(`T${k}`), star, div(C(1), z));
    }
  },
  integrate(ctx) {
    const vLL = num(ctx.params.vLL, 600);
    const v = [
      abs(ctx.sol.vab(ctx.node('T1'), ctx.node('T2'))),
      abs(ctx.sol.vab(ctx.node('T2'), ctx.node('T3'))),
      abs(ctx.sol.vab(ctx.node('T3'), ctx.node('T1'))),
    ];
    const winding = !ctx.faults.has('winding_open');
    const balanced = winding && v.every((x) => x > 0.7 * vLL);
    const any = v.some((x) => x > 0.3 * vLL);
    let s = ctx.state.speed as number;
    let rot = ctx.state.rot as number;
    if (balanced) {
      // Phase sequence decides the direction: positive sequence (V2 lags V1 by 120°) = forward.
      const v1 = ctx.sol.v(ctx.node('T1'));
      const v2 = ctx.sol.v(ctx.node('T2'));
      const seq = v1.re * v2.im - v1.im * v2.re < 0 ? 1 : -1;
      if (rot === 0 || s < 0.02) {
        rot = seq;
        s = Math.min(1, s + ctx.dt / num(ctx.params.accelMs, 1500));
        ctx.state.state = s >= 1 ? 'running' : 'starting';
      } else if (rot === seq) {
        s = Math.min(1, s + ctx.dt / num(ctx.params.accelMs, 1500));
        ctx.state.state = s >= 1 ? 'running' : 'starting';
      } else {
        // Reversed while turning: plugging (braking through zero before accelerating the other way).
        s = Math.max(0, s - ctx.dt / 600);
        ctx.state.state = 'plugging';
      }
    } else if (any) {
      s = Math.max(0, s - ctx.dt / 600);
      ctx.state.state = 'single_phasing';
    } else {
      s = Math.max(0, s - ctx.dt / num(ctx.params.coastMs, 4000));
      ctx.state.state = s > 0 ? 'coasting' : 'stopped';
    }
    ctx.state.speed = s;
    if (s <= 0 && !balanced) rot = 0;
    ctx.state.rot = rot;
    ctx.state.dir = s > 0.02 ? (rot > 0 ? 'fwd' : 'rev') : 'none';
  },
};

/** Control power transformer (CPT). */
const transformer: ComponentType = {
  parts: {
    main: { symbol: 'transformer', terminals: { H1: [0, 0], H2: [60, 0], X1: [0, 70], X2: [60, 70] } },
  },
  faults: ['primary_open'],
  defaults: { ratio: 5, rP: 24, rS: 0.9 },
  init: () => ({}),
  stamp(ctx) {
    const open = ctx.faults.has('primary_open');
    if (ctx.mode === 'ohm') {
      if (!open) ctx.net.resistor(`${ctx.id}.p`, ctx.node('H1'), ctx.node('H2'), num(ctx.params.rP, 24));
      ctx.net.resistor(`${ctx.id}.s`, ctx.node('X1'), ctx.node('X2'), num(ctx.params.rS, 0.9));
      return;
    }
    if (open) return;
    const p = ctx.inner('p');
    const s = ctx.inner('s');
    ctx.net.resistor(`${ctx.id}.rp`, ctx.node('H1'), p, num(ctx.params.rP, 24));
    // Magnetizing branch: without primary current there is no flux, hence no secondary voltage.
    ctx.net.resistor(`${ctx.id}.m`, p, ctx.node('H2'), num(ctx.params.rM, 30000));
    ctx.net.transformer(`${ctx.id}.x`, p, ctx.node('H2'), s, ctx.node('X2'), num(ctx.params.ratio, 5));
    ctx.net.resistor(`${ctx.id}.rs`, s, ctx.node('X1'), num(ctx.params.rS, 0.9));
  },
};

/** Push-button. `contact`: NO | NC. `kind`: momentary | mushroom (latching E-stop) | toggle (switch: each press flips it). */
const pushbutton: ComponentType = {
  parts: { main: TWO('1', '2', 'pushbutton') },
  faults: ['contact_open', 'welded'],
  defaults: { contact: 'NO', kind: 'momentary', color: 'green' },
  init: () => ({ pressed: false }),
  stamp(ctx) {
    const nc = ctx.params.contact === 'NC';
    const actuated = ctx.state.pressed === true;
    const closed = ctx.faults.has('welded') || (!ctx.faults.has('contact_open') && (nc ? !actuated : actuated));
    if (closed) ctx.net.resistor(ctx.id, ctx.node('1'), ctx.node('2'), R_CLOSED);
  },
  replaced: (ctx) => ({ pressed: ctx.state.pressed }),
};

/** Pilot light. Cold filament reads ~1/10 of hot resistance on an ohmmeter. */
const lamp: ComponentType = {
  parts: { main: TWO('X1', 'X2', 'lamp') },
  faults: ['burnt'],
  defaults: { v: 120, w: 6, color: 'green' },
  init: () => ({ lit: false }),
  stamp(ctx) {
    if (ctx.faults.has('burnt')) return;
    const v = num(ctx.params.v, 120);
    const r = (v * v) / num(ctx.params.w, 6);
    ctx.net.resistor(ctx.id, ctx.node('X1'), ctx.node('X2'), ctx.mode === 'ac' ? r : r / 10);
  },
  integrate(ctx) {
    ctx.state.lit =
      !ctx.faults.has('burnt') && abs(ctx.sol.vab(ctx.node('X1'), ctx.node('X2'))) > 0.6 * num(ctx.params.v, 120);
  },
};

/** 120 VAC discrete PLC input point (≈ 8 mA). */
const plc_input: ComponentType = {
  parts: { main: TWO('IN', 'COM', 'plc_input') },
  faults: ['dead'],
  defaults: { address: '%IX0.0', rIn: 15000 },
  init: () => ({ on: false }),
  stamp(ctx) {
    ctx.net.resistor(ctx.id, ctx.node('IN'), ctx.node('COM'), num(ctx.params.rIn, 15000));
  },
  switching(ctx) {
    const v = abs(ctx.sol.vab(ctx.node('IN'), ctx.node('COM')));
    const was = ctx.state.on === true;
    const now = !ctx.faults.has('dead') && (was ? v > 20 : v > 79);
    ctx.state.on = now;
    return false; // feeds the PLC, not the network
  },
};

/** Relay output point of a PLC (dry contact C–O). */
const plc_output: ComponentType = {
  parts: { main: TWO('C', 'O', 'plc_output') },
  faults: ['welded'],
  defaults: { address: '%QX0.0' },
  init: () => ({ closed: false }),
  stamp(ctx) {
    const closed = ctx.faults.has('welded') || ctx.plcOutputs[String(ctx.params.address)] === true;
    ctx.state.closed = closed;
    if (closed) ctx.net.resistor(ctx.id, ctx.node('C'), ctx.node('O'), R_CLOSED);
  },
};

/** Bond to ground / enclosure. */
const ground: ComponentType = {
  parts: { main: { symbol: 'ground', terminals: { G: [0, 0] } } },
  faults: [],
  init: () => ({}),
  stamp(ctx) {
    ctx.net.resistor(ctx.id, ctx.node('G'), GND, 0.001);
  },
};

/** Terminal block point / junction — a place for wires to meet and to probe. */
const terminal: ComponentType = {
  parts: { main: { symbol: 'terminal', terminals: { T: [0, 0] } } },
  faults: [],
  init: () => ({}),
  stamp(ctx) {
    ctx.net.touch(ctx.node('T'));
  },
};

export const LIBRARY: Record<string, ComponentType> = {
  source3, disconnect3, fuse, contactor, overload, motor3, transformer, pushbutton, lamp, plc_input, plc_output,
  ground, terminal,
};
