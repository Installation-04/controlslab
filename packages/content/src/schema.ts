// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Content schemas (zod). The same schemas validate bundled content at test
 * time and community content imported in the browser.
 */
import { LdProgramSchema } from '@controlslab/ladder';
import { z } from 'zod';

/** French string, or { fr, en? }. */
export const Localized = z.union([z.string(), z.object({ fr: z.string(), en: z.string().optional() })]);
export type Localized = z.infer<typeof Localized>;

const Id = z.string().regex(/^[a-z0-9][a-z0-9-_]*$/i, 'id: lettres, chiffres, - et _');

// ---------- Lessons ----------
const Quiz = z.object({
  type: z.literal('quiz'),
  id: Id,
  question: Localized,
  choices: z.array(Localized).min(2),
  answer: z.number().int().nonnegative(),
  explain: Localized.optional(),
});

const Calc = z.object({
  type: z.literal('calc'),
  id: Id,
  /** Interactive Ohm's-law widget; fields the learner may edit. */
  kind: z.enum(['ohm']),
  preset: z.object({ V: z.number().optional(), I: z.number().optional(), R: z.number().optional() }).optional(),
});

const Practice = z.object({
  type: z.literal('practice'),
  /** Work order that opens in the lab. */
  workorder: Id,
  label: Localized.optional(),
});

const Text = z.object({ type: z.literal('text'), md: Localized });
const Callout = z.object({
  type: z.literal('callout'),
  kind: z.enum(['safety', 'tip', 'field', 'warning']),
  title: Localized.optional(),
  md: Localized,
});
const Code = z.object({
  type: z.literal('code'),
  lang: z.enum(['st', 'text']).default('st'),
  title: Localized.optional(),
  code: z.string(),
});
const Schematic = z.object({
  type: z.literal('schematic'),
  machine: Id,
  caption: Localized.optional(),
  /** Wire/component ids to highlight. */
  highlight: z.array(z.string()).optional(),
});

export const LessonBlock = z.discriminatedUnion('type', [Text, Callout, Code, Schematic, Quiz, Calc, Practice]);

export const Lesson = z.object({
  id: Id,
  order: z.number().int().positive(),
  title: Localized,
  summary: Localized,
  minutes: z.number().int().positive(),
  objectives: z.array(Localized).min(1),
  prerequisites: z.array(Id).default([]),
  blocks: z.array(LessonBlock).min(1),
  references: z.array(Localized).default([]),
});
export type Lesson = z.infer<typeof Lesson>;

// ---------- Work orders ----------
const Point = z.tuple([z.string(), z.string()]);

export const Objective = z.discriminatedUnion('type', [
  z.object({ type: z.literal('faults_cleared'), label: Localized }),
  z.object({ type: z.literal('no_violation'), code: z.enum(['ohms_on_live', 'work_without_loto', 'disconnect_under_load', 'lock_removed_before_restore']).optional(), label: Localized }),
  z.object({ type: z.literal('loto_step'), step: z.enum(['notify', 'shutdown', 'isolate', 'lockout', 'stored_energy', 'try_start', 'verify', 'restore']), label: Localized }),
  z.object({
    type: z.literal('measured'),
    points: Point,
    mode: z.enum(['VAC', 'VDC', 'OHM', 'CONT']),
    min: z.number().optional(),
    max: z.number().optional(),
    /** Accept the reversed probe order (default true). */
    symmetric: z.boolean().default(true),
    label: Localized,
  }),
  z.object({ type: z.literal('diagnosis'), label: Localized }),
  z.object({
    type: z.literal('state'),
    component: z.string(),
    key: z.string(),
    equals: z.union([z.boolean(), z.number(), z.string()]),
    label: Localized,
  }),
  z.object({ type: z.literal('plc_test'), test: Id, label: Localized }),
  z.object({ type: z.literal('replaced'), target: z.string(), label: Localized }),
  z.object({ type: z.literal('lamp_lit'), component: z.string(), label: Localized }),
]);
export type Objective = z.infer<typeof Objective>;

const ScriptStep = z.union([
  z.object({ press: z.string() }),
  z.object({ release: z.string() }),
  z.object({ wait: z.number().positive() }),
  z.object({ inject: z.string() }),
  z.object({ expect: z.object({ component: z.string(), key: z.string(), equals: z.union([z.boolean(), z.number(), z.string()]) }), msg: Localized.optional() }),
  z.object({ expectOutput: z.string(), equals: z.boolean(), msg: Localized.optional() }),
]);
export type ScriptStep = z.infer<typeof ScriptStep>;

export const PlcTest = z.object({ id: Id, title: Localized, steps: z.array(ScriptStep).min(1) });
export type PlcTest = z.infer<typeof PlcTest>;

