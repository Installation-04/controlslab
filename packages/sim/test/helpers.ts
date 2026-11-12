import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { Machine, type MachineDef } from '../src';

export function loadDef(name: string): MachineDef {
  const path = fileURLToPath(new URL(`../../../content/machines/${name}.yaml`, import.meta.url));
  return parse(readFileSync(path, 'utf8')) as MachineDef;
}

export const hardwired = () => new Machine(loadDef('motor-starter-3w'));
export const plcMachine = () => new Machine(loadDef('motor-starter-plc'));

/** Press and release a button with some time between. */
export function tap(m: Machine, id: string, holdMs = 100) {
  m.press(id);
  m.run(holdMs);
  m.release(id);
}

/** Complete a full, correct LOTO up to "work allowed". */
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
