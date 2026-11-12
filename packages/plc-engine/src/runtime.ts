// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PLC runtime: fixed scan cycle on a virtual clock.
 *
 *   ┌ read input image (%I) ← values set by the machine/sim
 *   ├ execute all PROGRAMs
 *   └ write output image (%Q) → read by the machine/sim
 *
 * The clock only advances when `scan()` is called, so tests and the
 * simulator are fully deterministic.
 */
import { compile, type CompiledProgram, type IoPoint, type SymbolInfo } from './compiler';
import { PlcError, type PlcErrorInfo } from './errors';
import { normalizeAddress } from './lexer';
import { parse } from './parser';
import type { Value } from './types';

export type PlcMode = 'empty' | 'stopped' | 'running' | 'faulted';

export interface RuntimeOptions {
  /** Scan period in ms (virtual time added per scan). Default 10. */
  scanMs?: number;
  /** Max statement executions per scan before watchdog fault. */
  watchdogOps?: number;
}

export interface LoadResult {
  ok: boolean;
  errors: PlcErrorInfo[];
  ioPoints: IoPoint[];
}

export type IoValue = boolean | number;

export class PlcRuntime {
  readonly scanMs: number;
  private readonly watchdogOps: number;
  private prog: CompiledProgram | undefined;
  private inputs: Record<string, IoValue> = {};
  private _mode: PlcMode = 'empty';
  private _fault: PlcErrorInfo | undefined;
  private _scanCount = 0;

  constructor(opts: RuntimeOptions = {}) {
    this.scanMs = opts.scanMs ?? 10;
    this.watchdogOps = opts.watchdogOps ?? 200_000;
  }

  get mode(): PlcMode {
    return this._mode;
  }
  get fault(): PlcErrorInfo | undefined {
    return this._fault;
  }
  get scanCount(): number {
    return this._scanCount;
  }
  get now(): number {
    return this.prog?.rt.now ?? 0;
  }

  /** Parse + compile. On success the PLC is in STOP with initial values. */
  load(source: string): LoadResult {
    try {
      this.prog = compile(parse(source), { watchdogOps: this.watchdogOps });
      this._mode = 'stopped';
      this._fault = undefined;
      this._scanCount = 0;
      this.applyInputs();
      return { ok: true, errors: [], ioPoints: this.prog.ioPoints };
    } catch (e) {
      if (e instanceof PlcError) return { ok: false, errors: [e.toJSON()], ioPoints: [] };
      throw e;
    }
  }

  get ioPoints(): IoPoint[] {
    return this.prog?.ioPoints ?? [];
  }

  start(): void {
    if (this._mode === 'stopped') this._mode = 'running';
  }

  /** Go to STOP. Outputs are de-energized (like a real PLC going to program mode). */
  stop(): void {
    if (this._mode === 'running') this._mode = 'stopped';
  }

  /** Cold restart: reset all variables, clear fault, stay in STOP. */
  reset(): void {
    if (!this.prog) return;
    this.prog.reset();
    this._fault = undefined;
    this._mode = 'stopped';
    this._scanCount = 0;
    this.applyInputs();
  }

  setInput(address: string, value: IoValue): void {
    const a = normalizeAddress(address);
    if (a[1] !== 'I') throw new Error(`Not an input address: ${address}`);
    this.inputs[a] = value;
  }

  setInputs(values: Record<string, IoValue>): void {
    for (const [k, v] of Object.entries(values)) this.setInput(k, v);
  }

  private applyInputs() {
    if (!this.prog) return;
    for (const [a, v] of Object.entries(this.inputs)) this.prog.io[a] = v;
  }

  /** One scan. Returns false if not running. */
  scan(): boolean {
    if (!this.prog || this._mode !== 'running') return false;
    const prog = this.prog;
    prog.rt.now += this.scanMs;
    this.applyInputs();
    try {
      prog.run();
      this._scanCount++;
      return true;
    } catch (e) {
      if (e instanceof PlcError) {
        this._mode = 'faulted';
        this._fault = e.toJSON();
        return false;
      }
      throw e;
    }
  }

  /** Run scans covering `ms` of virtual time. */
  runFor(ms: number): void {
    const n = Math.max(1, Math.round(ms / this.scanMs));
    for (let i = 0; i < n && this._mode === 'running'; i++) this.scan();
  }

  /** Output image. All outputs read FALSE/0 unless RUNNING (safe state). */
  getOutputs(): Record<string, IoValue> {
    const out: Record<string, IoValue> = {};
    if (!this.prog) return out;
    for (const [a, v] of Object.entries(this.prog.io)) {
      if (a[1] !== 'Q') continue;
      out[a] = this._mode === 'running' ? (v as IoValue) : typeof v === 'boolean' ? false : 0;
    }
    for (const p of this.prog.ioPoints) {
      if (p.area === 'Q' && !(p.address in out)) out[p.address] = p.type === 'BOOL' ? false : 0;
    }
    return out;
  }

  getOutput(address: string): IoValue {
    return this.getOutputs()[normalizeAddress(address)] ?? false;
  }

  read(path: string): Value | undefined {
    return this.prog?.read(path);
  }

  symbols(): SymbolInfo[] {
    return this.prog?.symbols() ?? [];
  }

  /** Flat snapshot of all watchable symbols (for watch tables / UI). */
  snapshot(): Record<string, Value | undefined> {
    const out: Record<string, Value | undefined> = {};
    for (const s of this.symbols()) {
      const v = this.read(s.path);
      out[s.path] = Array.isArray(v) ? [...v] : v;
    }
    return out;
  }
}
