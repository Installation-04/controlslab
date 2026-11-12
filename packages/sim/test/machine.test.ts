import { describe, expect, it } from 'vitest';
import { Machine, MachineError, type MachineDef } from '../src';
import { hardwired, loadDef, lockOut, plcMachine, tap } from './helpers';

const running = (m: Machine) => m.state<{ energized: boolean }>('M').energized;
const speed = (m: Machine) => m.state<{ speed: number }>('MTR').speed;

describe('motor starter — normal operation', () => {
  it('is energized at power-up: 600 V L-L, 347 V L-G, 120 V control', () => {
    const m = hardwired();
    expect(m.vab('DS:L1', 'DS:L2')).toBeCloseTo(600, -1);
    expect(m.vab('DS:T1', 'PE:G')).toBeCloseTo(346, -1);
    expect(m.vab('XF:X1', 'XF:X2')).toBeGreaterThan(115);
    expect(m.vab('XF:X1', 'XF:X2')).toBeLessThan(121);
    expect(m.vab('TB1:T', 'TB0:T')).toBeGreaterThan(115);
    expect(running(m)).toBe(false);
  });

  it('3-wire control: START latches through 13-14, STOP drops out', () => {
    const m = hardwired();
    tap(m, 'PB_START');
    expect(running(m)).toBe(true);
    m.run(2000);
    expect(speed(m)).toBe(1);
    expect(m.state<{ lit: boolean }>('LT_RUN').lit).toBe(true);
    expect(m.state<{ state: string }>('MTR').state).toBe('running');
    tap(m, 'PB_STOP');
    expect(running(m)).toBe(false);
    m.run(5000);
    expect(speed(m)).toBe(0);
    expect(m.state<{ state: string }>('MTR').state).toBe('stopped');
  });

  it('E-stop latches and must be reset before restarting', () => {
    const m = hardwired();
    tap(m, 'PB_START');
    tap(m, 'PB_ES');
    expect(running(m)).toBe(false);
    tap(m, 'PB_START');
    expect(running(m)).toBe(false);
    expect(m.resetEStop('PB_ES').ok).toBe(true);
    tap(m, 'PB_START');
    expect(running(m)).toBe(true);
    expect(m.resetEStop('PB_START').ok).toBe(false);
  });

  it('starting current is higher than running current (locked-rotor model)', () => {
    const m = hardwired();
    m.press('PB_START');
    m.tick(10);
    const vdrop = m.vab('OL:L1', 'OL:T1');
    m.release('PB_START');
    m.run(2000);
    expect(vdrop / m.vab('OL:L1', 'OL:T1')).toBeGreaterThan(4);
  });

  it('opening the disconnect under load is flagged', () => {
    const m = hardwired();
    tap(m, 'PB_START');
    m.run(1000);
    m.setDisconnect('DS', false);
    expect(m.violations()).toContain('disconnect_under_load');
    expect(running(m)).toBe(false);
    expect(m.setDisconnect('DS', false)).toEqual({ ok: true });
  });

  it('rejects actions on the wrong component types', () => {
    const m = hardwired();
    expect(m.press('DS')).toMatchObject({ ok: false });
    expect(m.release('DS')).toMatchObject({ ok: false });
    expect(m.setDisconnect('M', false)).toMatchObject({ ok: false });
    expect(m.applyLock('M')).toMatchObject({ ok: false });
    expect(m.resetOverload('M')).toMatchObject({ ok: false });
    expect(m.replace('NOPE')).toMatchObject({ ok: false });
    expect(m.removeLock('DS')).toMatchObject({ ok: false, reason: 'not_locked' });
    expect(() => m.component('NOPE')).toThrow(MachineError);
  });

  it('exposes terminals and their schematic positions', () => {
    const m = hardwired();
    expect(m.terminals()).toContain('M:A1');
    expect(m.terminalPosition('F1:2')).toEqual([60, 230]);
    expect(m.terminalPosition('M:A2')).toEqual([860, 460]);
    expect(m.terminalPosition('NOPE:1')).toBeUndefined();
    expect(m.terminalPosition('M:ZZ')).toBeUndefined();
  });
});

