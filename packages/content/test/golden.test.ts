import { describe, expect, it } from 'vitest';
import { Machine } from '@controlslab/sim';
import { CoSim, checkWorkOrder, pickFault, runPlcTest, scoreCheckpoint, type CheckInput } from '../src';
import { checkpoints, defById, lockOut, newMachine, restore, tap, woById } from './helpers';

const SOLUTION = `PROGRAM Main
VAR
    Marche AT %IX0.0 : BOOL;
    Arret AT %IX0.1 : BOOL;
    Surcharge AT %IX0.2 : BOOL;
    AU_OK AT %IX0.3 : BOOL;
    RetourM AT %IX0.4 : BOOL;
    BobineM AT %QX0.0 : BOOL;
    VoyantMarche AT %QX0.1 : BOOL;
END_VAR
BobineM := (Marche OR BobineM) AND Arret AND NOT Surcharge AND AU_OK;
VoyantMarche := RetourM;
END_PROGRAM`;

const check = (id: string, m: Machine, plcSource?: string) => {
  const order = woById(id);
  const input: CheckInput = { order, machine: m, def: defById(order.machine), plcSource };
  return checkWorkOrder(input);
};
const failed = (r: ReturnType<typeof check>) => r.objectives.filter((o) => !o.pass).map((o) => `${JSON.stringify(o.label)} ${o.detail ?? ''}`);

describe('work orders — model solutions pass, empty attempts fail', () => {
  it('wo-002 measurements', () => {
    const m = newMachine('motor-starter-3w');
    expect(check('wo-002-mesures', m).passed).toBe(false);
    m.measure('DS:L1', 'DS:L2', 'VAC');
    m.measure('PE:G', 'DS:L1', 'VAC');
    m.measure('TB0:T', 'TB1:T', 'VAC');
    expect(failed(check('wo-002-mesures', m))).toEqual([]);
  });

  it('wo-002 fails when ohms are measured on a live circuit', () => {
    const m = newMachine('motor-starter-3w');
    m.measure('DS:L1', 'DS:L2', 'VAC');
    m.measure('PE:G', 'DS:L1', 'VAC');
    m.measure('TB0:T', 'TB1:T', 'VAC');
    m.measure('M:A1', 'M:A2', 'OHM');
    expect(check('wo-002-mesures', m).passed).toBe(false);
  });

  it('wo-003 LOTO', () => {
    const m = newMachine('motor-starter-3w');
    tap(m, 'PB_START');
    m.run(2000);
    expect(check('wo-003-cadenassage', m).passed).toBe(false);
    lockOut(m);
    restore(m);
    expect(failed(check('wo-003-cadenassage', m))).toEqual([]);
  });

  it('wo-004 schematic', () => {
    const m = newMachine('motor-starter-3w');
    tap(m, 'PB_START');
    m.run(500);
    m.measure('M:A1', 'M:A2', 'VAC');
    expect(failed(check('wo-004-schema', m))).toEqual([]);
  });

  it('wo-005 ST program: model solution passes all tests', () => {
    const m = newMachine('motor-starter-plc');
    const r = check('wo-005-programme-st', m, SOLUTION);
    expect(failed(r)).toEqual([]);
  });

  it('wo-005: starter program fails, broken programs give specific feedback', () => {
    const def = defById('motor-starter-plc');
    const wo = woById('wo-005-programme-st');
    const test = (id: string) => wo.plc!.tests.find((t) => t.id === id)!;
    expect(runPlcTest(def, def.plc!.starterProgram!, test('t-demarrage')).pass).toBe(false);
    // No seal-in: only follows the button.
    const noSeal = SOLUTION.replace('(Marche OR BobineM)', 'Marche');
    const r = runPlcTest(def, noSeal, test('t-demarrage'));
    expect(r.pass).toBe(false);
    expect(r.failures[0]).toMatch(/auto-maintien/);
    // Wrong polarity on STOP: never starts.
    expect(runPlcTest(def, SOLUTION.replace('AND Arret', 'AND NOT Arret'), test('t-demarrage')).pass).toBe(false);
    // Ignores E-stop in software (hardware still drops the coil, but the program output stays on).
    const noAU = SOLUTION.replace(' AND AU_OK', '');
    expect(runPlcTest(def, noAU, test('t-urgence')).pass).toBe(false);
    // Syntax error is reported, not thrown.
    const bad = runPlcTest(def, 'PROGRAM Main x := ; END_PROGRAM', test('t-demarrage'));
    expect(bad.loadError).toMatch(/attendue/);
    expect(bad.pass).toBe(false);
  });

  it('wo-010 troubleshooting: correct sequence passes; skipping LOTO fails', () => {
    const solve = (withLoto: boolean) => {
      const m = newMachine('motor-starter-3w');
      const wo = woById('wo-010-surcharge');
      wo.faults.forEach((f) => m.injectFault(f));
      m.press('PB_START');
      m.measure('OL:95', 'OL:96', 'VAC');
      m.release('PB_START');
      m.recordDiagnosis('ol_open');
      if (withLoto) lockOut(m);
      m.replace('OL');
      if (withLoto) restore(m);
      return check('wo-010-surcharge', m);
    };
    expect(failed(solve(true))).toEqual([]);
    expect(solve(false).passed).toBe(false);
  });
});

