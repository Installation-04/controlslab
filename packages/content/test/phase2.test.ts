import { describe, expect, it } from 'vitest';
import { coil, contact, parallel, rung, series, toST, type LdProgram } from '@controlslab/ladder';
import { checkScenario, checkWorkOrder, pickFault, scoreCheckpoint, type CheckResult } from '../src';
import { checkpoints, defById, lockOut, machineMap, newMachine, restore, scenarioById, tap, woById } from './helpers';
import type { EntityDef } from '@controlslab/factory';

const failed = (r: CheckResult) => r.objectives.filter((o) => !o.pass).map((o) => `${JSON.stringify(o.label)} ${o.detail ?? ''}`);
const check = (id: string, m: ReturnType<typeof newMachine>, plcSource?: string) => {
  const order = woById(id);
  return checkWorkOrder({ order, machine: m, def: defById(order.machine), plcSource });
};

describe('BT-0007 lighting bench measurements', () => {
  it('passes with the clamp readings and fails without them', () => {
    const m = newMachine('bench-lighting');
    expect(check('wo-007-banc-eclairage', m).passed).toBe(false);
    ['SW1', 'SW2', 'SW3'].forEach((s) => m.press(s));
    m.run(100);
    const wire = (a: string, b: string) => m.def.wires.find((w) => w.from === a && w.to === b)!.id;
    m.clamp(wire('SW1:2', 'LT1:X1'));
    m.clamp(wire('SW3:2', 'LT3:X1'));
    m.clamp(wire('F1:2', 'JA:T'));
    m.measure('LT3:X2', 'LT3:X1', 'VAC');
    expect(failed(check('wo-007-banc-eclairage', m))).toEqual([]);
  });

  it('a clamp on the wrong wire does not count', () => {
    const m = newMachine('bench-lighting');
    ['SW1', 'SW2', 'SW3'].forEach((s) => m.press(s));
    m.run(100);
    m.clamp(m.def.wires.find((w) => w.from === 'SW2:2')!.id);
    const r = check('wo-007-banc-eclairage', m);
    expect(r.objectives.find((o) => String((o.label as { fr?: string }).fr ?? o.label).includes('lampe 1'))!.pass).toBe(false);
  });
});

describe('BT-0008 open neutral', () => {
  it('expert path passes; skipping LOTO fails', () => {
    const solve = (loto: boolean) => {
      const m = newMachine('bench-lighting');
      woById('wo-008-lampe-neutre').faults.forEach((f) => m.injectFault(f));
      m.press('SW2');
      m.run(100);
      m.measure('LT2:X1', 'LT2:X2', 'VAC'); // looks like 0 V → "no voltage"
      m.measure('LT2:X2', 'PE:G', 'VAC'); // neutral side is hot!
      m.recordDiagnosis('neutral_open');
      if (loto) lockOut(m);
      m.replace('W9');
      if (loto) restore(m);
      return check('wo-008-lampe-neutre', m);
    };
    expect(failed(solve(true))).toEqual([]);
    expect(solve(false).passed).toBe(false);
  });
});

describe('BT-0009 reversing starter interlock', () => {
  it('expert path passes', () => {
    const m = newMachine('reversing-3w');
    woById('wo-009-inverseur-verrouillage').faults.forEach((f) => m.injectFault(f));
    m.press('PB_FWD');
    m.run(100);
    m.measure('KR:21', 'KR:22', 'VAC');
    m.release('PB_FWD');
    m.recordDiagnosis('kr_nc_open');
    lockOut(m);
    m.replace('KR');
    restore(m);
    expect(failed(check('wo-009-inverseur-verrouillage', m))).toEqual([]);
  });
});

