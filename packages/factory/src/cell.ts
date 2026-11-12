// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A cell couples three simulations:
 *   PLC (ST program)  ⇄  panel circuit (Machine: pushbuttons, contactor, motor…)  ⇄  factory (belts, items, sensors)
 *
 * `step()` is pure with respect to the PLC: the caller provides the latest PLC
 * outputs and gets the inputs to feed back, so the same core serves the
 * browser (PLC in a Web Worker) and the synchronous test runner.
 */
import { PlcRuntime } from '@controlslab/plc-engine';
import { Machine, type MachineDef } from '@controlslab/sim';
import { FactorySim } from './sim';
import { resolveParams, type EntityDef } from './types';

export interface CellOptions {
  entities: EntityDef[];
  /** Available panel definitions by machine id. */
  machines: Record<string, MachineDef>;
  /** Faults injected into the panel at start. */
  faults?: string[];
}

export class CellCore {
  readonly factory: FactorySim;
  readonly machine: Machine | null;
  readonly panelEntity: EntityDef | undefined;
  private readonly motorId: string | undefined;

  constructor(opts: CellOptions) {
    this.factory = new FactorySim(opts.entities);
    this.panelEntity = opts.entities.find((e) => e.type === 'panel');
    const def = this.panelEntity ? opts.machines[String(resolveParams(this.panelEntity).machine)] : undefined;
    this.machine = def ? new Machine(structuredClone(def)) : null;
    this.motorId = def?.components.find((c) => c.type === 'motor3')?.id;
    for (const f of opts.faults ?? []) this.machine?.injectFault(f);
  }

  /** Current motor speed 0..1 (0 when no panel). */
  get motorSpeed(): number {
    return this.machine && this.motorId ? this.machine.state<{ speed: number }>(this.motorId).speed : 0;
  }

  /** Advance everything by dtMs and return all PLC inputs. */
  step(dtMs: number, plcOutputs: Record<string, boolean | number>): Record<string, boolean> {
    this.machine?.setPlcOutputs(plcOutputs);
    this.machine?.tick(dtMs);
    for (const e of this.factory.entities) {
      if (e.type === 'conveyor' && resolveParams(e).drive === 'panel') {
        this.factory.setExternalDrive(e.id, this.motorSpeed > 0.05 ? this.motorSpeed : 0);
      }
    }
    this.factory.step(dtMs, plcOutputs);
    return { ...(this.machine?.getPlcInputs() ?? {}), ...this.factory.readInputs() };
  }
}

// ---------- Synchronous runner (tests, work-order checker) ----------
export type CellStep =
  | { run: number }
  | { press: string }
  | { release: string }
  | { panelPress: string }
  | { panelRelease: string }
  | { inject: string }
  | { expectBin: { bin: string; kind?: 'plastic' | 'metal' | 'cardboard'; min?: number; max?: number }; msg?: string }
  | { expectInput: { address: string; equals: boolean }; msg?: string }
  | { expectOutput: { address: string; equals: boolean }; msg?: string }
  | { expectBelt: { id: string; running: boolean }; msg?: string }
  | { expectLost: { max: number }; msg?: string };

export interface CellRunResult {
  pass: boolean;
  failures: string[];
  loadError?: string;
}

export class CellRunner {
  readonly core: CellCore;
  readonly plc = new PlcRuntime({ scanMs: 10 });
  private inputs: Record<string, boolean> = {};
  loadError?: string;

  constructor(opts: CellOptions, source: string) {
    this.core = new CellCore(opts);
    const r = this.plc.load(source);
    if (r.ok) this.plc.start();
    else this.loadError = r.errors[0]?.message;
  }

  /** Simulated time, ms. PLC scans every 10 ms, the cell every 20 ms. */
  run(ms: number) {
    for (let t = 0; t < ms; t += 20) {
      this.plc.setInputs(this.inputs);
      this.plc.scan();
      this.plc.scan();
      this.inputs = this.core.step(20, this.plc.getOutputs());
    }
  }

  playScript(steps: CellStep[]): CellRunResult {
    if (this.loadError) return { pass: false, failures: [], loadError: this.loadError };
    const failures: string[] = [];
    const fail = (m: string | undefined, fallback: string) => failures.push(m ?? fallback);
    this.run(100);
    for (const [i, step] of steps.entries()) {
      const n = `étape ${i + 1}`;
      if ('run' in step) this.run(step.run);
      else if ('press' in step) this.core.factory.press(step.press);
      else if ('release' in step) this.core.factory.release(step.release);
      else if ('panelPress' in step) this.core.machine?.press(step.panelPress);
      else if ('panelRelease' in step) this.core.machine?.release(step.panelRelease);
      else if ('inject' in step) this.core.machine?.injectFault(step.inject);
      else if ('expectBin' in step) {
        const { bin, kind, min, max } = step.expectBin;
        const v = this.core.factory.total(bin, kind);
        if ((min !== undefined && v < min) || (max !== undefined && v > max)) {
          fail(step.msg, `${n} : bac ${bin}${kind ? ` (${kind})` : ''} = ${v} (attendu ${min ?? 0}…${max ?? '∞'})`);
        }
      } else if ('expectInput' in step) {
        const v = !!this.inputs[step.expectInput.address.toUpperCase()];
        if (v !== step.expectInput.equals) fail(step.msg, `${n} : entrée ${step.expectInput.address} = ${v}`);
      } else if ('expectOutput' in step) {
        const v = !!this.plc.getOutput(step.expectOutput.address);
        if (v !== step.expectOutput.equals) fail(step.msg, `${n} : sortie ${step.expectOutput.address} = ${v}`);
      } else if ('expectBelt' in step) {
        const running = Math.abs(this.core.factory.belt[step.expectBelt.id] ?? 0) > 0.05;
        if (running !== step.expectBelt.running) fail(step.msg, `${n} : convoyeur ${step.expectBelt.id} ${running ? 'en marche' : 'arrêté'}`);
      } else if ('expectLost' in step) {
        if (this.core.factory.lost > step.expectLost.max) fail(step.msg, `${n} : ${this.core.factory.lost} boîte(s) tombée(s) au sol`);
      }
    }
    return { pass: failures.length === 0, failures };
  }
}
