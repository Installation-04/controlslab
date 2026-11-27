// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Classroom files. There is no server: the instructor hands out a class file (what to do), learners hand back
 * a report file (what they did) and the instructor's page aggregates the reports in the browser. Reports are
 * self-declared; submitted PLC programs can be replayed against the work order's tests to verify them.
 */
import type { MachineDef } from '@controlslab/sim';
import { z } from 'zod';
import { runPlcTest, type Lang } from './checker';
import { ContentError } from './load';
import type { WorkOrder } from './schema';

const Code = z.string().regex(/^[A-Z0-9]{3,6}(-[A-Z0-9]{3,6})?$/, 'code de classe : lettres majuscules et chiffres');

export const ClassFile = z.object({
  v: z.literal(1),
  kind: z.literal('class'),
  code: Code,
  name: z.string().min(1).max(120),
  createdAt: z.number(),
  note: z.string().max(2000).optional(),
  assigned: z.object({
    lessons: z.array(z.string()).default([]),
    workorders: z.array(z.string()).default([]),
    checkpoints: z.array(z.string()).default([]),
    scenarios: z.array(z.string()).default([]),
  }),
});
export type ClassFile = z.infer<typeof ClassFile>;

const OrderLine = z.object({
  passed: z.boolean(),
  attempts: z.number(),
  lastAt: z.number(),
  violations: z.record(z.number()).default({}),
  measures: z.number().default(0),
});

export const ReportFile = z.object({
  v: z.literal(1),
  kind: z.literal('report'),
  classCode: Code,
  createdAt: z.number(),
  learner: z.object({ id: z.string().min(8).max(64), name: z.string().min(1).max(80) }),
  lessons: z.record(z.object({ done: z.boolean(), quizRight: z.number(), quizTotal: z.number() })).default({}),
  orders: z.record(OrderLine).default({}),
  checkpoints: z.record(z.array(z.object({ at: z.number(), percent: z.number(), passed: z.boolean() }))).default({}),
  /** Submitted programs, as Structured Text, keyed "order:<id>" or "scenario:<id>". */
  programs: z.record(z.object({ source: z.string().max(200_000), lang: z.enum(['st', 'ld']) })).default({}),
});
export type ReportFile = z.infer<typeof ReportFile>;

function parseJson<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, text: string, what: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ContentError(`${what} : JSON invalide (${(e as Error).message})`);
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new ContentError(`${what} : ${i.path.join('.') || '(racine)'} — ${i.message}`);
  }
  return r.data;
}

export const parseClassFile = (text: string) => parseJson(ClassFile, text, 'fichier de classe');
export const parseReport = (text: string) => parseJson(ReportFile, text, 'rapport');

/** A short readable class code such as "K7QM-4T2P" (no look-alike characters). */
export function newClassCode(random: () => number = Math.random): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }, () => chars[Math.floor(random() * chars.length)]).join('');
  return `${part()}-${part()}`;
}

export function newClassFile(input: { name: string; code?: string; note?: string; assigned?: Partial<ClassFile['assigned']> }, now = Date.now()): ClassFile {
  return ClassFile.parse({
    v: 1,
    kind: 'class',
    code: (input.code ?? newClassCode()).toUpperCase(),
    name: input.name.trim(),
    createdAt: now,
    note: input.note?.trim() || undefined,
    assigned: { lessons: [], workorders: [], checkpoints: [], scenarios: [], ...input.assigned },
  });
}

// ---------- Aggregation ----------
export type ItemStatus = 'passed' | 'attempted' | 'none';

export interface LearnerRow {
  id: string;
  name: string;
  reportAt: number;
  lessonsDone: number;
  orders: Record<string, ItemStatus>;
  checkpointBest: Record<string, number | null>;
  violations: number;
  violationsByCode: Record<string, number>;
  measures: number;
  attempts: number;
  /** Assigned work orders, scenarios and checkpoints passed / assigned. */
  assignedDone: number;
  assignedTotal: number;
  /** The report carries a different class code from the class file. */
  foreignClass: boolean;
}

export interface ClassSummary {
  rows: LearnerRow[];
  /** Number of learners who finished every assigned item. */
  finished: number;
}

/** One row per learner (the newest report wins), assigned items first. */
export function summarizeClass(cls: ClassFile, reports: ReportFile[]): ClassSummary {
  const latest = new Map<string, ReportFile>();
  for (const r of reports) {
    const cur = latest.get(r.learner.id);
    if (!cur || r.createdAt >= cur.createdAt) latest.set(r.learner.id, r);
  }
  const rows: LearnerRow[] = [...latest.values()].map((r) => {
    const orders: Record<string, ItemStatus> = {};
    // Work orders and 3D scenarios are both recorded as "orders" in a learner's progress.
    for (const id of [...cls.assigned.workorders, ...cls.assigned.scenarios]) {
      const o = r.orders[id];
      orders[id] = o?.passed ? 'passed' : o && o.attempts > 0 ? 'attempted' : 'none';
    }
    const checkpointBest: Record<string, number | null> = {};
    for (const id of cls.assigned.checkpoints) {
      const list = r.checkpoints[id] ?? [];
      checkpointBest[id] = list.length ? Math.max(...list.map((a) => a.percent)) : null;
    }
    const byCode: Record<string, number> = {};
    let measures = 0;
    let attempts = 0;
    for (const o of Object.values(r.orders)) {
      measures += o.measures;
      attempts += o.attempts;
      for (const [code, n] of Object.entries(o.violations)) byCode[code] = (byCode[code] ?? 0) + n;
    }
    const passedOrders = Object.values(orders).filter((s) => s === 'passed').length;
    const passedCps = cls.assigned.checkpoints.filter((id) => (r.checkpoints[id] ?? []).some((a) => a.passed)).length;
    return {
      id: r.learner.id,
      name: r.learner.name,
      reportAt: r.createdAt,
      lessonsDone: cls.assigned.lessons.filter((id) => r.lessons[id]?.done).length,
      orders,
      checkpointBest,
      violations: Object.values(byCode).reduce((a, b) => a + b, 0),
      violationsByCode: byCode,
      measures,
      attempts,
      assignedDone: passedOrders + passedCps,
      assignedTotal: Object.keys(orders).length + cls.assigned.checkpoints.length,
      foreignClass: r.classCode !== cls.code,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return { rows, finished: rows.filter((r) => r.assignedTotal > 0 && r.assignedDone === r.assignedTotal).length };
}

// ---------- Verification of submitted programs ----------
export interface ProgramVerdict {
  passed: boolean;
  tests: Array<{ id: string; pass: boolean; failures: string[]; loadError?: string }>;
}

/** Replays a submitted program against the tests of a (PLC) work order, on a clean machine. */
export function verifyOrderProgram(order: WorkOrder, def: MachineDef, source: string, lang: Lang = 'fr'): ProgramVerdict {
  const tests = (order.plc?.tests ?? []).map((t) => {
    const r = runPlcTest(structuredClone(def), source, t, lang);
    return { id: t.id, pass: r.pass, failures: r.failures, loadError: r.loadError };
  });
  return { passed: tests.length > 0 && tests.every((t) => t.pass), tests };
}
