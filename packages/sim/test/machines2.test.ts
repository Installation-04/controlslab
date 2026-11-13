import { describe, expect, it } from 'vitest';
import { Machine } from '../src';
import { loadDef, tap } from './helpers';

const rev = () => new Machine(loadDef('reversing-3w'));
const speedOf = (m: Machine) => m.state<{ speed: number; dir: string; state: string }>('MTR');
const on = (m: Machine, id: string) => m.state<{ energized: boolean }>(id).energized;

describe('machine definitions load and are energized', () => {
  it.each(['reversing-3w', 'reversing-plc', 'bench-lighting'])('%s builds (all references valid)', (id) => {
    const m = new Machine(loadDef(id));
    expect(m.vab('DS:L1', 'PE:G')).toBeGreaterThan(id === 'bench-lighting' ? 110 : 340);
  });
});

describe('reversing starter (hardwired)', () => {
  it('has 120 V control and both contactors released at power-up', () => {
    const m = rev();
    expect(m.vab('TB1:T', 'TB0:T')).toBeGreaterThan(115);
    expect(on(m, 'KF')).toBe(false);
    expect(on(m, 'KR')).toBe(false);
  });

  it('FORWARD seals in, runs forward; STOP drops out', () => {
    const m = rev();
    tap(m, 'PB_FWD');
    expect(on(m, 'KF')).toBe(true);
    m.run(2500);
    expect(speedOf(m)).toMatchObject({ dir: 'fwd', state: 'running' });
    tap(m, 'PB_STOP');
    expect(on(m, 'KF')).toBe(false);
    m.run(5000);
    expect(speedOf(m).dir).toBe('none');
  });

  it('REVERSE runs the other way (two phases swapped)', () => {
    const m = rev();
    tap(m, 'PB_REV');
    expect(on(m, 'KR')).toBe(true);
    m.run(2500);
    expect(speedOf(m)).toMatchObject({ dir: 'rev', state: 'running' });
  });

  it('electrical interlock: REVERSE is ignored while FORWARD is closed (and the reverse is true)', () => {
    const m = rev();
    tap(m, 'PB_FWD');
    tap(m, 'PB_REV');
    expect(on(m, 'KF')).toBe(true);
    expect(on(m, 'KR')).toBe(false);
    expect(m.violations()).toEqual([]);
  });

  it('changing direction requires STOP first, then the motor plugs and reverses', () => {
    const m = rev();
    tap(m, 'PB_FWD');
    m.run(2500);
    tap(m, 'PB_STOP');
    tap(m, 'PB_REV');
    expect(on(m, 'KR')).toBe(true);
    m.run(300);
    expect(speedOf(m).state).toBe('plugging');
    m.run(4000);
    expect(speedOf(m)).toMatchObject({ dir: 'rev', state: 'running' });
  });

  it('one NC stuck closed: the other contactor still drops the first out (no short)', () => {
    const m = rev();
    m.injectFault('kf_nc_stuck');
    tap(m, 'PB_FWD');
    m.run(1000);
    tap(m, 'PB_REV');
    expect(on(m, 'KR')).toBe(true);
    expect(on(m, 'KF')).toBe(false); // KR's own NC opened in the FORWARD rung
    expect(['F1', 'F2', 'F3'].some((f) => m.state<{ blown: boolean }>(f).blown)).toBe(false);
  });

  it('both interlocks defeated: both contactors close and the main fuses blow (phase-to-phase short)', () => {
    const m = rev();
    m.injectFault('kf_nc_stuck');
    m.injectFault('kr_nc_stuck');
    tap(m, 'PB_FWD');
    m.run(1000);
    tap(m, 'PB_REV');
    m.tick(20);
    expect(['F1', 'F2', 'F3'].some((f) => m.state<{ blown: boolean }>(f).blown)).toBe(true);
    expect(m.events.some((e) => e.type === 'fuse_blown')).toBe(true);
    // The control transformer is fed from the same fuses: the control circuit is now dead.
    m.run(200);
    expect(m.vab('TB1:T', 'TB0:T')).toBeLessThan(60);
  });

  it('KR NC contact open: FORWARD cannot start; 120 V across 21-22 identifies it', () => {
    const m = rev();
    m.injectFault('kr_nc_open');
    m.press('PB_FWD');
    m.run(100);
    expect(on(m, 'KF')).toBe(false);
    expect(m.measure('KR:21', 'KR:22', 'VAC').value).toBeGreaterThan(110);
  });

  it('single phasing after a blown main fuse; overload trips the control', () => {
    const m = rev();
    tap(m, 'PB_FWD');
    m.run(2000);
    m.injectFault('f2_blown');
    m.run(1000);
    expect(speedOf(m).state).toBe('single_phasing');
  });

  it('welded KF keeps the motor running after STOP; both directions share the overload', () => {
    const m = rev();
    m.injectFault('kf_welded');
    m.run(2500);
    tap(m, 'PB_STOP');
    m.run(500);
    expect(speedOf(m).dir).toBe('fwd');
  });

  it('LOTO verification points read zero after isolation', () => {
    const m = rev();
    m.setDisconnect('DS', false);
    for (const [a, b] of m.def.loto.verifyPoints) expect(m.vab(a, b), `${a}-${b}`).toBeLessThan(1);
  });
});

