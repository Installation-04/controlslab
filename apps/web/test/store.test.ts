import { beforeEach, describe, expect, it } from 'vitest';

// Minimal in-memory localStorage for the node environment.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

const { actions, getProgress, emptyProgress, STORAGE_KEY } = await import('../src/store/progress');
const { makeBackup, parseBackup, describeBackup, checkStSource, backupFileName, ImportError } = await import('../src/store/transfer');
const { tIn, locIn } = await import('../src/i18n');
const { STRINGS } = await import('../src/strings');

beforeEach(() => {
  actions.reset();
  mem.clear();
});

describe('progress store', () => {
  it('records lessons, quizzes, orders and persists to storage', () => {
    actions.setName('Alex');
    actions.setLessonDone('loi-ohm', true);
    actions.recordQuiz('loi-ohm', 'q1', true);
    actions.recordOrder('wo-1', false);
    actions.recordOrder('wo-1', true);
    actions.recordOrder('wo-1', false);
    const p = getProgress();
    expect(p.lessons['loi-ohm']).toEqual({ done: true, quiz: { q1: true } });
    expect(p.orders['wo-1']).toMatchObject({ passed: true, attempts: 3 });
    expect(JSON.parse(mem.get(STORAGE_KEY)!).profile.name).toBe('Alex');
  });

  it('saves programs without redundant writes', () => {
    actions.saveProgram('wo-5', 'PROGRAM A END_PROGRAM');
    const before = getProgress();
    actions.saveProgram('wo-5', 'PROGRAM A END_PROGRAM');
    expect(getProgress()).toBe(before);
  });

  it('merge keeps the best of both; replace overwrites', () => {
    actions.setLessonDone('a', true);
    actions.recordOrder('x', true);
    const other = emptyProgress();
    other.lessons = { b: { done: true, quiz: {} }, a: { done: false, quiz: { q: true } } };
    other.orders = { x: { passed: false, attempts: 5, lastAt: 9 }, y: { passed: true, attempts: 1, lastAt: 1 } };
    other.checkpoints = { c: [{ at: 1, fault: 'f', total: 80, max: 100, percent: 80, passed: true, lines: [] }] };
    other.programs = { p: 'S' };
    other.profile.name = 'Imported';
    actions.importProgress(other, 'merge');
    const p = getProgress();
    expect(p.lessons.a).toEqual({ done: true, quiz: { q: true } });
    expect(p.lessons.b!.done).toBe(true);
    expect(p.orders.x).toMatchObject({ passed: true, attempts: 5 });
    expect(p.orders.y!.passed).toBe(true);
    expect(p.checkpoints.c).toHaveLength(1);
    expect(p.programs.p).toBe('S');
    expect(p.profile.name).toBe('Imported');
    actions.importProgress(other, 'merge'); // idempotent for checkpoints
    expect(getProgress().checkpoints.c).toHaveLength(1);
    actions.importProgress(emptyProgress(), 'replace');
    expect(getProgress().lessons).toEqual({});
  });
});

describe('backup export / import', () => {
  it('round-trips and summarizes', () => {
    actions.setLessonDone('a', true);
    actions.recordCheckpoint('c', { at: 5, fault: 'f', total: 90, max: 100, percent: 90, passed: true, lines: [{ key: 'loto', points: 30, max: 30, notes: [] }] });
    actions.saveProgram('k', 'x');
    const text = JSON.stringify(makeBackup(getProgress(), new Date('2026-03-04T10:00:00Z')));
    const b = parseBackup(text);
    expect(describeBackup(b)).toEqual({ lessons: 1, orders: 0, checkpoints: 1, programs: 1, date: '2026-03-04' });
    expect(backupFileName(new Date('2026-03-04T10:00:00Z'))).toBe('controlslab-backup-20260304.json');
  });

  it('rejects garbage, wrong app and tampered shapes with ImportError', () => {
    expect(() => parseBackup('not json')).toThrow(ImportError);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/invalide/);
    const bad = makeBackup(emptyProgress());
    (bad.progress as { v: number }).v = 2;
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(ImportError);
  });

  it('validates .st files with the real compiler', () => {
    expect(checkStSource('PROGRAM P VAR x : INT; END_VAR x := 1; END_PROGRAM')).toEqual({ ok: true });
    const bad = checkStSource('PROGRAM P x := ; END_PROGRAM');
    expect(bad.ok).toBe(false);
    expect(checkStSource('x'.repeat(300_000))).toMatchObject({ ok: false });
  });
});

describe('i18n', () => {
  it('interpolates and falls back to French', () => {
    expect(tIn('fr', 'lessons.minutes', { n: 25 })).toBe('25 min');
    expect(tIn('en', 'nav.home')).toBe('Home');
    expect(tIn('en', 'app.name')).toBe('ControlsLab');
    expect(locIn('en', { fr: 'Bonjour' })).toBe('Bonjour');
    expect(locIn('en', { fr: 'Bonjour', en: 'Hello' })).toBe('Hello');
    expect(locIn('fr', 'texte')).toBe('texte');
    expect(locIn('fr', undefined)).toBe('');
  });

  it('every UI string has a French text', () => {
    for (const [k, v] of Object.entries(STRINGS)) expect(v.fr.length, k).toBeGreaterThan(0);
  });
});
