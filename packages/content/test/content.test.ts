import { describe, expect, it } from 'vitest';
import { Machine } from '@controlslab/sim';
import { ContentError, parseContent } from '../src';
import { checkpoints, defById, lessons, machineDefs, workorders } from './helpers';

const machines = () => Object.fromEntries(machineDefs().map((m) => [m.data.id, new Machine(structuredClone(m.data))]));

describe('bundled content is valid and consistent', () => {
  it('has the 5 MVP lessons in order', () => {
    expect(lessons().map((l) => l.data.order).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(lessons().map((l) => l.data.id)).size).toBe(5);
  });

  it('lessons: prerequisites, quiz answers, practice and schematic references resolve', () => {
    const ls = lessons().map((l) => l.data);
    const woIds = new Set(workorders().map((w) => w.data.id));
    const mIds = new Set(machineDefs().map((m) => m.data.id));
    for (const l of ls) {
      for (const p of l.prerequisites) expect(ls.some((x) => x.id === p), `${l.id} prereq ${p}`).toBe(true);
      const ids = new Set<string>();
      for (const b of l.blocks) {
        if (b.type === 'quiz') {
          expect(b.answer, `${l.id}/${b.id}`).toBeLessThan(b.choices.length);
          expect(ids.has(b.id), `dup block id ${b.id}`).toBe(false);
          ids.add(b.id);
        }
        if (b.type === 'practice') expect(woIds.has(b.workorder), `${l.id} → ${b.workorder}`).toBe(true);
        if (b.type === 'schematic') expect(mIds.has(b.machine)).toBe(true);
      }
    }
  });

  it('work orders: machine, faults, probe points and targets exist', () => {
    const ms = machines();
    for (const { file, data: wo } of workorders()) {
      const m = ms[wo.machine];
      expect(m, `${file}: machine ${wo.machine}`).toBeDefined();
      const faultIds = new Set(m!.def.faults.map((f) => f.id));
      for (const f of wo.faults) expect(faultIds.has(f), `${file}: fault ${f}`).toBe(true);
      const terminals = new Set(m!.terminals());
      for (const o of wo.objectives) {
        if (o.type === 'measured') for (const p of o.points) expect(terminals.has(p) || p === 'GND', `${file}: ${p}`).toBe(true);
        if (o.type === 'state' || o.type === 'lamp_lit') expect(() => m!.component(o.component)).not.toThrow();
        if (o.type === 'replaced') {
          const ok = m!.def.components.some((c) => c.id === o.target) || m!.def.wires.some((w) => w.id === o.target);
          expect(ok, `${file}: replaced ${o.target}`).toBe(true);
        }
        if (o.type === 'plc_test') expect(wo.plc?.tests.some((t) => t.id === o.test), `${file}: ${o.test}`).toBe(true);
      }
      if (wo.plc) expect(m!.def.mode).toBe('plc');
    }
  });

  it('checkpoints: pool faults exist; weights sum to 100', () => {
    for (const { data: cp } of checkpoints()) {
      const def = defById(cp.machine);
      for (const f of cp.pool) expect(def.faults.some((x) => x.id === f), f).toBe(true);
      expect(Object.values(cp.weights).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it('every machine fault is wired to a real target and is reachable by injection', () => {
    for (const { data } of machineDefs()) {
      const m = new Machine(structuredClone(data));
      for (const f of data.faults) {
        expect(m.injectFault(f.id), f.id).toEqual({ ok: true });
        m.clearFaults();
      }
    }
  });

  it('the PLC starter program loads (it just does nothing yet)', async () => {
    const { PlcRuntime } = await import('@controlslab/plc-engine');
    const def = defById('motor-starter-plc');
    const r = new PlcRuntime().load(def.plc!.starterProgram!);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});

describe('content loader errors', () => {
  it('rejects bad YAML, unknown shape and schema violations with a useful path', () => {
    expect(() => parseContent('a: [')).toThrow(ContentError);
    expect(() => parseContent('42')).toThrow(/vide ou invalide/);
    expect(() => parseContent('foo: 1')).toThrow(/non reconnu/);
    expect(() => parseContent('id: x\norder: 1\ntitle: t\nsummary: s\nminutes: 5\nobjectives: [a]\nblocks: []')).toThrow(/blocks/);
    expect(() => parseContent('id: bad id!\norder: 1\ntitle: t\nsummary: s\nminutes: 5\nobjectives: [a]\nblocks: [{type: text, md: x}]')).toThrow(/id/);
  });

  it('accepts a minimal lesson with { fr, en } text', () => {
    const p = parseContent('id: demo\norder: 9\ntitle: {fr: Bonjour, en: Hello}\nsummary: s\nminutes: 5\nobjectives: [a]\nblocks: [{type: text, md: x}]');
    expect(p.kind).toBe('lesson');
    expect(p.id).toBe('demo');
  });
});
