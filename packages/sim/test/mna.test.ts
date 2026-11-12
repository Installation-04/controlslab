import { describe, expect, it } from 'vitest';
import { GND, Network, complex, gaussSolve } from '../src';

const { C, abs, polar } = complex;

describe('MNA solver', () => {
  it('voltage divider', () => {
    const n = new Network();
    n.vsource('v', 'a', GND, C(120));
    n.resistor('r1', 'a', 'b', 100);
    n.resistor('r2', 'b', GND, 300);
    const s = n.solve();
    expect(abs(s.v('b'))).toBeCloseTo(90, 4);
    expect(abs(s.current('r1'))).toBeCloseTo(0.3, 4);
    expect(abs(s.current('nope'))).toBe(0);
  });

  it("Ohm's law with a current source", () => {
    const n = new Network();
    n.isource('i', GND, 'a', C(0.002));
    n.resistor('r', 'a', GND, 1000);
    expect(abs(n.solve().v('a'))).toBeCloseTo(2, 4);
  });

  it('three-phase wye: 347 V L-N gives 600 V L-L', () => {
    const n = new Network();
    [0, -120, 120].forEach((d, i) => n.vsource(`v${i}`, `L${i}`, GND, polar(346.41, d)));
    const s = n.solve();
    expect(abs(s.vab('L0', 'L1'))).toBeCloseTo(600, 0);
    expect(abs(s.vab('L1', 'L2'))).toBeCloseTo(600, 0);
  });

  it('ideal transformer steps down and reflects load to primary', () => {
    const n = new Network();
    n.vsource('v', 'p', GND, C(600));
    n.transformer('x', 'p', GND, 's', GND, 5);
    n.resistor('load', 's', GND, 120); // 1 A secondary
    const s = n.solve();
    expect(abs(s.v('s'))).toBeCloseTo(120, 4);
    expect(abs(s.current('v'))).toBeCloseTo(0.2, 4);
    expect(abs(s.current('x'))).toBeCloseTo(1, 4);
  });

  it('floating islands solve to ~0 V thanks to GMIN; unknown nodes read 0', () => {
    const n = new Network();
    n.vsource('v', 'a', GND, C(120));
    n.resistor('r', 'x', 'y', 10);
    const s = n.solve();
    expect(abs(s.v('x'))).toBeLessThan(1e-6);
    expect(abs(s.v('zzz'))).toBe(0);
    expect(abs(s.v(GND))).toBe(0);
  });

  it('gaussSolve detects singular systems', () => {
    expect(() => gaussSolve([[C(0), C(0)], [C(0), C(0)]], [C(1), C(1)])).toThrow(/Singular/);
  });
});
