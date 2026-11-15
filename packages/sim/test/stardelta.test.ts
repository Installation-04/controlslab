import { describe, expect, it } from 'vitest';
import { Machine } from '../src';
import { loadDef, tap } from './helpers';

const sd = () => new Machine(loadDef('star-delta-3w'));
const on = (m: Machine, id: string) => m.state<{ energized: boolean }>(id).energized;
const motor = (m: Machine) => m.state<{ speed: number; state: string; conn: string; dir: string }>('MTR');

describe('star-delta starter', () => {
  it('builds with 120 V control and everything released', () => {
    const m = sd();
    expect(m.vab('TB1:T', 'TB0:T')).toBeGreaterThan(115);
    for (const id of ['KM1', 'KM2', 'KM3', 'KT']) expect(on(m, id)).toBe(false);
  });

  it('START: line + star close together, motor starts in star', () => {
    const m = sd();
    tap(m, 'PB_START');
    m.run(500);
    expect(on(m, 'KM1')).toBe(true);
    expect(on(m, 'KM3')).toBe(true);
    expect(on(m, 'KM2')).toBe(false);
    expect(motor(m).conn).toBe('star');
    expect(motor(m).speed).toBeGreaterThan(0.02);
    expect(motor(m).speed).toBeLessThan(0.8);
  });

  it('star start current is about one third of delta locked-rotor current', () => {
    const star = sd();
    tap(star, 'PB_START');
    star.run(30);
    const iStar = star.clamp('W10').value; // KM1 → OL line current
    // Direct delta start for comparison (star contactor coil open, delta welded).
    const direct = sd();
    direct.injectFault('km2_welded');
    tap(direct, 'PB_START');
    direct.run(30);
    const iDirect = direct.clamp('W10').value;
    expect(iDirect).toBeGreaterThan(3 * iStar * 0.8);
    expect(iDirect).toBeLessThan(3 * iStar * 1.2);
    const d = sd();
    tap(d, 'PB_START');
    d.run(12000);
    const iRun = d.clamp('W10').value;
    expect(iRun).toBeGreaterThan(4);
    expect(iRun).toBeLessThan(6.5);
  });

  it('after the delay it changes over to delta and runs at full speed', () => {
    const m = sd();
    tap(m, 'PB_START');
    m.run(5300);
    expect(on(m, 'KM3')).toBe(false);
    m.run(2000);
    expect(on(m, 'KM2')).toBe(true);
    expect(on(m, 'KM3')).toBe(false);
    expect(motor(m).conn).toBe('delta');
    m.run(4000);
    expect(motor(m)).toMatchObject({ state: 'running', conn: 'delta', dir: 'fwd' });
    expect(m.violations()).toEqual([]);
  });

  it('STOP drops everything out', () => {
    const m = sd();
    tap(m, 'PB_START');
    m.run(8000);
    tap(m, 'PB_STOP');
    for (const id of ['KM1', 'KM2', 'KM3', 'KT']) expect(on(m, id)).toBe(false);
    m.run(6000);
    expect(motor(m).dir).toBe('none');
  });

  it('KM2 welded: star can never close (interlock) and the motor starts in delta directly', () => {
    const m = sd();
    m.injectFault('km2_welded');
    tap(m, 'PB_START');
    m.run(500);
    expect(on(m, 'KM3')).toBe(false);
    expect(m.violations()).toEqual([]);
  });

  it('KM3 welded: delta can never close', () => {
    const m = sd();
    m.injectFault('km3_welded');
    tap(m, 'PB_START');
    m.run(9000);
    expect(on(m, 'KM2')).toBe(false);
  });

  it('KT contact 17-18 defective: star drops out, delta never closes, motor coasts down', () => {
    const m = sd();
    m.injectFault('kt_no_open');
    tap(m, 'PB_START');
    m.run(4500);
    expect(motor(m).conn).toBe('star');
    m.run(12000);
    expect(on(m, 'KM1')).toBe(true);
    expect(on(m, 'KM2')).toBe(false);
    expect(on(m, 'KM3')).toBe(false);
    expect(motor(m).conn).toBe('none');
    expect(motor(m).speed).toBeLessThan(0.05);
  });

  it('KM3 coil open: no star start, no changeover chain', () => {
    const m = sd();
    m.injectFault('km3_coil_open');
    tap(m, 'PB_START');
    m.run(9000);
    expect(on(m, 'KM1')).toBe(true);
    expect(motor(m).conn).toBe('delta');
  });

  it('timer coil open: starts in star and stays there', () => {
    const m = sd();
    m.injectFault('kt_coil_open');
    tap(m, 'PB_START');
    m.run(12000);
    expect(motor(m).conn).toBe('star');
  });
});