describe('multimeter', () => {
  it('reads AC volts; DC mode on AC reads ~0', () => {
    const m = hardwired();
    const r = m.measure('TB1:T', 'TB0:T', 'VAC');
    expect(r.value).toBeGreaterThan(115);
    expect(r.unit).toBe('V~');
    expect(m.measure('TB1:T', 'TB0:T', 'VDC').value).toBe(0);
    expect(m.measure('DS:L1', 'DS:L2', 'VAC').display).toMatch(/^\d{3}$/);
    expect(m.measure('TB1:T', 'TB1:T', 'VAC').display).toBe('0.00');
  });

  it('120 V appears across an open contact (STOP held)', () => {
    const m = hardwired();
    m.press('PB_STOP');
    expect(m.measure('PB_STOP:1', 'PB_STOP:2', 'VAC').value).toBeGreaterThan(110);
  });

  it('ohms on a live circuit is refused and flagged', () => {
    const m = hardwired();
    const r = m.measure('PB_STOP:1', 'PB_STOP:2', 'OHM');
    expect(r.warning).toBe('ohms_on_live');
    expect(r.display).toBe('----');
    expect(m.violations()).toContain('ohms_on_live');
  });

  it('measures resistances once de-energized (coil, motor windings, open fuse)', () => {
    const m = hardwired();
    m.setDisconnect('DS', false);
    m.run(100);
    // In circuit, the coil (110 Ω) is in parallel with the cold RUN lamp (240 Ω) through X2 and 95-96:
    // a classic trap — lift a lead to measure a component alone.
    const coil = m.measure('M:A1', 'M:A2', 'OHM');
    expect(coil.value).toBeCloseTo(75.4, 0);
    // Phase-to-phase through two windings ≈ 2 × 1.6 Ω
    expect(m.measure('MTR:T1', 'MTR:T2', 'OHM').value).toBeCloseTo(3.2, 1);
    expect(m.measure('F6:1', 'F6:2', 'CONT')).toMatchObject({ beep: true });
    // Sneak path: an open NO button still reads ~coil resistance through the CPT secondary.
    expect(m.measure('PB_START:1', 'PB_START:2', 'OHM').value).toBeCloseTo(76.4, 0);
    expect(m.measure('PB_START:1', 'MTR:T1', 'OHM').display).toBe('OL');
    expect(m.resistance('M:A1', 'M:A1')).toBe(0);
  });

  it('validates probe points', () => {
    const m = hardwired();
    expect(() => m.measure('M:XX', 'GND', 'VAC')).toThrow(MachineError);
    expect(m.measure('DS:L1', 'GND', 'VAC').value).toBeGreaterThan(340);
  });
});

