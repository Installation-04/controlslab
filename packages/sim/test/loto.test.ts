import { describe, expect, it } from 'vitest';
import { computeLoto } from '../src';
import { hardwired, lockOut, tap } from './helpers';

describe('LOTO procedure', () => {
  it('fresh machine: nothing done, notify is next', () => {
    const m = hardwired();
    const s = m.loto();
    expect(s.current).toBe('notify');
    expect(s.workAllowed).toBe(false);
  });

  it('a complete, correct procedure allows work and then restore', () => {
    const m = hardwired();
    tap(m, 'PB_START');
    m.run(2000);
    lockOut(m);
    let s = m.loto();
    expect(s.steps).toMatchObject({
      notify: 'done', shutdown: 'done', isolate: 'done', lockout: 'done',
      stored_energy: 'done', try_start: 'done', verify: 'done', restore: 'pending',
    });
    expect(s.workAllowed).toBe(true);
    expect(s.verify.points.every((p) => p.ok)).toBe(true);
    m.acknowledge('work_done');
    expect(m.loto().workAllowed).toBe(false);
    m.removeLock('DS');
    m.setDisconnect('DS', true);
    s = m.loto();
    expect(s.steps.restore).toBe('done');
    expect(s.current).toBeNull();
    expect(m.violations()).toEqual([]);
  });

  it('isolation under load marks shutdown as failed', () => {
    const m = hardwired();
    tap(m, 'PB_START');
    m.run(2000);
    m.acknowledge('notify');
    m.setDisconnect('DS', false);
    expect(m.loto().steps.shutdown).toBe('failed');
    expect(m.loto().steps.isolate).toBe('done');
  });

  it('order matters: locking before notify does not count', () => {
    const m = hardwired();
    m.setDisconnect('DS', false);
    m.applyLock('DS');
    expect(m.loto().steps.lockout).toBe('pending');
    expect(m.loto().current).toBe('notify');
  });

  it('verification needs live-dead-live on the right points', () => {
    const m = hardwired();
    m.acknowledge('notify');
    m.setDisconnect('DS', false);
    m.applyLock('DS');
    m.acknowledge('stored_energy_checked');
    tap(m, 'PB_START');
    // dead checks before the first live check do not count
    for (const [a, b] of m.def.loto.verifyPoints) m.measure(a, b, 'VAC');
    expect(m.loto().verify.points.some((p) => p.ok)).toBe(false);
    m.measure('DS:L1', 'DS:L2', 'OHM'); // wrong mode ignored (and flagged: line side is live)
    m.measure('DS:L2', 'DS:L1', 'VAC'); // live (reversed probes are fine)
    m.measure('DS:L1', 'DS:L3', 'VAC'); // live but not all dead yet: no-op
    m.measure('DS:T1', 'DS:T2', 'VAC');
    expect(m.loto().steps.verify).toBe('pending');
    for (const [a, b] of m.def.loto.verifyPoints) m.measure(a, b, 'VAC');
    m.measure('M:A1', 'M:A2', 'VAC'); // irrelevant point
    expect(m.loto().verify.liveBefore).toBe(true);
    expect(m.loto().steps.verify).toBe('pending');
    m.measure('DS:L1', 'DS:L3', 'VAC');
    expect(m.loto().steps.verify).toBe('done');
    expect(m.loto().verify.liveAfter).toBe(true);
  });

  it('removing the lock before work is done resets the procedure', () => {
    const m = hardwired();
    lockOut(m);
    m.removeLock('DS');
    expect(m.violations()).toContain('lock_removed_before_restore');
    const s = m.loto();
    expect(s.steps.lockout).toBe('pending');
    expect(s.workAllowed).toBe(false);
  });

  it('re-energizing mid-procedure starts over', () => {
    const m = hardwired();
    m.acknowledge('notify');
    m.setDisconnect('DS', false);
    m.setDisconnect('DS', true);
    expect(m.loto().steps.isolate).toBe('pending');
  });

  it('a non-zero reading on a verify point is a hazard that blocks work', () => {
    const m = hardwired();
    const def = m.def;
    const t = (type: string, extra = {}) => ({ t: 0, type, ...extra }) as never;
    const meas = (a: string, b: string, value: number) =>
      t('measure', { reading: { mode: 'VAC', a, b, value, unit: 'V', display: '' }, energized: value > 2 });
    const events = [
      t('notify'), t('disconnect', { component: 'DS', on: false, underLoad: false }),
      t('lock_applied', { component: 'DS', owner: 'x' }), t('stored_energy_checked'), t('press', { component: 'PB_START' }),
      meas('DS:L1', 'DS:L2', 600), meas('DS:T1', 'DS:T2', 600),
      ...def.loto.verifyPoints.slice(1).map(([a, b]) => meas(a, b, 0)), meas('DS:L1', 'DS:L2', 600),
      t('disconnect', { component: 'OTHER', on: false, underLoad: false }), t('lock_applied', { component: 'OTHER', owner: 'x' }),
      t('work_done'),
    ];
    const s = computeLoto(def, events);
    expect(s.hazardFound).toBe(true);
    expect(s.steps.verify).toBe('pending');
    expect(s.workAllowed).toBe(false);
  });
});
