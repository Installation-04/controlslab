import { describe, expect, it } from 'vitest';
import { PlcRuntime } from '@controlslab/plc-engine';
import {
  addAfter, addParallel, cloneWithNewIds, coil, contact, emptyProgram, find, leaves, normalize, parallel, parentOf, parseLd,
  removeNode, rung, series, solveRung, toST, updateNode, validateLd, uid, type LdProgram, type LogicNode,
} from '../src';

const sealIn = (): LdProgram => ({
  v: 1,
  name: 'Main',
  vars: [
    { name: 'Marche', type: 'BOOL', address: '%IX0.0' },
    { name: 'Arret', type: 'BOOL', address: '%IX0.1' },
    { name: 'Surcharge', type: 'BOOL', address: '%IX0.2' },
    { name: 'BobineM', type: 'BOOL', address: '%QX0.0' },
  ],
  rungs: [
    rung(series(parallel(contact('Marche'), contact('BobineM')), contact('Arret'), contact('Surcharge', 'NC')), [coil('BobineM')], 'Auto-maintien'),
  ],
});

const run = (p: LdProgram) => {
  const plc = new PlcRuntime({ scanMs: 10 });
  const r = plc.load(toST(p));
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('\n') + '\n' + toST(p));
  plc.start();
  return plc;
};

describe('Ladder → ST (executed by the real engine)', () => {
  it('seal-in rung behaves like a motor starter', () => {
    const plc = run(sealIn());
    plc.setInputs({ '%IX0.1': true });
    plc.scan();
    expect(plc.getOutput('%QX0.0')).toBe(false);
    plc.setInput('%IX0.0', true);
    plc.scan();
    plc.setInput('%IX0.0', false);
    plc.scan();
    expect(plc.getOutput('%QX0.0')).toBe(true);
    plc.setInput('%IX0.2', true); // overload (NC contact opens)
    plc.scan();
    expect(plc.getOutput('%QX0.0')).toBe(false);
  });

  it('generates readable ST with one BOOL per rung', () => {
    const st = toST(sealIn());
    expect(st).toContain('PROGRAM Main');
    expect(st).toContain('Marche AT %IX0.0 : BOOL;');
    expect(st).toContain('_R1 : BOOL;');
    expect(st).toContain('_R1 := (Marche OR BobineM) AND Arret AND NOT Surcharge;');
    expect(st).toContain('(* Échelon 1 — Auto-maintien *)');
    expect(st).toContain('BobineM := _R1;');
  });

  it('negated, set and reset coils; empty rung is TRUE', () => {
    const p: LdProgram = {
      v: 1, name: 'Main',
      vars: [{ name: 'A', type: 'BOOL' }, { name: 'B', type: 'BOOL' }, { name: 'N', type: 'BOOL' }, { name: 'S', type: 'BOOL' }, { name: 'T', type: 'BOOL' }],
      rungs: [
        rung(contact('A'), [coil('N', 'negated')]),
        rung(contact('A'), [coil('S', 'set')]),
        rung(contact('B'), [coil('S', 'reset')]),
        rung(null, [coil('T')]),
      ],
    };
    const plc = run(p);
    plc.scan();
    expect([plc.read('N'), plc.read('S'), plc.read('T')]).toEqual([true, false, true]);
  });

  it('set/reset latch keeps state', () => {
    const p: LdProgram = {
      v: 1, name: 'Main',
      vars: [{ name: 'Go', type: 'BOOL', address: '%IX0.0' }, { name: 'Stop', type: 'BOOL', address: '%IX0.1' }, { name: 'L', type: 'BOOL', address: '%QX0.0' }],
      rungs: [rung(contact('Go'), [coil('L', 'set')]), rung(contact('Stop'), [coil('L', 'reset')])],
    };
    const plc = run(p);
    plc.setInput('%IX0.0', true);
    plc.scan();
    plc.setInput('%IX0.0', false);
    plc.scan();
    expect(plc.getOutput('%QX0.0')).toBe(true);
    plc.setInput('%IX0.1', true);
    plc.scan();
    expect(plc.getOutput('%QX0.0')).toBe(false);
  });

  it('TON timer: contact on T1.Q, time literal', () => {
    const p: LdProgram = {
      v: 1, name: 'Main',
      vars: [{ name: 'Go', type: 'BOOL', address: '%IX0.0' }, { name: 'Out', type: 'BOOL', address: '%QX0.0' }],
      rungs: [
        rung(contact('Go'), [{ id: uid('o'), t: 'timer', fb: 'TON', name: 'T1', pt: 'T#100ms' }]),
        rung(contact('T1.Q'), [coil('Out')]),
      ],
    };
    const plc = run(p);
    plc.setInput('%IX0.0', true);
    plc.runFor(60);
    expect(plc.getOutput('%QX0.0')).toBe(false);
    plc.runFor(80);
    expect(plc.getOutput('%QX0.0')).toBe(true);
  });

  it('CTU counter with reset variable', () => {
    const p: LdProgram = {
      v: 1, name: 'Main',
      vars: [{ name: 'Pulse', type: 'BOOL', address: '%IX0.0' }, { name: 'Rst', type: 'BOOL', address: '%IX0.1' }, { name: 'Full', type: 'BOOL', address: '%QX0.0' }],
      rungs: [rung(contact('Pulse'), [{ id: uid('o'), t: 'counter', fb: 'CTU', name: 'C1', pv: 3, reset: 'Rst' }]), rung(contact('C1.Q'), [coil('Full')])],
    };
    const plc = run(p);
    for (let i = 0; i < 3; i++) {
      plc.setInput('%IX0.0', true);
      plc.scan();
      plc.setInput('%IX0.0', false);
      plc.scan();
    }
    expect(plc.getOutput('%QX0.0')).toBe(true);
    plc.setInput('%IX0.1', true);
    plc.scan();
    expect(plc.getOutput('%QX0.0')).toBe(false);
  });

  it('rising-edge (P) and falling-edge (N) contacts pulse for one scan', () => {
    const p: LdProgram = {
      v: 1, name: 'Main',
      vars: [{ name: 'In', type: 'BOOL', address: '%IX0.0' }, { name: 'Up', type: 'BOOL', address: '%QX0.0' }, { name: 'Down', type: 'BOOL', address: '%QX0.1' }],
      rungs: [rung(contact('In', 'P'), [coil('Up')]), rung(contact('In', 'N'), [coil('Down')])],
    };
    const plc = run(p);
    plc.setInput('%IX0.0', true);
    plc.scan();
    expect([plc.getOutput('%QX0.0'), plc.getOutput('%QX0.1')]).toEqual([true, false]);
    plc.scan();
    expect(plc.getOutput('%QX0.0')).toBe(false);
    plc.setInput('%IX0.0', false);
    plc.scan();
    expect(plc.getOutput('%QX0.1')).toBe(true);
  });

  it('comparison contact', () => {
    const p: LdProgram = {
      v: 1, name: 'Main',
      vars: [{ name: 'Lvl', type: 'INT' }, { name: 'High', type: 'BOOL', address: '%QX0.0' }],
      rungs: [rung({ id: uid('c'), t: 'cmp', a: 'Lvl', op: '>=', b: '5' }, [coil('High')]), rung(null, [])],
    };
    const st = toST(p);
    expect(st).toContain('(Lvl >= 5)');
    const plc = run(p);
    plc.scan();
    expect(plc.getOutput('%QX0.0')).toBe(false);
  });

  it('multiple outputs on one rung and invalid operands are marked, not injected', () => {
    const p: LdProgram = { v: 1, name: 'Main', vars: [{ name: 'A', type: 'BOOL' }, { name: 'X', type: 'BOOL' }, { name: 'Y', type: 'BOOL' }], rungs: [rung(contact('A; DROP'), [coil('X'), coil('Y', 'negated')])] };
    const st = toST(p);
    expect(st).toContain('opérande invalide');
    expect(st).not.toContain('DROP;');
    expect(st).toContain('X := _R1;');
    expect(st).toContain('Y := NOT _R1;');
  });
});