describe('faults', () => {
  it('open overload (95-96): motor will not start; 120 V across 95-96', () => {
    const m = hardwired();
    m.injectFault('ol_open');
    tap(m, 'PB_START');
    expect(running(m)).toBe(false);
    m.press('PB_START');
    expect(m.measure('OL:95', 'OL:96', 'VAC').value).toBeGreaterThan(110);
    expect(m.activeFaults().map((f) => f.id)).toEqual(['ol_open']);
  });

  it('welded contactor: STOP de-energizes the coil but the motor keeps running', () => {
    const m = hardwired();
    m.injectFault('m_welded');
    m.run(2000);
    expect(speed(m)).toBe(1);
    m.press('PB_STOP');
    m.run(1000);
    expect(speed(m)).toBe(1);
    expect(m.measure('M:A1', 'M:A2', 'VAC').value).toBeLessThan(5);
    // The welded carrier also holds 13-14 closed: the coil re-energizes on release.
    m.release('PB_STOP');
    expect(running(m)).toBe(true);
  });

  it('blown secondary fuse: no control voltage after F6', () => {
    const m = hardwired();
    m.injectFault('f6_blown');
    tap(m, 'PB_START');
    expect(running(m)).toBe(false);
    expect(m.measure('F6:1', 'XF:X2', 'VAC').value).toBeGreaterThan(110);
    expect(m.measure('F6:2', 'XF:X2', 'VAC').value).toBeLessThan(1);
    expect(m.measure('F6:1', 'F6:2', 'VAC').value).toBeGreaterThan(110);
  });

  it('blown CPT primary fuse kills the control circuit', () => {
    const m = hardwired();
    m.injectFault('f4_blown');
    expect(m.measure('XF:X1', 'XF:X2', 'VAC').value).toBeLessThan(1);
  });

  it('blown main fuse: single phasing trips the overload', () => {
    const m = hardwired();
    tap(m, 'PB_START');
    m.run(2000);
    m.injectFault('f2_blown');
    m.run(1000);
    expect(m.state<{ state: string }>('MTR').state).toBe('single_phasing');
    for (let i = 0; i < 2000 && !m.state<{ tripped: boolean }>('OL').tripped; i++) m.tick(20);
    expect(m.state<{ tripped: boolean }>('OL').tripped).toBe(true);
    expect(running(m)).toBe(false);
    m.tick(20);
    expect(m.state<{ lit: boolean }>('LT_OL').lit).toBe(true);
    expect(m.events.some((e) => e.type === 'ol_trip')).toBe(true);
    // Too hot to reset right away, OK after cooling.
    expect(m.resetOverload('OL')).toMatchObject({ ok: false, reason: 'too_hot' });
    m.run(30000);
    expect(m.resetOverload('OL').ok).toBe(true);
  });

  it('seal-in contact open: motor runs only while START is held', () => {
    const m = hardwired();
    m.injectFault('m_aux_open');
    m.press('PB_START');
    m.run(100);
    expect(running(m)).toBe(true);
    m.release('PB_START');
    expect(running(m)).toBe(false);
  });

  it('open coil / stop contact / wire 4: no start; lamp burnt: runs dark', () => {
    for (const f of ['m_coil_open', 'stop_open', 'wire4_open']) {
      const m = hardwired();
      m.injectFault(f);
      tap(m, 'PB_START');
      expect(running(m), f).toBe(false);
    }
    const m = hardwired();
    m.injectFault('lamp_burnt');
    tap(m, 'PB_START');
    m.run(100);
    expect(running(m)).toBe(true);
    expect(m.state<{ lit: boolean }>('LT_RUN').lit).toBe(false);
  });

  it('open motor winding: motor hums (single phasing) and trips', () => {
    const m = hardwired();
    m.injectFault('motor_winding');
    tap(m, 'PB_START');
    m.run(1000);
    expect(m.state<{ state: string }>('MTR').state).toBe('single_phasing');
  });

  it('short circuit blows a fuse', () => {
    const def = loadDef('motor-starter-3w');
    def.wires.push({ id: 'SHORT', from: 'TB1:T', to: 'TB0:T' });
    const m = new Machine(def);
    m.tick(10);
    expect(m.state<{ blown: boolean }>('F6').blown).toBe(true);
    expect(m.events.some((e) => e.type === 'fuse_blown')).toBe(true);
  });

  it('clearFaults removes everything; unknown fault rejected', () => {
    const m = hardwired();
    m.injectFault('ol_open');
    m.injectFault('wire4_open');
    m.clearFaults();
    expect(m.activeFaults()).toEqual([]);
    tap(m, 'PB_START');
    expect(running(m)).toBe(true);
    expect(m.injectFault('nope')).toMatchObject({ ok: false });
  });

  it('repair under LOTO clears the fault; repair without LOTO is a violation', () => {
    const m = hardwired();
    m.injectFault('ol_open');
    lockOut(m);
    expect(m.loto().workAllowed).toBe(true);
    m.replace('OL');
    expect(m.activeFaults()).toEqual([]);
    expect(m.violations()).toEqual([]);
    const ev = m.events.find((e) => e.type === 'replace');
    expect(ev).toMatchObject({ hadFault: true, lotoOk: true });

    const n = hardwired();
    n.injectFault('wire4_open');
    n.replace('W36');
    expect(n.violations()).toEqual(['work_without_loto']);
    expect(n.activeFaults()).toEqual([]);
  });

  it('records diagnoses', () => {
    const m = hardwired();
    m.injectFault('f6_blown');
    expect(m.recordDiagnosis('f6_blown')).toBe(true);
    expect(m.recordDiagnosis('ol_open')).toBe(false);
  });
});

