// SPDX-License-Identifier: AGPL-3.0-only
import type { MachineDef } from '@controlslab/sim';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { Checkpoint, Lesson, WorkOrder } from './schema';

export type ContentKind = 'lesson' | 'workorder' | 'checkpoint' | 'machine';

export interface ParsedContent {
  kind: ContentKind;
  id: string;
  data: Lesson | WorkOrder | Checkpoint | MachineDef;
}

const MachineShape = z
  .object({
    id: z.string(),
    version: z.number(),
    title: z.any(),
    mode: z.enum(['hardwired', 'plc']),
    viewBox: z.tuple([z.number(), z.number()]),
    components: z.array(z.object({ id: z.string(), type: z.string(), parts: z.record(z.any()) }).passthrough()),
    wires: z.array(z.object({ id: z.string(), from: z.string(), to: z.string() }).passthrough()),
    loto: z.object({ isolators: z.array(z.string()) }).passthrough(),
    faults: z.array(z.object({ id: z.string(), target: z.string(), kind: z.string() }).passthrough()),
  })
  .passthrough();

export class ContentError extends Error {}

/** Parse + validate one YAML document; the kind is detected from its shape. */
export function parseContent(yamlText: string): ParsedContent {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (e) {
    throw new ContentError(`YAML invalide: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object') throw new ContentError('Document vide ou invalide');
  const o = raw as Record<string, unknown>;
  const [kind, schema]: [ContentKind, z.ZodTypeAny] =
    'blocks' in o ? ['lesson', Lesson]
    : 'objectives' in o && 'machine' in o ? ['workorder', WorkOrder]
    : 'pool' in o ? ['checkpoint', Checkpoint]
    : 'components' in o ? ['machine', MachineShape]
    : (() => {
        throw new ContentError('Type de contenu non reconnu (lesson, workorder, checkpoint ou machine)');
      })();
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0]!;
    throw new ContentError(`${kind}: ${issue.path.join('.') || '(racine)'} — ${issue.message}`);
  }
  const data = r.data as ParsedContent['data'];
  return { kind, id: (data as { id: string }).id, data };
}
