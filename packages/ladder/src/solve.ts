// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Power-flow solver for display: given the current values of the variables,
 * compute which contacts are closed and where "power" flows. Execution itself is
 * done by the ST engine (via `toST`); this only draws what the PLC is doing.
 */
import type { CmpOp, LogicNode, Rung } from './types';

export type Read = (name: string) => boolean | number | string | undefined;

export interface Flow {
  /** Power entering the node. */
  in: boolean;
  /** Power leaving the node. */
  out: boolean;
  /** For leaves: is the element itself conducting? */
  closed?: boolean;
}

const truthy = (v: ReturnType<Read>) => v === true || (typeof v === 'number' && v !== 0);
const num = (v: ReturnType<Read>) => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? v : Number(v));

const CMP: Record<CmpOp, (a: number, b: number) => boolean> = {
  '=': (a, b) => a === b,
  '<>': (a, b) => a !== b,
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
};

/** Resolve a literal or variable name to a number. */
function value(s: string, read: Read): number {
  const t = s.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return num(read(t));
}

export interface EdgeState {
  /** Previous value of each edge contact's variable, keyed by node id (maintained by the caller across calls). */
  prev: Map<string, boolean>;
}

/** Evaluate a logic tree; fills `flows` with the state of every node. */
export function solveNode(n: LogicNode, powerIn: boolean, read: Read, flows: Map<string, Flow>, edges?: EdgeState): boolean {
  switch (n.t) {
    case 'contact': {
      const cur = truthy(read(n.v));
      let closed: boolean;
      if (n.k === 'NO') closed = cur;
      else if (n.k === 'NC') closed = !cur;
      else {
        const prev = edges?.prev.get(n.id) ?? false; // like R_TRIG/F_TRIG: memory starts FALSE
        closed = n.k === 'P' ? cur && !prev : !cur && prev;
        edges?.prev.set(n.id, cur);
      }
      const out = powerIn && closed;
      flows.set(n.id, { in: powerIn, out, closed });
      return out;
    }
    case 'cmp': {
      const closed = CMP[n.op](value(n.a, read), value(n.b, read));
      const out = powerIn && closed;
      flows.set(n.id, { in: powerIn, out, closed });
      return out;
    }
    case 'series': {
      let p = powerIn;
      for (const c of n.items) p = solveNode(c, p, read, flows, edges);
      flows.set(n.id, { in: powerIn, out: p });
      return p;
    }
    case 'parallel': {
      let any = false;
      for (const c of n.items) any = solveNode(c, powerIn, read, flows, edges) || any;
      flows.set(n.id, { in: powerIn, out: any });
      return any;
    }
  }
}

export interface RungFlow {
  flows: Map<string, Flow>;
  /** Power arriving at the outputs. */
  power: boolean;
}

export function solveRung(r: Rung, read: Read, edges?: EdgeState): RungFlow {
  const flows = new Map<string, Flow>();
  const power = r.logic ? solveNode(r.logic, true, read, flows, edges) : true;
  return { flows, power };
}
