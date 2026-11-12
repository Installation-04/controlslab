// SPDX-License-Identifier: AGPL-3.0-only
/** IEC counters (CTU/CTD/CTUD) — count on rising edges, INT range. */
import { T } from '../types';
import type { FbInstance, NativeFbDef } from './fb';

const MAX = 32767;
const MIN = -32768;

class Ctu implements FbInstance {
  readonly __fb = true as const;
  readonly typeName = 'CTU';
  vars: Record<string, boolean | number> = { CU: false, R: false, PV: 0, Q: false, CV: 0 };
  private prev = false;
  execute(): void {
    const v = this.vars;
    if (v.R) v.CV = 0;
    else if (v.CU && !this.prev && (v.CV as number) < MAX) v.CV = (v.CV as number) + 1;
    this.prev = v.CU as boolean;
    v.Q = (v.CV as number) >= (v.PV as number);
  }
}

class Ctd implements FbInstance {
  readonly __fb = true as const;
  readonly typeName = 'CTD';
  vars: Record<string, boolean | number> = { CD: false, LD: false, PV: 0, Q: false, CV: 0 };
  private prev = false;
  execute(): void {
    const v = this.vars;
    if (v.LD) v.CV = v.PV as number;
    else if (v.CD && !this.prev && (v.CV as number) > MIN) v.CV = (v.CV as number) - 1;
    this.prev = v.CD as boolean;
    v.Q = (v.CV as number) <= 0;
  }
}

class Ctud implements FbInstance {
  readonly __fb = true as const;
  readonly typeName = 'CTUD';
  vars: Record<string, boolean | number> = {
    CU: false, CD: false, R: false, LD: false, PV: 0, QU: false, QD: false, CV: 0,
  };
  private prevU = false;
  private prevD = false;
  execute(): void {
    const v = this.vars;
    const up = (v.CU as boolean) && !this.prevU;
    const down = (v.CD as boolean) && !this.prevD;
    if (v.R) v.CV = 0;
    else if (v.LD) v.CV = v.PV as number;
    else if (up && !down && (v.CV as number) < MAX) v.CV = (v.CV as number) + 1;
    else if (down && !up && (v.CV as number) > MIN) v.CV = (v.CV as number) - 1;
    this.prevU = v.CU as boolean;
    this.prevD = v.CD as boolean;
    v.QU = (v.CV as number) >= (v.PV as number);
    v.QD = (v.CV as number) <= 0;
  }
}

const B = T.BOOL;
const I = T.INT;
export const COUNTERS: NativeFbDef[] = [
  {
    name: 'CTU',
    params: [
      { name: 'CU', type: B, dir: 'in' }, { name: 'R', type: B, dir: 'in' }, { name: 'PV', type: I, dir: 'in' },
      { name: 'Q', type: B, dir: 'out' }, { name: 'CV', type: I, dir: 'out' },
    ],
    create: () => new Ctu(),
  },
  {
    name: 'CTD',
    params: [
      { name: 'CD', type: B, dir: 'in' }, { name: 'LD', type: B, dir: 'in' }, { name: 'PV', type: I, dir: 'in' },
      { name: 'Q', type: B, dir: 'out' }, { name: 'CV', type: I, dir: 'out' },
    ],
    create: () => new Ctd(),
  },
  {
    name: 'CTUD',
    params: [
      { name: 'CU', type: B, dir: 'in' }, { name: 'CD', type: B, dir: 'in' }, { name: 'R', type: B, dir: 'in' },
      { name: 'LD', type: B, dir: 'in' }, { name: 'PV', type: I, dir: 'in' },
      { name: 'QU', type: B, dir: 'out' }, { name: 'QD', type: B, dir: 'out' }, { name: 'CV', type: I, dir: 'out' },
    ],
    create: () => new Ctud(),
  },
];
