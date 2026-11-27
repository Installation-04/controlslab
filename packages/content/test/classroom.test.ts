import { describe, expect, it } from 'vitest';
import { newClassCode, newClassFile, parseClassFile, parseReport, summarizeClass, verifyOrderProgram, type ReportFile } from '../src';
import { defById, woById } from './helpers';

const SOLUTION = `PROGRAM Main
VAR
    Marche AT %IX0.0 : BOOL;
    Arret AT %IX0.1 : BOOL;
    Surcharge AT %IX0.2 : BOOL;
    AU_OK AT %IX0.3 : BOOL;
    RetourM AT %IX0.4 : BOOL;
    BobineM AT %QX0.0 : BOOL;
    VoyantMarche AT %QX0.1 : BOOL;
END_VAR
BobineM := (Marche OR BobineM) AND Arret AND NOT Surcharge AND AU_OK;
VoyantMarche := RetourM;
END_PROGRAM`;

const cls = newClassFile({ name: 'Électromécanique 2', code: 'abcd-2345', assigned: { workorders: ['wo-005-programme-st', 'wo-010-surcharge'], checkpoints: ['cp1-demarreur'], lessons: ['loi-ohm'] } }, 1000);
const withScenario = newClassFile({ name: 'S', code: 'SCN1', assigned: { scenarios: ['sc-01-convoyeur'] } }, 1);

const report = (over: Partial<ReportFile> & { id?: string; name?: string } = {}): ReportFile => ({
  v: 1,
  kind: 'report',
  classCode: 'ABCD-2345',
  createdAt: 2000,
  learner: { id: over.id ?? 'learner-0001', name: over.name ?? 'Alex Tremblay' },
  lessons: { 'loi-ohm': { done: true, quizRight: 2, quizTotal: 3 } },
  orders: {
    'wo-005-programme-st': { passed: true, attempts: 2, lastAt: 1500, violations: {}, measures: 0 },
    'wo-010-surcharge': { passed: false, attempts: 1, lastAt: 1600, violations: { ohms_on_live: 2 }, measures: 7 },
  },
  checkpoints: { 'cp1-demarreur': [{ at: 1, percent: 60, passed: false }, { at: 2, percent: 85, passed: true }] },
  programs: {},
  ...over,
});

describe('class and report files', () => {
  it('builds a class file with an upper-case code and round-trips through JSON', () => {
    expect(cls.code).toBe('ABCD-2345');
    expect(cls.assigned.scenarios).toEqual([]);
    expect(parseClassFile(JSON.stringify(cls))).toEqual(cls);
  });

  it('generates readable class codes that the schema accepts', () => {
    let n = 0;
    const code = newClassCode(() => ((n++ * 7) % 32) / 32);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(newClassFile({ name: 'x' }).code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('rejects broken files with a readable message', () => {
    expect(() => parseClassFile('{nope')).toThrow(/JSON invalide/);
    expect(() => parseClassFile(JSON.stringify({ ...cls, code: 'abc def' }))).toThrow(/code/);
    expect(() => parseClassFile(JSON.stringify({ ...cls, kind: 'report' }))).toThrow(/kind/);
    expect(() => parseReport(JSON.stringify({ v: 1, kind: 'report' }))).toThrow(/rapport/);
    expect(() => newClassFile({ name: '   ' })).toThrow();
  });

  it('parses a report, filling defaults for older or partial data', () => {
    const minimal = { v: 1, kind: 'report', classCode: 'ABCD-2345', createdAt: 5, learner: { id: 'learner-0001', name: 'A' } };
    const r = parseReport(JSON.stringify(minimal));
    expect(r.orders).toEqual({});
    expect(r.programs).toEqual({});
    expect(parseReport(JSON.stringify(report()))).toEqual(report());
  });
});

describe('class summary', () => {
  it('computes statuses, best checkpoint score, safety totals and completion', () => {
    const s = summarizeClass(cls, [report()]);
    const row = s.rows[0]!;
    expect(row.orders).toEqual({ 'wo-005-programme-st': 'passed', 'wo-010-surcharge': 'attempted' });
    expect(row.checkpointBest).toEqual({ 'cp1-demarreur': 85 });
    expect(row.violations).toBe(2);
    expect(row.violationsByCode).toEqual({ ohms_on_live: 2 });
    expect(row.measures).toBe(7);
    expect(row.attempts).toBe(3);
    expect(row.lessonsDone).toBe(1);
    expect(row.assignedDone).toBe(2);
    expect(row.assignedTotal).toBe(3);
    expect(row.foreignClass).toBe(false);
    expect(s.finished).toBe(0);
  });

  it('counts 3D scenarios as assigned items', () => {
    const r = report({ classCode: 'SCN1', orders: { 'sc-01-convoyeur': { passed: true, attempts: 1, lastAt: 1, violations: {}, measures: 0 } } });
    const s = summarizeClass(withScenario, [r]);
    expect(s.rows[0]!.orders).toEqual({ 'sc-01-convoyeur': 'passed' });
    expect(s.rows[0]!.assignedTotal).toBe(1);
    expect(s.finished).toBe(1);
  });

  it('keeps only the newest report per learner and sorts by name', () => {
    const older = report({ createdAt: 1000, orders: {} });
    const newer = report({ createdAt: 3000 });
    const other = report({ id: 'learner-0002', name: 'Émilie Roy', createdAt: 500, orders: {}, checkpoints: {}, lessons: {} });
    const s = summarizeClass(cls, [newer, older, other]);
    expect(s.rows.map((r) => r.name)).toEqual(['Alex Tremblay', 'Émilie Roy']);
    expect(s.rows[0]!.reportAt).toBe(3000);
    expect(s.rows[1]!.orders).toEqual({ 'wo-005-programme-st': 'none', 'wo-010-surcharge': 'none' });
    expect(s.rows[1]!.checkpointBest['cp1-demarreur']).toBeNull();
  });

  it('counts finished learners and flags reports from another class', () => {
    const done = report({ orders: { 'wo-005-programme-st': { passed: true, attempts: 1, lastAt: 1, violations: {}, measures: 0 }, 'wo-010-surcharge': { passed: true, attempts: 1, lastAt: 1, violations: {}, measures: 0 } } });
    expect(summarizeClass(cls, [done]).finished).toBe(1);
    expect(summarizeClass(cls, [{ ...done, classCode: 'ZZZZ-9999' }]).rows[0]!.foreignClass).toBe(true);
    const empty = newClassFile({ name: 'vide' });
    expect(summarizeClass(empty, [done]).finished).toBe(0);
  });
});

describe('submitted program verification', () => {
  const order = woById('wo-005-programme-st');
  const def = defById(order.machine);

  it('accepts a correct program and rejects the starter', () => {
    const good = verifyOrderProgram(order, def, SOLUTION);
    expect(good.tests.length).toBeGreaterThan(0);
    expect(good.passed).toBe(true);
    const bad = verifyOrderProgram(order, def, order.plc!.starter!);
    expect(bad.passed).toBe(false);
  });

  it('reports a syntax error as a load error instead of throwing', () => {
    const v = verifyOrderProgram(order, def, 'PROGRAM Main x := ; END_PROGRAM', 'en');
    expect(v.passed).toBe(false);
    expect(v.tests[0]!.loadError).toBeTruthy();
  });

  it('a work order without PLC tests can never be verified', () => {
    const v = verifyOrderProgram(woById('wo-010-surcharge'), defById('motor-starter-3w'), SOLUTION);
    expect(v).toEqual({ passed: false, tests: [] });
  });
});
