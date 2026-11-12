// SPDX-License-Identifier: AGPL-3.0-only
/** Couples a virtual PLC to a virtual machine: inputs ← field devices, outputs → coils/lamps. */
import { PlcRuntime } from '@controlslab/plc-engine';
import { Machine } from '@controlslab/sim';

export class CoSim {
  readonly plc: PlcRuntime;
  constructor(
    readonly machine: Machine,
    readonly scanMs = 10,
    /** Machine solve period (ms): coarser than the PLC scan because the circuit solve is costly. */
    readonly machineMs = 20,
  ) {
    this.plc = new PlcRuntime({ scanMs });
  }

  load(source: string) {
    const r = this.plc.load(source);
    if (r.ok) this.plc.start();
    return r;
  }

  run(ms: number) {
    let sinceMachine = 0;
    for (let t = 0; t < ms; t += this.scanMs) {
      this.plc.setInputs(this.machine.getPlcInputs());
      this.plc.scan();
      this.machine.setPlcOutputs(this.plc.getOutputs());
      sinceMachine += this.scanMs;
      if (sinceMachine >= this.machineMs) {
        this.machine.tick(sinceMachine);
        sinceMachine = 0;
      }
    }
  }
}