export const WorkOrder = z.object({
  id: Id,
  number: z.string(),
  title: Localized,
  machine: Id,
  priority: z.enum(['low', 'normal', 'urgent']).default('normal'),
  /** The customer's complaint, written the way an operator would say it. */
  complaint: Localized,
  context: Localized.optional(),
  /** Faults injected at start. */
  faults: z.array(Id).default([]),
  /** Hints may be disabled (checkpoints). */
  hints: z.array(Localized).default([]),
  /** Learner must write a PLC program (machine.mode = plc). */
  plc: z
    .object({
      starter: z.string().optional(),
      /** Ladder starting program; when present the learner may use Ladder. */
      ldStarter: LdProgramSchema.optional(),
      languages: z.array(z.enum(['st', 'ld'])).optional(),
      defaultLang: z.enum(['st', 'ld']).optional(),
      tests: z.array(PlcTest).default([]),
    })
    .optional(),
  objectives: z.array(Objective).min(1),
  /** Whether a diagnosis must be recorded (pick-the-fault step). */
  requiresDiagnosis: z.boolean().default(false),
});
export type WorkOrder = z.infer<typeof WorkOrder>;

// ---------- Checkpoint ----------
export const Checkpoint = z.object({
  id: Id,
  title: Localized,
  machine: Id,
  intro: Localized,
  /** One fault is drawn from this pool (seeded). */
  pool: z.array(Id).min(1),
  timeLimitMinutes: z.number().positive().optional(),
  passScore: z.number().min(0).max(100).default(80),
  weights: z.object({
    diagnosis: z.number(),
    loto: z.number(),
    efficiency: z.number(),
    restore: z.number(),
  }),
  /** Efficiency: points lost per measurement beyond `freeMeasurements`, and per unnecessary part swapped. */
  efficiency: z.object({ freeMeasurements: z.number(), perExtraMeasurement: z.number(), perWrongPart: z.number() }),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

export const CHECKPOINT_NO_HINTS = true;

// ---------- Scenarios (3D cell) ----------
const Rot = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
const ParamValue = z.union([z.number(), z.string(), z.boolean()]);
export const EntityType = z.enum(['conveyor', 'spawner', 'photo', 'prox', 'pusher', 'button', 'light', 'stacklight', 'bin', 'panel']);

export const EntitySchema = z.object({
  id: Id,
  type: EntityType,
  x: z.number(),
  z: z.number(),
  rot: Rot.default(0),
  params: z.record(ParamValue).optional(),
  io: z.record(z.string()).optional(),
  name: z.string().optional(),
  locked: z.boolean().optional(),
});

const ItemKindZ = z.enum(['plastic', 'metal', 'cardboard']);
export const CellStepSchema = z.union([
  z.object({ run: z.number().positive() }),
  z.object({ press: z.string() }),
  z.object({ release: z.string() }),
  z.object({ panelPress: z.string() }),
  z.object({ panelRelease: z.string() }),
  z.object({ inject: z.string() }),
  z.object({ expectBin: z.object({ bin: z.string(), kind: ItemKindZ.optional(), min: z.number().optional(), max: z.number().optional() }), msg: z.string().optional() }),
  z.object({ expectInput: z.object({ address: z.string(), equals: z.boolean() }), msg: z.string().optional() }),
  z.object({ expectOutput: z.object({ address: z.string(), equals: z.boolean() }), msg: z.string().optional() }),
  z.object({ expectBelt: z.object({ id: z.string(), running: z.boolean() }), msg: z.string().optional() }),
  z.object({ expectLost: z.object({ max: z.number() }), msg: z.string().optional() }),
]);

export const CellTest = z.object({ id: Id, title: Localized, steps: z.array(CellStepSchema).min(1) });
export type CellTest = z.infer<typeof CellTest>;

export const Scenario = z.object({
  id: Id,
  number: z.string(),
  title: Localized,
  complaint: Localized,
  context: Localized.optional(),
  entities: z.array(EntitySchema).min(1),
  faults: z.array(z.string()).default([]),
  hints: z.array(Localized).default([]),
  /** Learner may add/move/delete devices (non-locked ones). */
  editable: z.boolean().default(true),
  plc: z.object({
    starter: z.string(),
    ldStarter: LdProgramSchema.optional(),
    languages: z.array(z.enum(['st', 'ld'])).optional(),
    defaultLang: z.enum(['st', 'ld']).optional(),
    tests: z.array(CellTest).min(1),
  }),
  objectives: z.array(z.object({ type: z.literal('plc_test'), test: Id, label: Localized })).min(1),
});
export type Scenario = z.infer<typeof Scenario>;