describe('tree operations', () => {
  const a = contact('A');
  const b = contact('B');
  const c = contact('C');

  it('addAfter builds a series and inserts in the middle', () => {
    let l: LogicNode | null = a;
    l = addAfter(l, a.id, c);
    l = addAfter(l, a.id, b);
    expect(l.t).toBe('series');
    expect(leaves(l).map((x) => (x as { v: string }).v)).toEqual(['A', 'B', 'C']);
    expect(addAfter(null, null, a)).toBe(a);
    expect(addAfter(a, null, b).t).toBe('series');
  });

  it('addParallel wraps a leaf or appends a branch to an existing parallel', () => {
    let l: LogicNode | null = addParallel(a, a.id, b);
    expect(l.t).toBe('parallel');
    l = addParallel(l, b.id, c);
    expect(l.t).toBe('parallel');
    expect(leaves(l)).toHaveLength(3);
    expect(addParallel(null, null, a)).toBe(a);
    expect(addParallel(a, null, b).t).toBe('parallel');
  });

  it('parallel across a whole series group (select parent then add)', () => {
    const s = addAfter(a, a.id, b);
    const d = contact('D');
    const l = addParallel(s, s.id, d);
    expect(l.t).toBe('parallel');
    expect((l as { items: LogicNode[] }).items[0]!.t).toBe('series');
  });

  it('removeNode collapses single-item groups and empties the rung', () => {
    const l = addAfter(a, a.id, b);
    const r = removeNode(l, b.id);
    expect(r).toMatchObject({ t: 'contact', v: 'A' });
    expect(removeNode(r, a.id)).toBeNull();
    expect(removeNode(null, 'x')).toBeNull();
  });

  it('find / parentOf / updateNode / normalize / clone', () => {
    const l = addAfter(a, a.id, b);
    expect(find(l, b.id)).toMatchObject({ v: 'B' });
    expect(find(l, 'nope')).toBeNull();
    expect(find(null, 'x')).toBeNull();
    expect(parentOf(l, b.id)?.t).toBe('series');
    expect(parentOf(l, 'nope')).toBeNull();
    expect(parentOf(a, a.id)).toBeNull();
    const u = updateNode(l, b.id, { k: 'NC', v: 'Z' });
    expect((find(u, b.id) as { k: string; v: string }).k).toBe('NC');
    expect(updateNode(null, 'x', {})).toBeNull();
    expect(normalize({ id: 'g', t: 'series', items: [{ id: 'g2', t: 'series', items: [a, b] }, c] })).toMatchObject({ t: 'series' });
    expect(normalize({ id: 'g', t: 'parallel', items: [] })).toBeNull();
    expect(normalize(null)).toBeNull();
    const copy = cloneWithNewIds(l);
    expect(copy.id).not.toBe(l.id);
    expect(leaves(copy).map((x) => x.id)).not.toContain(a.id);
  });
});