const REV_VARS: LdProgram['vars'] = [
  { name: 'Avant', type: 'BOOL', address: '%IX0.0' }, { name: 'Arriere', type: 'BOOL', address: '%IX0.1' }, { name: 'Arret', type: 'BOOL', address: '%IX0.2' },
  { name: 'Surcharge', type: 'BOOL', address: '%IX0.3' }, { name: 'RetourKF', type: 'BOOL', address: '%IX0.4' }, { name: 'RetourKR', type: 'BOOL', address: '%IX0.5' },
  { name: 'AU_OK', type: 'BOOL', address: '%IX0.6' }, { name: 'BobineKF', type: 'BOOL', address: '%QX0.0' }, { name: 'BobineKR', type: 'BOOL', address: '%QX0.1' },
  { name: 'VoyantAvant', type: 'BOOL', address: '%QX0.2' }, { name: 'VoyantArriere', type: 'BOOL', address: '%QX0.3' },
];
const REV_ST = `PROGRAM Main
VAR
    Avant AT %IX0.0 : BOOL; Arriere AT %IX0.1 : BOOL; Arret AT %IX0.2 : BOOL; Surcharge AT %IX0.3 : BOOL;
    RetourKF AT %IX0.4 : BOOL; RetourKR AT %IX0.5 : BOOL; AU_OK AT %IX0.6 : BOOL;
    BobineKF AT %QX0.0 : BOOL; BobineKR AT %QX0.1 : BOOL; VoyantAvant AT %QX0.2 : BOOL; VoyantArriere AT %QX0.3 : BOOL;
END_VAR
BobineKF := (Avant OR BobineKF) AND Arret AND NOT Surcharge AND AU_OK AND NOT BobineKR;
BobineKR := (Arriere OR BobineKR) AND Arret AND NOT Surcharge AND AU_OK AND NOT BobineKF;
VoyantAvant := RetourKF;
VoyantArriere := RetourKR;
END_PROGRAM`;
const common = () => [contact('Arret'), contact('Surcharge', 'NC'), contact('AU_OK')];
const REV_LD: LdProgram = {
  v: 1, name: 'Main', vars: REV_VARS,
  rungs: [
    rung(series(parallel(contact('Avant'), contact('BobineKF')), ...common(), contact('BobineKR', 'NC')), [coil('BobineKF')], 'Sens AVANT'),
    rung(series(parallel(contact('Arriere'), contact('BobineKR')), ...common(), contact('BobineKF', 'NC')), [coil('BobineKR')], 'Sens ARRIÈRE'),
    rung(contact('RetourKF'), [coil('VoyantAvant')]),
    rung(contact('RetourKR'), [coil('VoyantArriere')]),
  ],
};

describe('BT-0011 reversing starter program', () => {
  it('model solution passes in ST and in Ladder', () => {
    expect(failed(check('wo-011-inverseur-api', newMachine('reversing-plc'), REV_ST))).toEqual([]);
    expect(failed(check('wo-011-inverseur-api', newMachine('reversing-plc'), toST(REV_LD)))).toEqual([]);
  });

  it('the starter fails; no software interlock is caught with a precise message', () => {
    expect(check('wo-011-inverseur-api', newMachine('reversing-plc'), woById('wo-011-inverseur-api').plc!.starter!).passed).toBe(false);
    const noLock = REV_ST.replace(' AND NOT BobineKF;', ';').replace(' AND NOT BobineKR;', ';');
    const r = check('wo-011-inverseur-api', newMachine('reversing-plc'), noLock);
    expect(r.passed).toBe(false);
    const msgs = r.objectives.map((o) => o.detail ?? '').join(' | ');
    expect(msgs).toMatch(/verrouillage logiciel|ensemble/);
  });
});

describe('checkpoint 2 — every fault is solvable for full marks', () => {
  const cp = checkpoints().find((c) => c.data.id === 'cp2-inverseur')!.data;

  it.each(cp.pool)('expert solves %s', (faultId) => {
    const m = newMachine('reversing-3w');
    m.injectFault(faultId);
    const f = m.def.faults.find((x) => x.id === faultId)!;
    m.press('PB_FWD');
    m.measure('TB1:T', 'TB0:T', 'VAC');
    m.measure('KF:A1', 'KF:A2', 'VAC');
    m.release('PB_FWD');
    m.recordDiagnosis(faultId);
    lockOut(m);
    m.replace(f.target);
    restore(m);
    const s = scoreCheckpoint(cp, m);
    expect(s.percent, JSON.stringify(s.lines)).toBe(100);
  });

  it('draw is deterministic and inside the pool', () => {
    expect(cp.pool).toContain(pickFault(cp, 12345));
    expect(pickFault(cp, 7)).toBe(pickFault(cp, 7));
  });
});

describe('SC-0004 reversible conveyor', () => {
  const run = (src: string) => {
    const sc = scenarioById('sc-04-convoyeur-reversible');
    return checkScenario(sc, sc.entities as EntityDef[], machineMap(), src);
  };

  it('model solution passes all tests; the starter fails', () => {
    const good = run(REV_ST);
    expect(good.tests.flatMap((t) => t.failures)).toEqual([]);
    expect(good.passed).toBe(true);
    expect(run(scenarioById('sc-04-convoyeur-reversible').plc.starter).passed).toBe(false);
  });

  it('forward-only program fails the left-bin test', () => {
    const r = run(REV_ST.replace('(Arriere OR BobineKR)', 'BobineKR'));
    expect(r.tests.find((t) => t.id === 't-gauche')!.pass).toBe(false);
  });
});

// keep helpers referenced
void tap;
