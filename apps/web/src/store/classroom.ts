// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Classroom state kept in the browser: the classes a learner joined (from a class file) and, for an instructor,
 * the classes created and the reports imported. Nothing is sent anywhere; files are exchanged by hand.
 */
import { newClassFile, type ClassFile, type ReportFile } from '@controlslab/content';
import { useSyncExternalStore } from 'react';
import type { Registry } from '../content';
import { startersOf } from '../routes/Orders';
import { readLang, resolveSource, type Starters } from './plc';
import type { Progress } from './progress';

function makeStore<T>(key: string, fresh: () => T) {
  const read = (): T => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...fresh(), ...(JSON.parse(raw) as T) } : fresh();
    } catch {
      return fresh();
    }
  };
  let state = read();
  const listeners = new Set<() => void>();
  const commit = (next: T) => {
    state = next;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* quota or private mode: keep in memory */
    }
    listeners.forEach((f) => f());
  };
  return {
    get: () => state,
    set: commit,
    use: () =>
      useSyncExternalStore(
        (cb) => (listeners.add(cb), () => listeners.delete(cb)),
        () => state,
      ),
  };
}

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

// ---------------- Learner side ----------------
export interface LearnerState {
  learnerId: string;
  classes: ClassFile[];
  active: string | null;
}
const learner = makeStore<LearnerState>('controlslab.classroom.v1', () => ({ learnerId: uuid(), classes: [], active: null }));
export const useLearner = learner.use;
export const getLearner = learner.get;

export const learnerActions = {
  join(file: ClassFile) {
    const s = learner.get();
    const classes = [...s.classes.filter((c) => c.code !== file.code), file];
    learner.set({ ...s, classes, active: file.code });
  },
  leave(code: string) {
    const s = learner.get();
    const classes = s.classes.filter((c) => c.code !== code);
    learner.set({ ...s, classes, active: s.active === code ? (classes[0]?.code ?? null) : s.active });
  },
  setActive(code: string | null) {
    learner.set({ ...learner.get(), active: code });
  },
};

export const activeClass = (s: LearnerState): ClassFile | undefined => s.classes.find((c) => c.code === s.active);

/** Item ids the active class assigned (empty sets when the learner has not joined a class). */
export function assignedOf(s: LearnerState) {
  const a = activeClass(s)?.assigned;
  return {
    lessons: new Set(a?.lessons ?? []),
    workorders: new Set(a?.workorders ?? []),
    checkpoints: new Set(a?.checkpoints ?? []),
    scenarios: new Set(a?.scenarios ?? []),
  };
}

/** The learner's report for a class, built from the local progress. */
export function buildMyReport(cls: ClassFile, progress: Progress, reg: Registry, learnerId: string, now = Date.now()): ReportFile {
  const programs: ReportFile['programs'] = {};
  const addProgram = (id: string, key: string, starters: Starters) => {
    const has = progress.programs[key] !== undefined || progress.programs[`${key}:ld`] !== undefined;
    if (!has) return;
    programs[id] = { source: resolveSource(progress.programs, key, starters), lang: readLang(progress.programs, key, starters) };
  };
  for (const w of reg.workorders) if (cls.assigned.workorders.includes(w.id) && w.plc) addProgram(`order:${w.id}`, w.id, startersOf(w));
  for (const sc of reg.scenarios) {
    if (!cls.assigned.scenarios.includes(sc.id)) continue;
    addProgram(`scenario:${sc.id}`, `cell-prog:${sc.id}`, {
      st: sc.plc.starter,
      ld: sc.plc.ldStarter as Starters['ld'],
      languages: sc.plc.languages,
      defaultLang: sc.plc.defaultLang,
    });
  }
  return {
    v: 1,
    kind: 'report',
    classCode: cls.code,
    createdAt: now,
    learner: { id: learnerId, name: progress.profile.name.trim() || 'Anonyme' },
    lessons: Object.fromEntries(
      Object.entries(progress.lessons).map(([id, l]) => {
        const q = Object.values(l.quiz);
        return [id, { done: l.done, quizRight: q.filter(Boolean).length, quizTotal: q.length }];
      }),
    ),
    orders: progress.orders,
    checkpoints: Object.fromEntries(Object.entries(progress.checkpoints).map(([id, list]) => [id, list.map((a) => ({ at: a.at, percent: a.percent, passed: a.passed }))])),
    programs,
  };
}

// ---------------- Instructor side ----------------
export interface InstructorState {
  classes: ClassFile[];
  reports: Record<string, ReportFile[]>;
  current: string | null;
}
const instructor = makeStore<InstructorState>('controlslab.instructor.v1', () => ({ classes: [], reports: {}, current: null }));
export const useInstructor = instructor.use;
export const getInstructor = instructor.get;

export const instructorActions = {
  saveClass(file: ClassFile) {
    const s = instructor.get();
    instructor.set({ ...s, classes: [...s.classes.filter((c) => c.code !== file.code), file], current: file.code });
  },
  createClass(name: string) {
    const file = newClassFile({ name });
    this.saveClass(file);
    return file;
  },
  deleteClass(code: string) {
    const s = instructor.get();
    const reports = { ...s.reports };
    delete reports[code];
    const classes = s.classes.filter((c) => c.code !== code);
    instructor.set({ classes, reports, current: s.current === code ? (classes[0]?.code ?? null) : s.current });
  },
  select(code: string | null) {
    instructor.set({ ...instructor.get(), current: code });
  },
  /** Keep every report; the summary shows the newest per learner. */
  addReports(code: string, files: ReportFile[]) {
    const s = instructor.get();
    const have = s.reports[code] ?? [];
    const seen = new Set(have.map((r) => `${r.learner.id}:${r.createdAt}`));
    const fresh = files.filter((r) => !seen.has(`${r.learner.id}:${r.createdAt}`));
    instructor.set({ ...s, reports: { ...s.reports, [code]: [...have, ...fresh] } });
    return fresh.length;
  },
  clearReports(code: string) {
    const s = instructor.get();
    instructor.set({ ...s, reports: { ...s.reports, [code]: [] } });
  },
};
