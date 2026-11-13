// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live lab session: owns a Machine (ticked in real time) and, for PLC
 * machines, a Web Worker running the ST program. Field inputs are pushed to
 * the worker; its outputs are applied to the machine.
 */
import type { PlcErrorInfo, PlcStatus, WorkerResponse, IoPoint } from '@controlslab/plc-engine';
import { Machine, type MachineDef } from '@controlslab/sim';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useExternalPlc, type ExternalPlc } from '../plc/external';

const TICK_MS = 50;

export interface PlcView {
  status: PlcStatus | null;
  errors: PlcErrorInfo[];
  loaded: boolean;
  ioPoints: IoPoint[];
}

export interface LabApi {
  machine: Machine;
  /** Bumps after every refresh so React re-renders. */
  rev: number;
  refresh(): void;
  plc: PlcView;
  loadProgram(source: string): void;
  plcCommand(type: 'start' | 'stop' | 'reset'): void;
  restart(): void;
  /** External PLC (Modbus TCP) selector/state. */
  external: ExternalPlc;
}

export function useLab(def: MachineDef | undefined, setup?: (m: Machine) => void): LabApi | null {
  const [instance, setInstance] = useState<{ m: Machine; n: number } | null>(null);
  const [rev, setRev] = useState(0);
  const [plc, setPlc] = useState<PlcView>({ status: null, errors: [], loaded: false, ioPoints: [] });
  const workerRef = useRef<Worker | null>(null);
  const lastInputs = useRef('');
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const [gen, setGen] = useState(0);
  const external = useExternalPlc();
  const extRef = useRef(external);
  extRef.current = external;

  // (Re)create the machine when the definition changes or on restart.
  useEffect(() => {
    if (!def) return setInstance(null);
    const m = new Machine(structuredClone(def));
    setupRef.current?.(m);
    setInstance({ m, n: gen });
    setPlc({ status: null, errors: [], loaded: false, ioPoints: [] });
    lastInputs.current = '';
  }, [def, gen]);

  const machine = instance?.m;
  const isPlc = machine?.def.mode === 'plc';

  // PLC worker
  useEffect(() => {
    if (!machine || !isPlc) return;
    const w = new Worker(new URL('../../../../packages/plc-engine/src/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === 'loaded') {
        setPlc((p) => ({ ...p, errors: msg.errors, loaded: msg.ok, ioPoints: msg.ioPoints }));
        if (msg.ok) w.postMessage({ type: 'start' });
      } else {
        if (!extRef.current.active) machine.setPlcOutputs(msg.status.outputs);
        setPlc((p) => ({ ...p, status: msg.status }));
      }
    };
    return () => {
      w.terminate();
      workerRef.current = null;
    };
  }, [machine, isPlc]);

  // Real-time machine loop
  useEffect(() => {
    if (!machine) return;
    const id = setInterval(() => {
      const ext = extRef.current;
      const w = workerRef.current;
      if (ext.active) {
        // An external PLC is in charge: sensors go out, coil writes come back.
        ext.link.sendInputs(machine.getPlcInputs());
        machine.setPlcOutputs(ext.link.outputs);
      } else if (w) {
        const inputs = machine.getPlcInputs();
        const key = JSON.stringify(inputs);
        if (key !== lastInputs.current) {
          lastInputs.current = key;
          w.postMessage({ type: 'setInputs', values: inputs });
        }
      }
      machine.tick(TICK_MS);
      setRev((r) => r + 1);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [machine]);

  useEffect(() => {
    if (external.enabled) workerRef.current?.postMessage({ type: 'stop' });
  }, [external.enabled]);

  const refresh = useCallback(() => setRev((r) => r + 1), []);
  const loadProgram = useCallback((source: string) => workerRef.current?.postMessage({ type: 'load', source }), []);
  const plcCommand = useCallback((type: 'start' | 'stop' | 'reset') => {
    workerRef.current?.postMessage({ type });
    if (type === 'reset') lastInputs.current = '';
  }, []);
  const restart = useCallback(() => setGen((g) => g + 1), []);

  if (!machine) return null;
  return { machine, rev, refresh, plc, loadProgram, plcCommand, restart, external };
}
