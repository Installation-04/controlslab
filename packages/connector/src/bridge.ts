// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Maps PLC process-image addresses to Modbus tables.
 *   %IXb.p  (field → PLC)  ⇄ discrete input  #(8·b + p)   read-only for the external PLC
 *   %QXb.p  (PLC → field)  ⇄ coil            #(8·b + p)   written by the external PLC
 * The external PLC is the Modbus *client*: it reads what the machine senses and writes what it commands.
 */
import { ModbusTables, TABLE_SIZE } from './modbus';

const ADDR = /^%([IQ])X(\d+)\.([0-7])$/i;

export function addressToIndex(addr: string): { area: 'I' | 'Q'; index: number } | null {
  const m = ADDR.exec(addr.trim());
  if (!m) return null;
  const index = Number(m[2]) * 8 + Number(m[3]);
  return index < TABLE_SIZE ? { area: m[1]!.toUpperCase() as 'I' | 'Q', index } : null;
}

export const indexToAddress = (area: 'I' | 'Q', index: number) => `%${area}X${index >> 3}.${index & 7}`;

export type Outputs = Record<string, boolean>;

export class Bridge {
  readonly tables = new ModbusTables();
  /** Coil values last reported to the browser (for change detection). */
  private reported = new Uint8Array(TABLE_SIZE);
  onOutputs?: (changed: Outputs) => void;

  constructor() {
    this.tables.onWrite = (kind, start, count) => {
      if (kind !== 'coils') return;
      const changed: Outputs = {};
      for (let i = start; i < start + count; i++) {
        if (this.tables.coils[i] !== this.reported[i]) {
          this.reported[i] = this.tables.coils[i]!;
          changed[indexToAddress('Q', i)] = !!this.tables.coils[i];
        }
      }
      if (Object.keys(changed).length) this.onOutputs?.(changed);
    };
  }

  /** Field state from the browser. Unknown or malformed addresses are ignored (returned for logging). */
  setInputs(values: Record<string, unknown>): string[] {
    const ignored: string[] = [];
    for (const [addr, v] of Object.entries(values)) {
      const a = addressToIndex(addr);
      if (!a || a.area !== 'I' || typeof v !== 'boolean') ignored.push(addr);
      else this.tables.discreteInputs[a.index] = v ? 1 : 0;
    }
    return ignored;
  }

  /** All coils that are ON (full state, sent to a browser when it connects). */
  outputsSnapshot(): Outputs {
    const out: Outputs = {};
    for (let i = 0; i < TABLE_SIZE; i++) if (this.tables.coils[i]) out[indexToAddress('Q', i)] = true;
    return out;
  }

  /** Browser disconnected or machine reset: de-energize every output. */
  clearOutputs(): Outputs {
    const changed: Outputs = {};
    for (let i = 0; i < TABLE_SIZE; i++)
      if (this.tables.coils[i]) {
        this.tables.coils[i] = 0;
        this.reported[i] = 0;
        changed[indexToAddress('Q', i)] = false;
      }
    return changed;
  }
}