describe('disconnect & locks', () => {
  it('lock only when OFF; cannot close while locked', () => {
    const m = hardwired();
    expect(m.applyLock('DS')).toMatchObject({ ok: false, reason: 'must_be_off' });
    m.setDisconnect('DS', false);
    expect(m.applyLock('DS').ok).toBe(true);
    expect(m.applyLock('DS')).toMatchObject({ ok: false, reason: 'already_locked' });
    expect(m.setDisconnect('DS', true)).toMatchObject({ ok: false, reason: 'locked' });
    expect(m.vab('DS:T1', 'DS:T2')).toBeLessThan(1);
    expect(m.vab('DS:L1', 'DS:L2')).toBeGreaterThan(590);
    expect(m.removeLock('DS').ok).toBe(true);
    expect(m.setDisconnect('DS', true).ok).toBe(true);
  });

  it('stored energy cannot be acknowledged while the motor still turns', () => {
    const m = hardwired();
    tap(m, 'PB_START');
    m.run(2000);
    tap(m, 'PB_STOP');
    expect(m.acknowledge('stored_energy_checked')).toMatchObject({ ok: false });
    m.run(5000);
    expect(m.acknowledge('stored_energy_checked').ok).toBe(true);
  });
});

describe('PLC-controlled variant', () => {
  it('PLC inputs follow field devices; outputs drive the coil', () => {
    const m = plcMachine();
    expect(m.getPlcInputs()).toEqual({
      '%IX0.0': false, '%IX0.1': true, '%IX0.2': false, '%IX0.3': true, '%IX0.4': false,
    });
    m.press('PB_START');
    expect(m.getPlcInputs()['%IX0.0']).toBe(true);
    m.setPlcOutputs({ '%QX0.0': true, '%QX0.1': true });
    expect(running(m)).toBe(true);
    m.run(100);
    expect(m.getPlcInputs()['%IX0.4']).toBe(true);
    expect(m.state<{ lit: boolean }>('LT_RUN').lit).toBe(true);
    m.setPlcOutputs({ '%QX0.0': true, '%QX0.1': true }); // unchanged → no resolve needed
    m.setPlcOutputs({ '%QX0.0': 0, '%QX0.1': 0 });
    expect(running(m)).toBe(false);
  });

  it('E-stop is hardwired: drops the coil even if the PLC output stays on', () => {
    const m = plcMachine();
    m.setPlcOutputs({ '%QX0.0': true });
    expect(running(m)).toBe(true);
    m.press('PB_ES');
    expect(running(m)).toBe(false);
    expect(m.getPlcInputs()['%IX0.3']).toBe(false);
  });

  it('welded PLC output keeps the coil energized', () => {
    const m = plcMachine();
    m.injectFault('q0_welded');
    expect(running(m)).toBe(true);
  });
});

describe('definition validation', () => {
  const base = () => loadDef('motor-starter-3w');
  const bad: Array<[string, (d: MachineDef) => void, RegExp]> = [
    ['unknown type', (d) => void (d.components[0]!.type = 'warp_core'), /Unknown component type/],
    ['duplicate id', (d) => void d.components.push({ ...d.components[0]! }), /Duplicate component/],
    ['bad part', (d) => void (d.components[0]!.parts = { nope: { at: [0, 0] } }), /unknown part/],
    ['duplicate wire', (d) => void d.wires.push({ ...d.wires[0]! }), /Duplicate wire/],
    ['bad terminal ref', (d) => void (d.wires[0]!.from = 'DS'), /Invalid terminal/],
    ['unknown comp in wire', (d) => void (d.wires[0]!.from = 'ZZ:1'), /Unknown component/],
    ['bad terminal', (d) => void (d.wires[0]!.from = 'DS:Q9'), /no terminal/],
    ['fault target', (d) => void (d.faults[0]!.target = 'ZZ'), /unknown target/],
    ['fault kind', (d) => void (d.faults[0]!.kind = 'melted'), /does not support/],
    ['isolator', (d) => void (d.loto.isolators = ['M']), /must be a disconnect3/],
  ];
  it.each(bad)('%s', (_n, mutate, re) => {
    const d = base();
    mutate(d);
    expect(() => new Machine(d)).toThrow(re);
  });
});
