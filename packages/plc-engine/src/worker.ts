// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Web Worker entry. Runs the PLC in (approximately) real time: a timer
 * fires every scan period and executes as many virtual scans as wall-clock
 * time allows, then posts a status snapshot to the UI.
 */
import type { WorkerRequest, WorkerResponse } from './protocol';
import { PlcRuntime } from './runtime';

declare const self: DedicatedWorkerGlobalScope;

const plc = new PlcRuntime({ scanMs: 10 });
let realtime = true;
let last = performance.now();
let debt = 0;

function post(msg: WorkerResponse) {
  self.postMessage(msg);
}

function status() {
  post({
    type: 'status',
    status: {
      mode: plc.mode,
      now: plc.now,
      scanCount: plc.scanCount,
      outputs: plc.getOutputs(),
      vars: plc.snapshot(),
      fault: plc.fault,
    },
  });
}

setInterval(() => {
  const t = performance.now();
  if (realtime && plc.mode === 'running') {
    debt += t - last;
    let guard = 0;
    while (debt >= plc.scanMs && guard++ < 50) {
      plc.scan();
      debt -= plc.scanMs;
    }
    if (guard >= 50) debt = 0; // fell behind; drop time rather than spiral
  } else debt = 0;
  last = t;
  status();
}, 20);

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const m = ev.data;
  switch (m.type) {
    case 'load': {
      const r = plc.load(m.source);
      post({ type: 'loaded', ok: r.ok, errors: r.errors, ioPoints: r.ioPoints });
      break;
    }
    case 'start':
      plc.start();
      break;
    case 'stop':
      plc.stop();
      break;
    case 'reset':
      plc.reset();
      break;
    case 'step':
      for (let i = 0; i < (m.scans ?? 1); i++) plc.scan();
      break;
    case 'setInputs':
      plc.setInputs(m.values);
      break;
    case 'config':
      realtime = m.realtime;
      break;
  }
  status();
};
