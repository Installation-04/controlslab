import { describe, expect, it } from 'vitest';
import { PlcRuntime } from '../src';
import { NATIVE_FBS } from '../src/stdlib';
import { prog, run } from './helpers';

/** Build a runtime whose inputs drive a single FB and expose its outputs. */
function fb(type: string, call: string, vars = '') {
  return run(prog(`f : ${type}; ${vars}`, call));
}

describe('TON', () => {
  const src = () => fb('TON', 'f(IN := %IX0.0, PT := T#100ms);');
  it('Q rises only after PT of continuous IN; ET clamps at PT', () => {
    const p = src();
    p.setInput('%IX0.0', true);
    p.runFor(90);
    expect(p.read('f.Q')).toBe(false);
    expect(p.read('f.ET')).toBe(80); // first scan starts the timer at t=10
    p.runFor(20);
    expect(p.read('f.Q')).toBe(true);
    p.runFor(200);
    expect(p.read('f.ET')).toBe(100);
  });
  it('dropping IN resets ET and Q', () => {
    const p = src();
    p.setInput('%IX0.0', true);
    p.runFor(60);
    p.setInput('%IX0.0', false);
    p.scan();
    expect([p.read('f.Q'), p.read('f.ET')]).toEqual([false, 0]);
    p.setInput('%IX0.0', true);
    p.runFor(60);
    expect(p.read('f.Q')).toBe(false); // restarted from 0
  });
  it('PT = 0 gives Q immediately', () => {
    const p = fb('TON', 'f(IN := TRUE, PT := T#0s);');
    p.scan();
    expect(p.read('f.Q')).toBe(true);
  });
});

describe('TOF', () => {
  it('Q follows IN up and holds PT after falling', () => {
    const p = fb('TOF', 'f(IN := %IX0.0, PT := T#50ms);');
    p.scan();
    expect(p.read('f.Q')).toBe(false);
    p.setInput('%IX0.0', true);
    p.scan();
    expect(p.read('f.Q')).toBe(true);
    p.setInput('%IX0.0', false);
    p.runFor(40);
    expect(p.read('f.Q')).toBe(true);
    p.runFor(20);
    expect(p.read('f.Q')).toBe(false);
    expect(p.read('f.ET')).toBe(50);
  });
  it('IN returning during the delay cancels it', () => {
    const p = fb('TOF', 'f(IN := %IX0.0, PT := T#50ms);');
    p.setInput('%IX0.0', true);
    p.scan();
    p.setInput('%IX0.0', false);
    p.runFor(30);
    p.setInput('%IX0.0', true);
    p.scan();
    expect([p.read('f.Q'), p.read('f.ET')]).toEqual([true, 0]);
  });
});

describe('TP', () => {
  it('fixed-length pulse, not retriggerable, ET resets when IN low after pulse', () => {
    const p = fb('TP', 'f(IN := %IX0.0, PT := T#50ms);');
    p.setInput('%IX0.0', true);
    p.scan();
    expect(p.read('f.Q')).toBe(true);
    p.setInput('%IX0.0', false);
    p.runFor(30);
    expect(p.read('f.Q')).toBe(true); // continues though IN low
    p.setInput('%IX0.0', true); // retrigger attempt ignored
    p.runFor(30);
    expect(p.read('f.Q')).toBe(false);
    expect(p.read('f.ET')).toBe(50); // held while IN high
    p.setInput('%IX0.0', false);
    p.scan();
    expect(p.read('f.ET')).toBe(0);
    p.setInput('%IX0.0', true);
    p.scan();
    expect(p.read('f.Q')).toBe(true);
  });
});

