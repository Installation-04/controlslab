// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ladder Diagram (IEC 61131-3 LD) model. A program is a list of rungs; each rung
 * has a logic tree (contacts in series / parallel) feeding one or more outputs.
 * Programs are plain JSON so they can be stored, exported and shipped in YAML content.
 */
import { z } from 'zod';

export const ContactKind = z.enum(['NO', 'NC', 'P', 'N']);
export type ContactKind = z.infer<typeof ContactKind>;

export const CmpOp = z.enum(['=', '<>', '<', '>', '<=', '>=']);
export type CmpOp = z.infer<typeof CmpOp>;

const Id = z.string().min(1).max(40);

export type LogicNode =
  | { id: string; t: 'contact'; v: string; k: ContactKind }
  | { id: string; t: 'cmp'; a: string; op: CmpOp; b: string }
  | { id: string; t: 'series'; items: LogicNode[] }
  | { id: string; t: 'parallel'; items: LogicNode[] };

export const LogicNodeSchema: z.ZodType<LogicNode> = z.lazy(() =>
  z.union([
    z.object({ id: Id, t: z.literal('contact'), v: z.string().max(80), k: ContactKind }),
    z.object({ id: Id, t: z.literal('cmp'), a: z.string().max(80), op: CmpOp, b: z.string().max(80) }),
    z.object({ id: Id, t: z.literal('series'), items: z.array(LogicNodeSchema).max(40) }),
    z.object({ id: Id, t: z.literal('parallel'), items: z.array(LogicNodeSchema).max(40) }),
  ]),
);

export const OutputSchema = z.union([
  z.object({ id: Id, t: z.literal('coil'), v: z.string().max(80), k: z.enum(['normal', 'negated', 'set', 'reset']) }),
  /** Timers: IN is the rung power; Q / ET readable as `name.Q`, `name.ET`. */
  z.object({ id: Id, t: z.literal('timer'), fb: z.enum(['TON', 'TOF', 'TP']), name: z.string().max(40), pt: z.string().max(30) }),
  /** Counters: count input is the rung power; R is an optional BOOL variable; PV preset. */
  z.object({ id: Id, t: z.literal('counter'), fb: z.enum(['CTU', 'CTD']), name: z.string().max(40), pv: z.number().int(), reset: z.string().max(80).optional() }),
]);
export type Output = z.infer<typeof OutputSchema>;

export const RungSchema = z.object({
  id: Id,
  comment: z.string().max(200).optional(),
  logic: LogicNodeSchema.nullable(),
  outputs: z.array(OutputSchema).max(12),
});
export type Rung = z.infer<typeof RungSchema>;

export const VarTypeSchema = z.enum(['BOOL', 'INT', 'DINT', 'REAL', 'TIME']);
export const VarSchema = z.object({
  name: z.string().max(40),
  type: VarTypeSchema,
  /** Direct address (%IX0.0, %QX0.0, %MX0.0 …); empty = internal memory variable. */
  address: z.string().max(20).optional(),
  comment: z.string().max(120).optional(),
});
export type LdVar = z.infer<typeof VarSchema>;

export const LdProgramSchema = z.object({
  v: z.literal(1).default(1),
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(40).default('Main'),
  vars: z.array(VarSchema).max(200),
  rungs: z.array(RungSchema).max(100),
});
export type LdProgram = z.infer<typeof LdProgramSchema>;

export const emptyProgram = (): LdProgram => ({ v: 1, name: 'Main', vars: [], rungs: [] });

let counter = 0;
/** Short unique id for new nodes (stable enough within a session, unique within a program). */
export function uid(prefix = 'n'): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export const contact = (v: string, k: ContactKind = 'NO', id = uid('c')): LogicNode => ({ id, t: 'contact', v, k });
export const series = (...items: LogicNode[]): LogicNode => ({ id: uid('s'), t: 'series', items });
export const parallel = (...items: LogicNode[]): LogicNode => ({ id: uid('p'), t: 'parallel', items });
export const coil = (v: string, k: 'normal' | 'negated' | 'set' | 'reset' = 'normal'): Output => ({ id: uid('o'), t: 'coil', v, k });
export const rung = (logic: LogicNode | null, outputs: Output[], comment?: string): Rung => ({ id: uid('r'), comment, logic, outputs });

export function parseLd(text: string): { ok: true; program: LdProgram } | { ok: false; message: string } {
  try {
    const r = LdProgramSchema.safeParse(JSON.parse(text));
    if (r.success) return { ok: true, program: r.data };
    const i = r.error.issues[0]!;
    return { ok: false, message: `${i.path.join('.') || '(racine)'} — ${i.message}` };
  } catch (e) {
    return { ok: false, message: `JSON invalide : ${(e as Error).message}` };
  }
}
