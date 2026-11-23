import { describe, expect, it } from 'vitest';
import {
  BUILDER_TYPES, addComponent, checkStarterBuild, connect, emptyMachine, finalize, moveComponent, nextComponentId,
  removeComponent, removeWire, rotateComponent, setParam, setTag, validateBuild, withoutWires, Machine,
} from '../src';
import { loadDef } from './helpers';

const CONTROL_WIRES = ['W30', 'W31', 'W32', 'W33', 'W34', 'W35', 'W36', 'W37'];
const control: Array<[string, string]> = [
  ['PB_STOP:2', 'PB_ES:1'], ['PB_ES:2', 'J3:T'], ['J3:T', 'PB_START:1'], ['J3:T', 'M:13'],
  ['PB_START:2', 'J4:T'], ['M:14', 'J4:T'], ['J4:T', 'M:A1'], ['M:A2', 'OL:95'],
];

describe('builder editing', () => {
  it('places components with unique ids and lays out multi-part components', () => {
    let d = emptyMachine();
    const a = addComponent(d, 'contactor', [103, 47]);
    d = a.def;
    expect(a.id).toBe('K1');
    const k = d.components[0]!;
    expect(Object.keys(k.parts)).toEqual(['poles', 'coil', 'aux', 'aux_nc']);
    expect(k.parts.poles!.at).toEqual([100, 50]);
    expect(k.parts.coil!.at[0]).toBeGreaterThan(k.parts.poles!.at[0]);
    d = addComponent(d, 'contactor', [0, 300]).def;
    expect(d.components.map((c) => c.id)).toEqual(['K1', 'K2']);
    expect(nextComponentId(d, 'fuse')).toBe('F1');
    expect(() => addComponent(d, 'plc_input', [0, 0])).toThrow();
    expect(() => addComponent(d, 'nope', [0, 0])).toThrow();
    expect(BUILDER_TYPES).not.toContain('plc_output');
  });

  it('does not mutate its input', () => {
    const d = emptyMachine();
    addComponent(d, 'fuse', [10, 10]);
    expect(d.components).toHaveLength(0);
  });

  it('moves, rotates, retags and sets parameters', () => {
    let d = addComponent(emptyMachine(), 'contactor', [100, 100]).def;
    d = moveComponent(d, 'K1', 24, -17);
    expect(d.components[0]!.parts.poles!.at).toEqual([120, 80]);
    d = rotateComponent(d, 'K1');
    expect(d.components[0]!.parts.poles!.rot).toBe(90);
    expect(d.components[0]!.parts.coil!.rot).toBe(90);
    for (let i = 0; i < 3; i++) d = rotateComponent(d, 'K1');
    expect(d.components[0]!.parts.poles!.rot).toBeUndefined();
    d = setTag(d, 'K1', ' KM ');
    expect(d.components[0]!.tag).toBe('KM');
    d = setTag(d, 'K1', '  ');
    expect(d.components[0]!.tag).toBe('K1');
    d = setParam(d, 'K1', 'coilV', 24);
    expect(d.components[0]!.params).toEqual({ coilV: 24 });
    for (const f of [() => moveComponent(d, 'X', 1, 1), () => rotateComponent(d, 'X'), () => setTag(d, 'X', 'a'), () => setParam(d, 'X', 'a', 1)]) expect(f).toThrow();
  });

  it('wires terminals, rejects bad connections, and removes wires with their component', () => {
    let d = addComponent(emptyMachine(), 'fuse', [0, 0]).def;
    d = addComponent(d, 'fuse', [200, 0]).def;
    d = addComponent(d, 'fuse', [400, 0]).def;
    const r = connect(d, 'F1:2', 'F2:1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    d = r.def;
    expect(d.wires).toEqual([{ id: 'W1', from: 'F1:2', to: 'F2:1' }]);
    expect(connect(d, 'F1:2', 'F1:2')).toEqual({ ok: false, reason: 'same' });
    expect(connect(d, 'F2:1', 'F1:2')).toEqual({ ok: false, reason: 'duplicate' });
    expect(connect(d, 'F1:2', 'F9:1')).toEqual({ ok: false, reason: 'unknown' });
    expect(connect(d, 'F1:2', 'F2:9')).toEqual({ ok: false, reason: 'unknown' });
    const r2 = connect(d, 'F2:2', 'F3:1');
    if (r2.ok) d = r2.def;
    expect(d.wires.map((w) => w.id)).toEqual(['W1', 'W2']);
    expect(removeWire(d, 'W1').wires.map((w) => w.id)).toEqual(['W2']);
    const gone = removeComponent(d, 'F2');
    expect(gone.components.map((c) => c.id)).toEqual(['F1', 'F3']);
    expect(gone.wires).toEqual([]);
    // ids stay unique after a deletion in the middle
    const r3 = connect(removeWire(d, 'W1'), 'F1:1', 'F1:2');
    expect(r3.ok && r3.id).toBe('W2'.replace('2', '3'));
  });
});

describe('builder validation', () => {
  it('flags an empty sheet, a missing source and a missing wire', () => {
    expect(validateBuild(emptyMachine())).toEqual([{ level: 'warning', code: 'empty' }]);
    const d = addComponent(emptyMachine(), 'fuse', [0, 0]).def;
    expect(validateBuild(d).map((i) => i.code)).toEqual(['no_source', 'no_wires']);
    const withSrc = addComponent(d, 'source3', [0, 100]).def;
    expect(validateBuild(withSrc).map((i) => i.code)).toEqual(['no_wires']);
  });

  it('reports an invalid definition instead of throwing', () => {
    const d = addComponent(emptyMachine(), 'fuse', [0, 0]).def;
    d.wires.push({ id: 'W1', from: 'F1:1', to: 'F9:1' });
    expect(validateBuild(d).some((i) => i.code === 'invalid' && /F9/.test(i.detail ?? ''))).toBe(true);
  });

  it('finalize derives a runnable LOTO section and sizes the sheet', () => {
    let d = addComponent(emptyMachine(), 'disconnect3', [1900, 900]).def;
    d = addComponent(d, 'pushbutton', [10, 400]).def;
    const f = finalize(d);
    expect(f.loto.isolators).toEqual(['DS1']);
    expect(f.loto.knownLive).toHaveLength(3);
    expect(f.loto.tryStart).toBe('PB1');
    expect(f.viewBox[0]).toBeGreaterThanOrEqual(2150);
    expect(() => new Machine(f)).not.toThrow();
    expect(finalize(emptyMachine()).loto.isolators).toEqual([]);
  });
});

describe('withoutWires', () => {
  it('also drops the faults that target a removed wire, so the result stays loadable', () => {
    const base = loadDef('motor-starter-3w');
    expect(base.faults.some((f) => CONTROL_WIRES.includes(f.target))).toBe(true);
    const d = withoutWires(base, CONTROL_WIRES);
    expect(d.faults.some((f) => CONTROL_WIRES.includes(f.target))).toBe(false);
    expect(validateBuild(d).filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('starter build check', () => {
  it('passes once the 8 control wires are in place, whichever order they are drawn', () => {
    let d = withoutWires(loadDef('motor-starter-3w'), CONTROL_WIRES);
    expect(checkStarterBuild(d).passed).toBe(false);
    for (const [a, b] of [...control].reverse()) {
      const r = connect(d, a, b);
      expect(r.ok).toBe(true);
      if (r.ok) d = r.def;
    }
    const res = checkStarterBuild(d);
    expect(res.steps.filter((s) => !s.pass)).toEqual([]);
    expect(res.passed).toBe(true);
  });

  it('fails the seal-in step when the auxiliary contact is not wired', () => {
    let d = withoutWires(loadDef('motor-starter-3w'), CONTROL_WIRES);
    for (const [a, b] of control.filter(([x, y]) => !/^M:1[34]$/.test(x) && !/^M:1[34]$/.test(y))) {
      const r = connect(d, a, b);
      if (r.ok) d = r.def;
    }
    // the 13-14 auxiliary contact is left unwired: START works but nothing holds the coil
    const res = checkStarterBuild(d);
    expect(res.passed).toBe(false);
    expect(res.steps.find((s) => s.id === 'start')!.pass).toBe(true);
    expect(res.steps.find((s) => s.id === 'seal_in')!.pass).toBe(false);
  });

  it('reports a missing role and an invalid definition', () => {
    const d = addComponent(emptyMachine(), 'fuse', [0, 0]).def;
    const r = checkStarterBuild(d);
    expect(r.passed).toBe(false);
    expect(r.steps[1]!.detail).toMatch(/START/);
    const bad = { ...d, wires: [{ id: 'W1', from: 'F1:1', to: 'Z:1' }] };
    expect(checkStarterBuild(bad).steps[0]).toMatchObject({ id: 'valid', pass: false });
  });

  it('detects a start that never releases (STOP shorted out) as a failed stop', () => {
    let d = withoutWires(loadDef('motor-starter-3w'), CONTROL_WIRES);
    for (const [a, b] of control) {
      const r = connect(d, a, b);
      if (r.ok) d = r.def;
    }
    // bypass STOP/E-stop: wire 1 straight to the start rung
    const r = connect(d, 'J1A:T', 'J3:T');
    if (r.ok) d = r.def;
    const res = checkStarterBuild(d);
    expect(res.passed).toBe(false);
    expect(res.steps.find((s) => s.id === 'stop')!.pass).toBe(false);
  });
});