describe('counters', () => {
  it('CTU counts rising edges only; R resets with priority; Q at PV', () => {
    const p = fb('CTU', 'f(CU := %IX0.0, R := %IX0.1, PV := 3);');
    const pulse = () => {
      p.setInput('%IX0.0', true);
      p.scan();
      p.scan(); // held high: no extra count
      p.setInput('%IX0.0', false);
      p.scan();
    };
    pulse();
    pulse();
    expect([p.read('f.CV'), p.read('f.Q')]).toEqual([2, false]);
    pulse();
    expect([p.read('f.CV'), p.read('f.Q')]).toEqual([3, true]);
    p.setInput('%IX0.1', true);
    p.setInput('%IX0.0', true);
    p.scan();
    expect(p.read('f.CV')).toBe(0);
  });

  it('CTU saturates at INT max, CTD at INT min', () => {
    const up = NATIVE_FBS.get('CTU')!.create();
    up.vars.CV = 32766;
    for (let i = 0; i < 4; i++) {
      up.vars.CU = i % 2 === 0;
      up.execute({ now: 0 });
    }
    expect(up.vars.CV).toBe(32767);
    const down = NATIVE_FBS.get('CTD')!.create();
    down.vars.CV = -32767;
    for (let i = 0; i < 4; i++) {
      down.vars.CD = i % 2 === 0;
      down.execute({ now: 0 });
    }
    expect(down.vars.CV).toBe(-32768);
  });

  it('CTD loads PV and counts down to Q', () => {
    const p = fb('CTD', 'f(CD := %IX0.0, LD := %IX0.1, PV := 2);');
    p.setInput('%IX0.1', true);
    p.scan();
    p.setInput('%IX0.1', false);
    expect(p.read('f.CV')).toBe(2);
    for (let i = 0; i < 3; i++) {
      p.setInput('%IX0.0', true);
      p.scan();
      p.setInput('%IX0.0', false);
      p.scan();
    }
    expect(p.read('f.CV')).toBe(-1);
    expect(p.read('f.Q')).toBe(true);
  });

  it('CTUD up/down, simultaneous edges cancel, R and LD', () => {
    const p = fb('CTUD', 'f(CU := %IX0.0, CD := %IX0.1, R := %IX0.2, LD := %IX0.3, PV := 2);');
    const edge = (u: boolean, d: boolean) => {
      p.setInputs({ '%IX0.0': u, '%IX0.1': d });
      p.scan();
      p.setInputs({ '%IX0.0': false, '%IX0.1': false });
      p.scan();
    };
    edge(true, false);
    edge(true, false);
    expect([p.read('f.CV'), p.read('f.QU'), p.read('f.QD')]).toEqual([2, true, false]);
    edge(true, true);
    expect(p.read('f.CV')).toBe(2);
    edge(false, true);
    expect(p.read('f.CV')).toBe(1);
    p.setInput('%IX0.3', true);
    p.scan();
    p.setInput('%IX0.3', false);
    expect(p.read('f.CV')).toBe(2);
    p.setInput('%IX0.2', true);
    p.scan();
    expect([p.read('f.CV'), p.read('f.QD')]).toEqual([0, true]);
  });
});

describe('edges & bistables', () => {
  it('R_TRIG / F_TRIG pulse for exactly one scan', () => {
    const p = run(prog('r : R_TRIG; f : F_TRIG; rc, fc : INT;', 'r(CLK := %IX0.0); f(CLK := %IX0.0); IF r.Q THEN rc := rc + 1; END_IF; IF f.Q THEN fc := fc + 1; END_IF'));
    p.setInput('%IX0.0', true);
    p.scan();
    expect(p.read('r.Q')).toBe(true);
    p.scan();
    expect(p.read('r.Q')).toBe(false);
    p.setInput('%IX0.0', false);
    p.scan();
    expect(p.read('f.Q')).toBe(true);
    p.scan();
    expect([p.read('rc'), p.read('fc')]).toEqual([1, 1]);
  });

  it('SR is set-dominant, RS is reset-dominant', () => {
    const p = run(prog('sr : SR; rs : RS;', 'sr(S1 := %IX0.0, R := %IX0.1); rs(S := %IX0.0, R1 := %IX0.1);'));
    p.setInputs({ '%IX0.0': true, '%IX0.1': true });
    p.scan();
    expect([p.read('sr.Q1'), p.read('rs.Q1')]).toEqual([true, false]);
    p.setInputs({ '%IX0.0': true, '%IX0.1': false });
    p.scan();
    p.setInputs({ '%IX0.0': false, '%IX0.1': false });
    p.scan();
    expect([p.read('sr.Q1'), p.read('rs.Q1')]).toEqual([true, true]);
    p.setInputs({ '%IX0.1': true });
    p.scan();
    expect([p.read('sr.Q1'), p.read('rs.Q1')]).toEqual([false, false]);
  });
});

