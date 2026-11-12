// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Modified Nodal Analysis with complex phasors.
 * Unknowns: node voltages (except ground) + one current per voltage source
 * / ideal transformer. A tiny conductance (GMIN) from every node to ground
 * keeps isolated islands solvable (they float to ~0 V, like a de-energized
 * conductor measured with a high-impedance meter).
 */
import { C, ZERO, abs, add, div, mul, sub, type Complex } from './complex';

export const GND = 'GND';
const GMIN = 1e-9;

type Stamp =
  | { kind: 'y'; a: string; b: string; y: Complex; id: string }
  | { kind: 'v'; a: string; b: string; v: Complex; id: string }
  | { kind: 'xfmr'; p1: string; p2: string; s1: string; s2: string; ratio: number; id: string }
  | { kind: 'i'; a: string; b: string; i: Complex; id: string };

export class Network {
  private readonly stamps: Stamp[] = [];
  private readonly nodes = new Map<string, number>();

  private node(n: string): number {
    if (n === GND) return -1;
    let i = this.nodes.get(n);
    if (i === undefined) {
      i = this.nodes.size;
      this.nodes.set(n, i);
    }
    return i;
  }

  /** Ensure a node exists even if nothing is connected (so it can be probed). */
  touch(n: string) {
    this.node(n);
  }

  resistor(id: string, a: string, b: string, ohms: number) {
    this.admittance(id, a, b, C(1 / Math.max(ohms, 1e-6)));
  }

  admittance(id: string, a: string, b: string, y: Complex) {
    this.node(a);
    this.node(b);
    this.stamps.push({ kind: 'y', a, b, y, id });
  }

  /** Voltage source: V(a) - V(b) = v. */
  vsource(id: string, a: string, b: string, v: Complex) {
    this.node(a);
    this.node(b);
    this.stamps.push({ kind: 'v', a, b, v, id });
  }

  /** Current source pushing `i` from a to b through the external circuit (enters node b... leaves a). */
  isource(id: string, a: string, b: string, i: Complex) {
    this.node(a);
    this.node(b);
    this.stamps.push({ kind: 'i', a, b, i, id });
  }

  /** Ideal transformer: V(p1,p2) = ratio · V(s1,s2). */
  transformer(id: string, p1: string, p2: string, s1: string, s2: string, ratio: number) {
    for (const n of [p1, p2, s1, s2]) this.node(n);
    this.stamps.push({ kind: 'xfmr', p1, p2, s1, s2, ratio, id });
  }

  solve(): Solution {
    const n = this.nodes.size;
    const extras = this.stamps.filter((s) => s.kind === 'v' || s.kind === 'xfmr');
    const size = n + extras.length;
    const A: Complex[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => ZERO));
    const z: Complex[] = Array.from({ length: size }, () => ZERO);
    const addA = (r: number, c: number, v: Complex) => {
      if (r >= 0 && c >= 0) A[r]![c] = add(A[r]![c]!, v);
    };
    for (let i = 0; i < n; i++) addA(i, i, C(GMIN));
    let k = n;
    const extraIndex = new Map<string, number>();
    for (const s of this.stamps) {
      switch (s.kind) {
        case 'y': {
          const a = this.node(s.a);
          const b = this.node(s.b);
          addA(a, a, s.y);
          addA(b, b, s.y);
          addA(a, b, C(-s.y.re, -s.y.im));
          addA(b, a, C(-s.y.re, -s.y.im));
          break;
        }
        case 'i': {
          const a = this.node(s.a);
          const b = this.node(s.b);
          if (a >= 0) z[a] = sub(z[a]!, s.i);
          if (b >= 0) z[b] = add(z[b]!, s.i);
          break;
        }
        case 'v': {
          const a = this.node(s.a);
          const b = this.node(s.b);
          addA(a, k, C(1));
          addA(b, k, C(-1));
          addA(k, a, C(1));
          addA(k, b, C(-1));
          z[k] = s.v;
          extraIndex.set(s.id, k);
          k++;
          break;
        }
        case 'xfmr': {
          const p1 = this.node(s.p1);
          const p2 = this.node(s.p2);
          const s1 = this.node(s.s1);
          const s2 = this.node(s.s2);
          const r = s.ratio;
          // Branch current I (entering s1). Primary current entering p1 = -I / r.
          addA(s1, k, C(1));
          addA(s2, k, C(-1));
          addA(p1, k, C(-1 / r));
          addA(p2, k, C(1 / r));
          // V(p1) - V(p2) - r (V(s1) - V(s2)) = 0
          addA(k, p1, C(1));
          addA(k, p2, C(-1));
          addA(k, s1, C(-r));
          addA(k, s2, C(r));
          extraIndex.set(s.id, k);
          k++;
          break;
        }
      }
    }
    const x = gaussSolve(A, z);
    return new Solution(this.nodes, x, this.stamps, extraIndex);
  }
}

/** Gaussian elimination with partial pivoting (complex). */
export function gaussSolve(A: Complex[][], b: Complex[]): Complex[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = abs(M[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = abs(M[r]![col]!);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-18) throw new Error('Singular circuit matrix');
    if (piv !== col) [M[col], M[piv]] = [M[piv]!, M[col]!];
    const pr = M[col]!;
    for (let r = col + 1; r < n; r++) {
      const row = M[r]!;
      if (row[col]!.re === 0 && row[col]!.im === 0) continue;
      const f = div(row[col]!, pr[col]!);
      for (let c = col; c <= n; c++) row[c] = sub(row[c]!, mul(f, pr[c]!));
    }
  }
  const x: Complex[] = Array.from({ length: n }, () => ZERO);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let c = r + 1; c < n; c++) s = sub(s, mul(M[r]![c]!, x[c]!));
    x[r] = div(s, M[r]![r]!);
  }
  return x;
}

export class Solution {
  constructor(
    private readonly nodes: Map<string, number>,
    private readonly x: Complex[],
    private readonly stamps: Stamp[],
    private readonly extra: Map<string, number>,
  ) {}

  v(node: string): Complex {
    if (node === GND) return ZERO;
    const i = this.nodes.get(node);
    return i === undefined ? ZERO : this.x[i]!;
  }

  /** Phasor voltage V(a) − V(b). */
  vab(a: string, b: string): Complex {
    return sub(this.v(a), this.v(b));
  }

  /** Current through an admittance element, from a to b. */
  current(id: string): Complex {
    const s = this.stamps.find((x) => x.id === id);
    if (!s) return ZERO;
    if (s.kind === 'y') return mul(s.y, this.vab(s.a, s.b));
    const k = this.extra.get(id);
    return k === undefined ? ZERO : this.x[k]!;
  }
}
