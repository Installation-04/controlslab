// SPDX-License-Identifier: AGPL-3.0-only
/**
 * IEC 61131-3 timers. Elapsed time is computed from the virtual clock, so
 * behaviour is deterministic and independent of wall-clock jitter.
 */
import { T } from '../types';
import type { FbInstance, NativeFbDef, RtContext } from './fb';

const params = [
  { name: 'IN', type: T.BOOL, dir: 'in' as const },
  { name: 'PT', type: T.TIME, dir: 'in' as const },
  { name: 'Q', type: T.BOOL, dir: 'out' as const },
  { name: 'ET', type: T.TIME, dir: 'out' as const },
];

abstract class TimerBase implements FbInstance {
  readonly __fb = true as const;
  abstract readonly typeName: string;
  vars: Record<string, boolean | number> = { IN: false, PT: 0, Q: false, ET: 0 };
  protected start = 0;
  protected running = false;
  protected prevIn = false;
  abstract execute(rt: RtContext): void;
}

/** On-delay: Q goes TRUE once IN has been TRUE for PT. */
class Ton extends TimerBase {
  readonly typeName = 'TON';
  execute(rt: RtContext): void {
    const v = this.vars;
    const pt = Math.max(0, v.PT as number);
    if (!v.IN) {
      this.running = false;
      v.Q = false;
      v.ET = 0;
    } else {
      if (!this.running) {
        this.running = true;
        this.start = rt.now;
      }
      const et = Math.min(rt.now - this.start, pt);
      v.ET = et;
      v.Q = et >= pt;
    }
  }
}

/** Off-delay: Q follows IN up, stays TRUE for PT after IN falls. */
class Tof extends TimerBase {
  readonly typeName = 'TOF';
  execute(rt: RtContext): void {
    const v = this.vars;
    const pt = Math.max(0, v.PT as number);
    if (v.IN) {
      this.running = false;
      v.Q = true;
      v.ET = 0;
    } else {
      if (this.prevIn) {
        this.running = true;
        this.start = rt.now;
      }
      if (this.running) {
        const et = Math.min(rt.now - this.start, pt);
        v.ET = et;
        if (et >= pt) {
          v.Q = false;
          this.running = false;
        }
      }
    }
    this.prevIn = v.IN as boolean;
  }
}

/** Pulse: rising edge on IN gives a PT-long pulse, not retriggerable. */
class Tp extends TimerBase {
  readonly typeName = 'TP';
  execute(rt: RtContext): void {
    const v = this.vars;
    const pt = Math.max(0, v.PT as number);
    if (v.IN && !this.prevIn && !this.running && v.ET === 0) {
      this.running = true;
      this.start = rt.now;
    }
    if (this.running) {
      const et = Math.min(rt.now - this.start, pt);
      v.ET = et;
      if (et >= pt) {
        this.running = false;
        v.Q = false;
      } else v.Q = true;
    }
    if (!this.running && !v.IN) v.ET = 0;
    this.prevIn = v.IN as boolean;
  }
}

export const TIMERS: NativeFbDef[] = [
  { name: 'TON', params, create: () => new Ton() },
  { name: 'TOF', params, create: () => new Tof() },
  { name: 'TP', params, create: () => new Tp() },
];
