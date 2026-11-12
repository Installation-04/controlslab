import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Machine, type MachineDef } from '@controlslab/sim';
import { parseContent, type Checkpoint, type Lesson, type Scenario, type WorkOrder } from '../src';

const root = fileURLToPath(new URL('../../../content/', import.meta.url));

function loadDir<T>(dir: string, kind: string): Array<{ file: string; data: T }> {
  return readdirSync(root + dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((file) => {
      const p = parseContent(readFileSync(`${root}${dir}/${file}`, 'utf8'));
      if (p.kind !== kind) throw new Error(`${file}: expected ${kind}, got ${p.kind}`);
      return { file, data: p.data as T };
    });
}

export const lessons = () => loadDir<Lesson>('lessons', 'lesson');
export const workorders = () => loadDir<WorkOrder>('workorders', 'workorder');
export const checkpoints = () => loadDir<Checkpoint>('checkpoints', 'checkpoint');
export const scenarios = () => loadDir<Scenario>('scenarios', 'scenario');
export const scenarioById = (id: string) => scenarios().find((x) => x.data.id === id)!.data;
export const machineMap = () => Object.fromEntries(machineDefs().map((m) => [m.data.id, m.data]));
export const machineDefs = () => loadDir<MachineDef>('machines', 'machine');

export const defById = (id: string): MachineDef => {
  const m = machineDefs().find((x) => x.data.id === id);
  if (!m) throw new Error(`machine ${id}`);
  return structuredClone(m.data);
};
export const newMachine = (id: string) => new Machine(defById(id));
export const woById = (id: string) => workorders().find((w) => w.data.id === id)!.data;

export function tap(m: Machine, id: string, ms = 100) {
  m.press(id);
  m.run(ms);
  m.release(id);
}

/** Correct LOTO up to "work allowed". */
export function lockOut(m: Machine) {
  m.acknowledge('notify');
  tap(m, 'PB_STOP');
  m.run(5000);
  m.setDisconnect('DS', false);
  m.applyLock('DS');
  m.acknowledge('stored_energy_checked');
  tap(m, 'PB_START');
  m.measure('DS:L1', 'DS:L2', 'VAC');
  for (const [a, b] of m.def.loto.verifyPoints) m.measure(a, b, 'VAC');
  m.measure('DS:L1', 'DS:L2', 'VAC');
}

export function restore(m: Machine) {
  m.acknowledge('work_done');
  m.removeLock('DS');
  m.setDisconnect('DS', true);
}
