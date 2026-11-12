// SPDX-License-Identifier: AGPL-3.0-only
import type { MachineDef } from '@controlslab/sim';
import { SPECS, type EntityDef } from './types';

export interface Issue {
  level: 'error' | 'warning';
  entity?: string;
  code: 'bad_address' | 'wrong_area' | 'input_conflict' | 'panel_conflict' | 'overlap' | 'duplicate_id' | 'unbound' | 'no_panel_motor';
  detail?: string;
}

const ADDR = /^%[IQ]X\d+\.[0-7]$/i;
export const normAddr = (a: string) => a.trim().toUpperCase();

/** Panel I/O belongs to the panel's own wiring: field I/O must use other addresses. */
export function panelAddresses(def: MachineDef | undefined): { inputs: Set<string>; outputs: Set<string> } {
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  for (const c of def?.components ?? []) {
    const a = c.params?.address;
    if (typeof a !== 'string') continue;
    if (c.type === 'plc_input') inputs.add(normAddr(a));
    if (c.type === 'plc_output') outputs.add(normAddr(a));
  }
  return { inputs, outputs };
}

export function validateCell(entities: EntityDef[], panelDef?: MachineDef): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set<string>();
  const panel = panelAddresses(panelDef);
  const inputOwner = new Map<string, string>();
  for (const e of entities) {
    if (ids.has(e.id)) issues.push({ level: 'error', entity: e.id, code: 'duplicate_id' });
    ids.add(e.id);
    for (const s of SPECS[e.type].signals) {
      const raw = e.io?.[s.name];
      if (!raw) {
        issues.push({ level: 'warning', entity: e.id, code: 'unbound', detail: s.name });
        continue;
      }
      if (!ADDR.test(raw.trim())) {
        issues.push({ level: 'error', entity: e.id, code: 'bad_address', detail: raw });
        continue;
      }
      const a = normAddr(raw);
      const area = a[1];
      if ((s.dir === 'input' && area !== 'I') || (s.dir === 'output' && area !== 'Q')) {
        issues.push({ level: 'error', entity: e.id, code: 'wrong_area', detail: `${s.name} ${a}` });
      }
      if (s.dir === 'input') {
        if (panel.inputs.has(a)) issues.push({ level: 'error', entity: e.id, code: 'panel_conflict', detail: a });
        const prev = inputOwner.get(a);
        if (prev && prev !== `${e.id}.${s.name}`) issues.push({ level: 'error', entity: e.id, code: 'input_conflict', detail: `${a} (${prev})` });
        inputOwner.set(a, `${e.id}.${s.name}`);
      }
    }
  }
  // Overlap of floor footprints (excluding sensors/lights placed on or beside belts, and the panel).
  const solid = entities.filter((e) => ['conveyor', 'bin', 'panel', 'spawner'].includes(e.type));
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i]!;
      const b = solid[j]!;
      if (a.type === 'spawner' || b.type === 'spawner') continue;
      if (a.type === 'conveyor' && (b.type === 'conveyor' || b.type === 'bin')) continue; // belts chain end to end; a bin sits under the belt end
      if (b.type === 'conveyor' && a.type === 'bin') continue;
      if (footprintsOverlap(a, b)) issues.push({ level: 'warning', entity: a.id, code: 'overlap', detail: b.id });
    }
  }
  return issues;
}

function footprintsOverlap(a: EntityDef, b: EntityDef): boolean {
  const ext = (e: EntityDef) => {
    const [l, w] = SPECS[e.type].size({ ...Object.fromEntries(SPECS[e.type].params.map((p) => [p.key, p.default])), ...e.params });
    const h = e.rot === 0 || e.rot === 180;
    return { hx: (h ? l : w) / 2, hz: (h ? w : l) / 2 };
  };
  const A = ext(a);
  const B = ext(b);
  return Math.abs(a.x - b.x) < A.hx + B.hx - 0.01 && Math.abs(a.z - b.z) < A.hz + B.hz - 0.01;
}

/** Suggest the next free field address of the given area (field I/O starts at byte 1). */
export function nextAddress(entities: EntityDef[], area: 'I' | 'Q', panelDef?: MachineDef): string {
  const used = new Set<string>();
  for (const e of entities) for (const v of Object.values(e.io ?? {})) if (v) used.add(normAddr(v));
  const p = panelAddresses(panelDef);
  for (const a of [...p.inputs, ...p.outputs]) used.add(a);
  for (let byte = 1; byte < 8; byte++) {
    for (let bit = 0; bit < 8; bit++) {
      const a = `%${area}X${byte}.${bit}`;
      if (!used.has(a)) return a;
    }
  }
  return `%${area}X8.0`;
}

/**
 * Generate ST declarations for every bound signal (symbolic names from the
 * entity id + signal), ready to paste into a PROGRAM's VAR block.
 */
export function generateDeclarations(entities: EntityDef[], panelDef?: MachineDef): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  const add = (name: string, addr: string, note: string) => {
    const a = normAddr(addr);
    if (seen.has(a)) return;
    seen.add(a);
    lines.push(`    ${name.padEnd(18)} AT ${a.padEnd(8)} : BOOL;   (* ${note} *)`);
  };
  for (const c of panelDef?.components ?? []) {
    const a = c.params?.address;
    if (typeof a === 'string' && (c.type === 'plc_input' || c.type === 'plc_output')) add(`Panneau_${c.id}`, a, `panneau : ${c.id}`);
  }
  for (const e of entities) {
    for (const s of SPECS[e.type].signals) {
      const a = e.io?.[s.name];
      if (a) add(`${e.id}_${s.name}`, a, `${e.name ?? SPECS[e.type].label.fr} — ${s.label.fr}`);
    }
  }
  return `VAR\n${lines.join('\n')}\nEND_VAR`;
}
