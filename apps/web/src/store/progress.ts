// SPDX-License-Identifier: AGPL-3.0-only
/** Local progress (browser only, versioned). No accounts, nothing leaves the device. */
import { useSyncExternalStore } from 'react';
import { z } from 'zod';

export const STORAGE_KEY = 'controlslab.progress.v1';

const ScoreLine = z.object({ key: z.string(), points: z.number(), max: z.number(), notes: z.array(z.string()) });
export const CheckpointAttempt = z.object({
  at: z.number(),
  fault: z.string(),
  total: z.number(),
  max: z.number(),
  percent: z.number(),
  passed: z.boolean(),
  lines: z.array(ScoreLine),
});
export type CheckpointAttempt = z.infer<typeof CheckpointAttempt>;

export const Progress = z.object({
  v: z.literal(1),
  profile: z.object({ name: z.string().max(80) }),
  lessons: z.record(z.object({ done: z.boolean(), quiz: z.record(z.boolean()) })),
  orders: z.record(z.object({ passed: z.boolean(), attempts: z.number(), lastAt: z.number() })),
  checkpoints: z.record(z.array(CheckpointAttempt)),
  /** ST programs keyed by work-order id (or "sandbox"). */
  programs: z.record(z.string().max(200_000)),
});
export type Progress = z.infer<typeof Progress>;

export const emptyProgress = (): Progress => ({
  v: 1,
  profile: { name: '' },
  lessons: {},
  orders: {},
  checkpoints: {},
  programs: {},
});

function load(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    const r = Progress.safeParse(JSON.parse(raw));
    return r.success ? r.data : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

let state: Progress = load();
const listeners = new Set<() => void>();

function commit(next: Progress) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota: keep in memory for this session */
  }
  listeners.forEach((f) => f());
}

export const getProgress = () => state;
export const useProgress = () =>
  useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => state,
  );

export const actions = {
  setName: (name: string) => commit({ ...state, profile: { name } }),
  setLessonDone(id: string, done: boolean) {
    const cur = state.lessons[id] ?? { done: false, quiz: {} };
    commit({ ...state, lessons: { ...state.lessons, [id]: { ...cur, done } } });
  },
  recordQuiz(lessonId: string, blockId: string, correct: boolean) {
    const cur = state.lessons[lessonId] ?? { done: false, quiz: {} };
    commit({ ...state, lessons: { ...state.lessons, [lessonId]: { ...cur, quiz: { ...cur.quiz, [blockId]: correct } } } });
  },
  recordOrder(id: string, passed: boolean) {
    const cur = state.orders[id] ?? { passed: false, attempts: 0, lastAt: 0 };
    commit({
      ...state,
      orders: { ...state.orders, [id]: { passed: cur.passed || passed, attempts: cur.attempts + 1, lastAt: Date.now() } },
    });
  },
  recordCheckpoint(id: string, attempt: CheckpointAttempt) {
    commit({ ...state, checkpoints: { ...state.checkpoints, [id]: [...(state.checkpoints[id] ?? []), attempt] } });
  },
  saveProgram(key: string, source: string) {
    if (state.programs[key] === source) return;
    commit({ ...state, programs: { ...state.programs, [key]: source } });
  },
  /** Replace everything (import "replace") or merge (import "merge"). */
  importProgress(p: Progress, mode: 'merge' | 'replace') {
    if (mode === 'replace') return commit(p);
    const lessons = { ...state.lessons };
    for (const [id, l] of Object.entries(p.lessons)) {
      const cur = lessons[id];
      lessons[id] = cur ? { done: cur.done || l.done, quiz: { ...l.quiz, ...cur.quiz } } : l;
    }
    const orders = { ...state.orders };
    for (const [id, o] of Object.entries(p.orders)) {
      const cur = orders[id];
      orders[id] = cur ? { passed: cur.passed || o.passed, attempts: Math.max(cur.attempts, o.attempts), lastAt: Math.max(cur.lastAt, o.lastAt) } : o;
    }
    const checkpoints = { ...state.checkpoints };
    for (const [id, list] of Object.entries(p.checkpoints)) {
      const have = new Set((checkpoints[id] ?? []).map((a) => a.at));
      checkpoints[id] = [...(checkpoints[id] ?? []), ...list.filter((a) => !have.has(a.at))].sort((a, b) => a.at - b.at);
    }
    commit({
      v: 1,
      profile: { name: state.profile.name || p.profile.name },
      lessons,
      orders,
      checkpoints,
      programs: { ...p.programs, ...state.programs },
    });
  },
  reset: () => commit(emptyProgress()),
};
