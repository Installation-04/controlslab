// SPDX-License-Identifier: AGPL-3.0-only
import type { MachineDef } from '@controlslab/sim';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { Checkpoint, Lesson, Scenario, WorkOrder } from './schema';

export type ContentKind = 'lesson' | 'workorder' | 'checkpoint' | 'machine' | 'scenario';

export interface ParsedContent {
  kind: ContentKind;
  id: string;
  data: Lesson | WorkOrder | Checkpoint | MachineDef | Scenario;
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

/**
 * Merge an English overlay into a French document. The overlay mirrors the document's structure and only
 * carries translated strings: a string in both becomes `{ fr, en }`; arrays are aligned by index (use `~` or
 * omit a position to leave it untouched); a path that does not exist in the document is an error, so an overlay
 * can never drift silently from its source.
 */
export function mergeTranslation(base: unknown, en: unknown, path = ''): unknown {
  if (en === undefined || en === null) return base;
  if (typeof base === 'string') {
    if (typeof en !== 'string') throw new ContentError(`i18n ${path || '(racine)'}: une chaîne est attendue`);
    return { fr: base, en };
  }
  if (Array.isArray(base)) {
    if (!Array.isArray(en)) throw new ContentError(`i18n ${path}: une liste est attendue`);
    if (en.length > base.length) throw new ContentError(`i18n ${path}: ${en.length} éléments pour ${base.length} dans la source`);
    return base.map((b, i) => mergeTranslation(b, en[i], `${path}[${i}]`));
  }
  if (base && typeof base === 'object') {
    if (typeof en !== 'object' || Array.isArray(en)) throw new ContentError(`i18n ${path}: un objet est attendu`);
    const b = base as Record<string, unknown>;
    if ('fr' in b) return b; // already localized in the source
    const out: Record<string, unknown> = { ...b };
    for (const [k, v] of Object.entries(en as Record<string, unknown>)) {
      if (!(k in b)) throw new ContentError(`i18n ${path ? path + '.' : ''}${k}: chemin absent de la source`);
      out[k] = mergeTranslation(b[k], v, `${path ? path + '.' : ''}${k}`);
    }
    return out;
  }
  throw new ContentError(`i18n ${path}: ce champ n'est pas traduisible`);
}

/** Parse + validate one YAML document; the kind is detected from its shape. */
export function parseContent(yamlText: string, enOverlay?: string): ParsedContent {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (e) {
    throw new ContentError(`YAML invalide: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object') throw new ContentError('Document vide ou invalide');
  if (enOverlay) {
    let en: unknown;
    try {
      en = parseYaml(enOverlay);
    } catch (e) {
      throw new ContentError(`YAML anglais invalide: ${(e as Error).message}`);
    }
    raw = mergeTranslation(raw, en);
  }
  const o = raw as Record<string, unknown>;
  const [kind, schema]: [ContentKind, z.ZodTypeAny] =
    'blocks' in o ? ['lesson', Lesson]
    : 'entities' in o && 'plc' in o ? ['scenario', Scenario]
    : 'objectives' in o && 'machine' in o ? ['workorder', WorkOrder]
    : 'pool' in o ? ['checkpoint', Checkpoint]
    : 'components' in o ? ['machine', MachineShape]
    : (() => {
        throw new ContentError('Type de contenu non reconnu (lesson, workorder, checkpoint ou machine)');
      })();
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0]!;
    // A French " : " inside an unquoted YAML string silently becomes a mapping: say so.
    let at: unknown = raw;
    for (const k of issue.path) at = (at as Record<string | number, unknown> | undefined)?.[k];
    const trap = at && typeof at === 'object' && !Array.isArray(at) && !('fr' in at)
      ? ' (astuce : une chaîne YAML qui contient « : » doit être entre guillemets ou en bloc « >- »)'
      : '';
    throw new ContentError(`${kind}: ${issue.path.join('.') || '(racine)'} — ${issue.message}${trap}`);
  }
  const data = r.data as ParsedContent['data'];
  return { kind, id: (data as { id: string }).id, data };
}
