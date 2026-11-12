// SPDX-License-Identifier: AGPL-3.0-only
/** Edge detection (R_TRIG/F_TRIG) and bistables (SR set-dominant, RS reset-dominant). */
import { T } from '../types';
import type { FbInstance, NativeFbDef } from './fb';

class RTrig implements FbInstance {
  readonly __fb = true as const;
  readonly typeName = 'R_TRIG';
  vars: Record<string, boolean> = { CLK: false, Q: false };
  private m = false;
  execute(): void {
    this.vars.Q = this.vars.CLK! && !this.m;
    this.m = this.vars.CLK!;
  }
}

class FTrig implements FbInstance {
  readonly __fb = true as const;
  readonly typeName = 'F_TRIG';
  vars: Record<string, boolean> = { CLK: false, Q: false };
  private m = false;
  execute(): void {
    this.vars.Q = !this.vars.CLK! && this.m;
    this.m = this.vars.CLK!;
  }
}

class Sr implements FbInstance {
  readonly __fb = true as const;
  readonly typeName = 'SR';
  vars: Record<string, boolean> = { S1: false, R: false, Q1: false };
  execute(): void {
    const v = this.vars;
    v.Q1 = v.S1! || (!v.R! && v.Q1!);
  }
}

class Rs implements FbInstance {
  readonly __fb = true as const;
  readonly typeName = 'RS';
  vars: Record<string, boolean> = { S: false, R1: false, Q1: false };
  execute(): void {
    const v = this.vars;
    v.Q1 = !v.R1! && (v.S! || v.Q1!);
  }
}

const B = T.BOOL;
export const BISTABLES: NativeFbDef[] = [
  { name: 'R_TRIG', params: [{ name: 'CLK', type: B, dir: 'in' }, { name: 'Q', type: B, dir: 'out' }], create: () => new RTrig() },
  { name: 'F_TRIG', params: [{ name: 'CLK', type: B, dir: 'in' }, { name: 'Q', type: B, dir: 'out' }], create: () => new FTrig() },
  {
    name: 'SR',
    params: [{ name: 'S1', type: B, dir: 'in' }, { name: 'R', type: B, dir: 'in' }, { name: 'Q1', type: B, dir: 'out' }],
    create: () => new Sr(),
  },
  {
    name: 'RS',
    params: [{ name: 'S', type: B, dir: 'in' }, { name: 'R1', type: B, dir: 'in' }, { name: 'Q1', type: B, dir: 'out' }],
    create: () => new Rs(),
  },
];