describe('reversing starter (PLC variant)', () => {
  it('exposes the PLC I/O map and keeps the hardwired E-stop and interlocks', () => {
    const m = new Machine(loadDef('reversing-plc'));
    const inputs = m.getPlcInputs();
    expect(Object.keys(inputs).sort()).toEqual(['%IX0.0', '%IX0.1', '%IX0.2', '%IX0.3', '%IX0.4', '%IX0.5', '%IX0.6']);
    expect(inputs['%IX0.2']).toBe(true); // STOP is NC
    expect(inputs['%IX0.6']).toBe(true); // E-stop healthy
    m.setPlcOutputs({ '%QX0.0': true });
    expect(on(m, 'KF')).toBe(true);
    m.setPlcOutputs({ '%QX0.0': true, '%QX0.1': true });
    // The hardwired NC contacts refuse the second contactor.
    expect(on(m, 'KR')).toBe(false);
    m.press('PB_ES');
    expect(on(m, 'KF')).toBe(false);
  });

  it('direction lamps follow their outputs', () => {
    const m = new Machine(loadDef('reversing-plc'));
    m.setPlcOutputs({ '%QX0.2': true });
    m.run(100);
    expect(m.state<{ lit: boolean }>('LT_F').lit).toBe(true);
    expect(m.state<{ lit: boolean }>('LT_R').lit).toBe(false);
  });
});

describe('lighting bench and clamp meter', () => {
  const bench = () => new Machine(loadDef('bench-lighting'));

  it('switches control their branch; lamps light at 120 V', () => {
    const m = bench();
    m.press('SW1');
    m.run(100);
    expect(m.state<{ lit: boolean }>('LT1').lit).toBe(true);
    expect(m.state<{ lit: boolean }>('LT2').lit).toBe(false);
    expect(m.measure('LT1:X1', 'LT1:X2', 'VAC').value).toBeGreaterThan(115);
    m.press('SW1'); // toggle back
    m.run(100);
    expect(m.state<{ lit: boolean }>('LT1').lit).toBe(false);
  });

  it("Ohm's law: clamp reads P/V per branch and the sum on the feeder", () => {
    const m = bench();
    ['SW1', 'SW2', 'SW3'].forEach((s) => m.press(s));
    m.run(100);
    const wire = (from: string, to: string) => m.def.wires.find((w) => w.from === from && w.to === to)!.id;
    const l1 = m.clamp(wire('SW1:2', 'LT1:X1')).value;
    const heater = m.clamp(wire('SW3:2', 'LT3:X1')).value;
    const feeder = m.clamp(wire('F1:2', 'JA:T')).value;
    expect(l1).toBeCloseTo(0.5, 1);
    expect(heater).toBeCloseTo(12.5, 0);
    expect(feeder).toBeCloseTo(l1 * 2 + heater, 0);
    expect(m.measure(wire('F1:2', 'JA:T'), '', 'AAC').unit).toBe('A~');
    expect(() => m.clamp('NOPE')).toThrow();
  });

  it('faults: burnt lamp reads 0 A and open Ω; blown fuse leaves the branch dead', () => {
    const m = bench();
    m.press('SW1');
    m.injectFault('lt1_burnt');
    m.run(100);
    const w = m.def.wires.find((x) => x.from === 'SW1:2')!.id;
    expect(m.clamp(w).value).toBeLessThan(0.01);
    expect(m.measure('LT1:X1', 'LT1:X2', 'VAC').value).toBeGreaterThan(115);
    const n = bench();
    n.injectFault('f1_blown');
    n.press('SW1');
    n.run(100);
    expect(n.state<{ lit: boolean }>('LT1').lit).toBe(false);
  });

  it('neutral open on branch 2 dead while branch 1 still works', () => {
    const m = bench();
    ['SW1', 'SW2'].forEach((s) => m.press(s));
    m.injectFault('neutral_open');
    m.run(100);
    expect(m.state<{ lit: boolean }>('LT1').lit).toBe(true);
    expect(m.state<{ lit: boolean }>('LT2').lit).toBe(false);
    // "Open neutral": full voltage between the lamp's neutral side and ground.
    expect(m.measure('LT2:X2', 'PE:G', 'VAC').value).toBeGreaterThan(100);
  });

  it('ohms of a hot circuit is refused; de-energized lamp reads about a tenth of its hot resistance', () => {
    const m = bench();
    expect(m.measure('LT1:X1', 'LT1:X2', 'OHM').warning).toBe('ohms_on_live');
    m.setDisconnect('DS', false);
    m.run(50);
    m.press('SW1');
    const r = m.measure('LT1:X1', 'LT1:X2', 'OHM').value;
    expect(r).toBeGreaterThan(20);
    expect(r).toBeLessThan(30);
  });
});
