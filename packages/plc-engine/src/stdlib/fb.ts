// SPDX-License-Identifier: AGPL-3.0-only
import type { PlcType, Value } from '../types';

/** Runtime context shared by all FB instances of a loaded program. */
export interface RtContext {
  /** Virtual PLC clock, ms. Advanced by the runtime once per scan. */
  now: number;
}

/** Any FB instance (native or user-defined). `vars` keys are upper-case. */
export interface FbInstance {
  readonly __fb: true;
  readonly typeName: string;
  vars: Record<string, Value>;
  execute(rt: RtContext): void;
}

export interface FbParam {
  name: string;
  type: PlcType;
  dir: 'in' | 'out' | 'inout' | 'local';
}

export interface NativeFbDef {
  name: string;
  params: FbParam[];
  create(): FbInstance;
}
