// SPDX-License-Identifier: AGPL-3.0-only
import { BISTABLES } from './bistables';
import { COUNTERS } from './counters';
import type { NativeFbDef } from './fb';
import { TIMERS } from './timers';

export const NATIVE_FBS = new Map<string, NativeFbDef>(
  [...TIMERS, ...COUNTERS, ...BISTABLES].map((d) => [d.name, d]),
);
export { FUNCTIONS, lookupConversion, type StdFunction } from './functions';
export type { FbInstance, FbParam, NativeFbDef, RtContext } from './fb';