describe('runtime', () => {
  const SEAL_IN = `PROGRAM Main
    VAR
      Start AT %IX0.0 : BOOL;  (* NO *)
      Stop  AT %IX0.1 : BOOL;  (* NC wired: TRUE when healthy *)
      OL    AT %IX0.2 : BOOL;  (* NC aux *)
      Motor AT %QX0.0 : BOOL;
    END_VAR
    Motor := (Start OR Motor) AND Stop AND OL;
  END_PROGRAM`;

  it('motor seal-in: start latches, stop/OL drop out', () => {
    const p = run(SEAL_IN);
    p.setInputs({ '%IX0.1': true, '%IX0.2': true });
    p.scan();
    expect(p.getOutput('%QX0.0')).toBe(false);
    p.setInput('%IX0.0', true);
    p.scan();
    p.setInput('%IX0.0', false);
    p.scan();
    expect(p.getOutput('%QX0.0')).toBe(true);
    p.setInput('%IX0.2', false);
    p.scan();
    expect(p.getOutput('%QX0.0')).toBe(false);
  });

  it('lists I/O points and symbols', () => {
    const p = run(SEAL_IN);
    expect(p.ioPoints.map((x) => `${x.area}:${x.address}:${x.name}`)).toEqual([
      'I:%IX0.0:Start', 'I:%IX0.1:Stop', 'I:%IX0.2:OL', 'Q:%QX0.0:Motor',
    ]);
    expect(p.symbols().map((s) => s.path)).toContain('Main.Motor');
    expect(p.read('%QX0.0')).toBe(false);
  });

  it('outputs are de-energized in STOP; load errors keep PLC empty', () => {
    const p = run(prog('o AT %QX0.0 : BOOL; w AT %QW1 : INT;', 'o := TRUE; w := 5;'));
    p.scan();
    expect(p.getOutputs()).toEqual({ '%QX0.0': true, '%QW1': 5 });
    p.stop();
    expect(p.getOutputs()).toEqual({ '%QX0.0': false, '%QW1': 0 });
    expect(p.scan()).toBe(false);
    p.start();
    expect(p.mode).toBe('running');

    const q = new PlcRuntime();
    expect(q.mode).toBe('empty');
    expect(q.load('PROGRAM').ok).toBe(false);
    expect(q.mode).toBe('empty');
    expect(q.getOutputs()).toEqual({});
    expect(q.scan()).toBe(false);
    q.reset();
    expect(q.read('x')).toBeUndefined();
    expect(q.symbols()).toEqual([]);
    expect(q.ioPoints).toEqual([]);
    expect(q.now).toBe(0);
  });

  it('declared outputs never written still appear in the image', () => {
    const p = run(prog('o AT %QX0.3 : BOOL;', ';'));
    expect(p.getOutputs()).toEqual({ '%QX0.3': false });
  });

  it('direct addresses usable without declaration; memory area', () => {
    const p = run(prog('', '%QX0.1 := %IX0.5; %MW0 := %MW0 + 1;'));
    p.setInput('%IX0.5', true);
    p.runFor(30);
    expect(p.getOutput('%QX0.1')).toBe(true);
    expect(p.read('%MW0')).toBe(3);
  });

  it('rejects writing a non-input via setInput', () => {
    const p = new PlcRuntime();
    expect(() => p.setInput('%QX0.0', true)).toThrow();
  });

  it('reset restores initial values and clock', () => {
    const p = run(prog('n : INT := 5;', 'n := n + 1;'));
    p.runFor(50);
    expect(p.read('n')).toBe(10);
    expect(p.now).toBe(50);
    expect(p.scanCount).toBe(5);
    p.reset();
    expect([p.read('n'), p.now, p.mode]).toEqual([5, 0, 'stopped']);
  });

  it('snapshot copies arrays and includes FB members', () => {
    const p = run(prog('a : ARRAY[0..1] OF INT; t : TON;', 'a[0] := 1;'));
    p.scan();
    const s = p.snapshot();
    expect(s['Main.a']).toEqual([1, 0]);
    expect(s['Main.t.Q']).toBe(false);
  });

  it('read() handles unknown paths', () => {
    const p = run(prog('t : TON; i : INT;', ''));
    expect(p.read('nope')).toBeUndefined();
    expect(p.read('Main')).toBeUndefined();
    expect(p.read('i.x.y')).toBeUndefined();
    expect(p.read('t.nope.deeper')).toBeUndefined();
  });

  it('AT variable initial value goes to the image', () => {
    const p = run(prog('o AT %QX0.0 : BOOL := TRUE;', ';'));
    expect(p.getOutput('%QX0.0')).toBe(true);
  });

  it('global AT variables', () => {
    const p = run('VAR_GLOBAL Lamp AT %QX1.0 : BOOL; END_VAR PROGRAM Main Lamp := TRUE; END_PROGRAM');
    p.scan();
    expect(p.getOutput('%QX1.0')).toBe(true);
    expect(p.ioPoints[0]).toMatchObject({ program: '', area: 'Q' });
  });
});