describe('power flow', () => {
  it('lights the path through the contacts that conduct', () => {
    const r = sealIn().rungs[0]!;
    const values: Record<string, boolean> = { Marche: false, BobineM: true, Arret: true, Surcharge: false };
    const f = solveRung(r, (n) => values[n]);
    expect(f.power).toBe(true);
    const leavesF = leaves(r.logic).map((l) => f.flows.get(l.id)!);
    expect(leavesF.map((x) => x.closed)).toEqual([false, true, true, true]);
    const off = solveRung(r, (n) => ({ ...values, Arret: false })[n]);
    expect(off.power).toBe(false);
  });

  it('empty rung conducts; comparisons; edges use the supplied memory', () => {
    expect(solveRung(rung(null, []), () => false).power).toBe(true);
    const cmp = rung({ id: 'k', t: 'cmp', a: 'X', op: '<', b: '10' }, []);
    expect(solveRung(cmp, () => 3).power).toBe(true);
    expect(solveRung(cmp, () => 30).power).toBe(false);
    const p = rung(contact('In', 'P'), []);
    const prev = new Map<string, boolean>();
    expect(solveRung(p, () => true, { prev }).power).toBe(true);
    expect(solveRung(p, () => true, { prev }).power).toBe(false);
    const n = rung(contact('In', 'N'), []);
    const prev2 = new Map<string, boolean>();
    solveRung(n, () => true, { prev: prev2 });
    expect(solveRung(n, () => false, { prev: prev2 }).power).toBe(true);
    const ops = (op: '=' | '<>' | '<=' | '>=' | '>', v: number) => solveRung(rung({ id: 'k', t: 'cmp', a: 'X', op, b: '5' }, []), () => v).power;
    expect([ops('=', 5), ops('<>', 5), ops('<=', 5), ops('>=', 4), ops('>', 6)]).toEqual([true, false, true, false, true]);
  });
});

describe('validation and storage', () => {
  it('reports unknown variables, writes to inputs, bad names, duplicates, bad time', () => {
    const p: LdProgram = {
      v: 1, name: 'Main',
      vars: [{ name: 'In', type: 'BOOL', address: '%IX0.0' }, { name: 'In', type: 'BOOL' }, { name: '1bad', type: 'BOOL' }, { name: 'IF', type: 'BOOL' }, { name: 'Bad', type: 'BOOL', address: '%Z9' }, { name: 'Num', type: 'INT' }],
      rungs: [
        rung(contact('Ghost'), [coil('In')]),
        rung(contact('Num'), [coil('Num')]),
        rung(null, []),
        rung(contact('T1.Q'), [{ id: uid('o'), t: 'timer', fb: 'TON', name: 'T1', pt: '5 s' }, { id: uid('o'), t: 'counter', fb: 'CTU', name: 'C1', pv: 3, reset: 'Nope' }]),
        rung(contact('T1.XX'), []),
      ],
    };
    const codes = validateLd(p).map((i) => i.code);
    for (const c of ['duplicate', 'bad_name', 'reserved', 'bad_address', 'unknown_var', 'write_input', 'not_bool', 'empty_rung', 'bad_time']) expect(codes).toContain(c);
  });

  it('a correct program has no errors', () => {
    expect(validateLd(sealIn()).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('parseLd round-trips and rejects bad input with a message', () => {
    const p = sealIn();
    const r = parseLd(JSON.stringify(p));
    expect(r.ok).toBe(true);
    expect(parseLd('not json')).toMatchObject({ ok: false });
    expect(parseLd('{"v":1,"name":"1x","vars":[],"rungs":[]}')).toMatchObject({ ok: false });
    expect(emptyProgram().rungs).toEqual([]);
  });
});