describe('co-simulation', () => {
  it('PLC drives the machine and the machine feeds the PLC', () => {
    const m = newMachine('motor-starter-plc');
    const sim = new CoSim(m);
    expect(sim.load(SOLUTION).ok).toBe(true);
    sim.run(200);
    m.press('PB_START');
    sim.run(100);
    m.release('PB_START');
    sim.run(3000);
    expect(m.state<{ energized: boolean }>('M').energized).toBe(true);
    expect(m.state<{ state: string }>('MTR').state).toBe('running');
    expect(sim.plc.getOutput('%QX0.1')).toBe(true);
    m.press('PB_STOP');
    sim.run(200);
    expect(m.state<{ energized: boolean }>('M').energized).toBe(false);
  });

  it('a trip of the overload is seen by the program and keeps the motor off', () => {
    const m = newMachine('motor-starter-plc');
    const sim = new CoSim(m);
    sim.load(SOLUTION);
    m.press('PB_START');
    sim.run(100);
    m.release('PB_START');
    sim.run(1000);
    m.injectFault('f2_blown'); // single phasing → thermal trip
    sim.run(40000);
    expect(m.state<{ tripped: boolean }>('OL').tripped).toBe(true);
    expect(sim.plc.read('Surcharge')).toBe(true);
    expect(m.state<{ energized: boolean }>('M').energized).toBe(false);
  });
});

describe('checkpoint', () => {
  const cp = checkpoints()[0]!.data;

  it('deterministic seeded draw stays within the pool and varies', () => {
    expect(pickFault(cp, 1)).toBe(pickFault(cp, 1));
    const seen = new Set(Array.from({ length: 60 }, (_, i) => pickFault(cp, i * 7919)));
    expect(seen.size).toBeGreaterThan(3);
    for (const f of seen) expect(cp.pool).toContain(f);
  });

  /** Expert path: minimal measurements, right diagnosis, full LOTO, replace, restore. */
  function expert(faultId: string) {
    const m = newMachine('motor-starter-3w');
    m.injectFault(faultId);
    const f = m.def.faults.find((x) => x.id === faultId)!;
    m.press('PB_START');
    m.measure('TB1:T', 'TB0:T', 'VAC');
    m.measure('M:A1', 'M:A2', 'VAC');
    m.release('PB_START');
    m.recordDiagnosis(faultId);
    lockOut(m);
    m.replace(f.target);
    restore(m);
    return scoreCheckpoint(cp, m);
  }

  it.each(['ol_open', 'f6_blown', 'm_coil_open', 'stop_open', 'm_aux_open', 'wire4_open'])('expert solves %s with full marks', (id) => {
    const s = expert(id);
    expect(s.percent, JSON.stringify(s.lines)).toBe(100);
    expect(s.passed).toBe(true);
  });

  it('no work done: fails with explanatory notes', () => {
    const m = newMachine('motor-starter-3w');
    m.injectFault('f6_blown');
    const s = scoreCheckpoint(cp, m);
    expect(s.passed).toBe(false);
    expect(s.lines.find((l) => l.key === 'diagnosis')!.notes).toContain('aucun diagnostic');
    expect(s.lines.find((l) => l.key === 'loto')!.points).toBe(0);
    expect(s.lines.find((l) => l.key === 'restore')!.notes.length).toBeGreaterThan(0);
  });

  it('parts-swapping without LOTO or diagnosis is heavily penalized', () => {
    const m = newMachine('motor-starter-3w');
    m.injectFault('f6_blown');
    ['OL', 'M', 'PB_STOP'].forEach((id) => m.replace(id));
    m.replace('F6');
    const s = scoreCheckpoint(cp, m);
    expect(s.lines.find((l) => l.key === 'loto')!.points).toBe(0);
    expect(s.lines.find((l) => l.key === 'efficiency')!.points).toBe(5); // 20 − 3×5
    expect(s.passed).toBe(false);
  });

  it('ohmmeter on live circuit and many measurements cost points', () => {
    const m = newMachine('motor-starter-3w');
    m.injectFault('ol_open');
    for (let i = 0; i < 15; i++) m.measure('M:A1', 'M:A2', 'VAC');
    m.measure('M:A1', 'M:A2', 'OHM');
    m.recordDiagnosis('ol_open');
    lockOut(m);
    m.replace('OL');
    restore(m);
    const s = scoreCheckpoint(cp, m);
    expect(s.lines.find((l) => l.key === 'loto')!.points).toBe(22.5);
    expect(s.lines.find((l) => l.key === 'efficiency')!.notes[0]).toMatch(/mesure/);
    expect(s.percent).toBeLessThan(100);
  });

  it('a wrong final diagnosis loses the diagnosis points even after a right one', () => {
    const m = newMachine('motor-starter-3w');
    m.injectFault('ol_open');
    m.recordDiagnosis('ol_open');
    m.recordDiagnosis('f6_blown');
    const d = scoreCheckpoint(cp, m).lines.find((l) => l.key === 'diagnosis')!;
    expect(d.points).toBe(0);
    expect(d.notes).toContain('2 essais');
  });
});
