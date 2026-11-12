// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live cell runtime: CellCore (panel circuit + factory) stepped in real time,
 * with the learner's ST program running in a Web Worker.
 */
import { CellCore, type EntityDef } from '@controlslab/factory';
import type { IoPoint, PlcErrorInfo, PlcStatus, WorkerResponse } from '@controlslab/plc-engine';
import type { MachineDef } from '@controlslab/sim';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FrameState } from './scene3d';

const STEP_MS = 20;

export interface CellRuntime {
  core: CellCore;
  running: boolean;
  /** Bumps ~10×/s so panels re-render. */
  rev: number;
  refresh(): void;
  frame: () => FrameState;
  plc: { status: PlcStatus | null; errors: PlcErrorInfo[]; loaded: boolean; ioPoints: IoPoint[] };
  start(source: string): void;
  stop(): void;
  reset(): void;
}

export function useCellRuntime(entities: EntityDef[], machines: Record<string, MachineDef>, faults: string[] = []): CellRuntime {
  const [gen, setGen] = useState(0);
  const [running, setRunning] = useState(false);
  const [rev, setRev] = useState(0);
  const [plc, setPlc] = useState<CellRuntime['plc']>({ status: null, errors: [], loaded: false, ioPoints: [] });
  const key = JSON.stringify(entities) + gen + faults.join(',');
  const core = useMemo(
    () => new CellCore({ entities: structuredClone(entities), machines, faults }),
    [key, machines],
  );
  const worker = useRef<Worker | null>(null);
  const outputs = useRef<Record<string, boolean | number>>({});
  const inputs = useRef<Record<string, boolean>>({});
  const lastSent = useRef('');
  const runningRef = useRef(false);
  const coreRef = useRef(core);
  coreRef.current = core;

  const killWorker = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    outputs.current = {};
    lastSent.current = '';
  }, []);

  // Any change of the layout resets the simulation.
  useEffect(() => {
    killWorker();
    runningRef.current = false;
    setRunning(false);
    inputs.current = {};
    setPlc({ status: null, errors: [], loaded: false, ioPoints: [] });
    return killWorker;
  }, [core, killWorker]);

  // Real-time loop.
  useEffect(() => {
    let tick = 0;
    const id = setInterval(() => {
      if (!runningRef.current) return;
      const c = coreRef.current;
      inputs.current = c.step(STEP_MS, outputs.current);
      const w = worker.current;
      if (w) {
        const k = JSON.stringify(inputs.current);
        if (k !== lastSent.current) {
          lastSent.current = k;
          w.postMessage({ type: 'setInputs', values: inputs.current });
        }
      }
      if (++tick % 5 === 0) setRev((r) => r + 1);
    }, STEP_MS);
    return () => clearInterval(id);
  }, []);

  const start = useCallback(
    (source: string) => {
      killWorker();
      const w = new Worker(new URL('../../../../packages/plc-engine/src/worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const m = ev.data;
        if (m.type === 'loaded') {
          setPlc((p) => ({ ...p, errors: m.errors, loaded: m.ok, ioPoints: m.ioPoints }));
          if (m.ok) {
            w.postMessage({ type: 'start' });
            runningRef.current = true;
            setRunning(true);
          }
        } else {
          outputs.current = m.status.outputs;
          setPlc((p) => ({ ...p, status: m.status }));
        }
      };
      w.postMessage({ type: 'load', source });
    },
    [killWorker],
  );

  const stop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    worker.current?.postMessage({ type: 'stop' });
    outputs.current = {};
  }, []);

  const reset = useCallback(() => setGen((g) => g + 1), []);
  const refresh = useCallback(() => setRev((r) => r + 1), []);

  const frame = useCallback((): FrameState => {
    const c = coreRef.current;
    const bins: Record<string, number> = {};
    for (const [id, s] of Object.entries(c.factory.bins)) bins[id] = s.count;
    return {
      items: c.factory.items,
      belt: c.factory.belt,
      stroke: c.factory.stroke,
      pressed: (id) => c.factory.isPressed(id),
      inputs: inputs.current,
      outputs: outputs.current,
      bins,
      motorSpeed: c.motorSpeed,
      running: runningRef.current,
    };
  }, []);

  return { core, running, rev, refresh, frame, plc, start, stop, reset };
}
