// SPDX-License-Identifier: AGPL-3.0-only
/** Message protocol between the UI thread and the PLC Web Worker. */
import type { IoPoint } from './compiler';
import type { PlcErrorInfo } from './errors';
import type { IoValue, PlcMode } from './runtime';

export type WorkerRequest =
  | { type: 'load'; source: string }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'step'; scans?: number }
  | { type: 'setInputs'; values: Record<string, IoValue> }
  | { type: 'config'; realtime: boolean };

export interface PlcStatus {
  mode: PlcMode;
  now: number;
  scanCount: number;
  outputs: Record<string, IoValue>;
  vars: Record<string, unknown>;
  fault?: PlcErrorInfo;
}

export type WorkerResponse =
  | { type: 'loaded'; ok: boolean; errors: PlcErrorInfo[]; ioPoints: IoPoint[] }
  | { type: 'status'; status: PlcStatus };
