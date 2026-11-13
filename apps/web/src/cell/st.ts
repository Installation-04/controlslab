// SPDX-License-Identifier: AGPL-3.0-only
/** Insert generated `VAR … END_VAR` declarations into an ST program without duplicating addresses. */
export function mergeDeclarations(source: string, generated: string): { source: string; added: number } {
  const lines = generated
    .split('\n')
    .filter((l) => /\bAT\s+%/i.test(l));
  const declared = new Set([...source.toUpperCase().matchAll(/%[IQM]X\d+\.\d+/g)].map((m) => m[0]));
  const fresh = lines.filter((l) => {
    const a = /%[IQM]X\d+\.\d+/i.exec(l)?.[0].toUpperCase();
    return a && !declared.has(a);
  });
  if (!fresh.length) return { source, added: 0 };
  const block = fresh.join('\n');
  const end = /^[ \t]*END_VAR\b/im.exec(source);
  if (end) {
    return { source: `${source.slice(0, end.index)}${block}\n${source.slice(end.index)}`, added: fresh.length };
  }
  const prog = /^[ \t]*PROGRAM\b.*$/im.exec(source);
  const at = prog ? prog.index + prog[0].length : 0;
  return { source: `${source.slice(0, at)}\nVAR\n${block}\nEND_VAR\n${source.slice(at)}`, added: fresh.length };
}

import type { EntityDef } from '@controlslab/factory';
import { SPECS, panelAddresses } from '@controlslab/factory';
import type { LdProgram } from '@controlslab/ladder';
import type { MachineDef } from '@controlslab/sim';

/** Add a BOOL variable for every bound field signal / panel point that the ladder program does not declare yet. */
export function mergeLdVars(ld: LdProgram, entities: EntityDef[], panelDef?: MachineDef): { program: LdProgram; added: number } {
  const have = new Set(ld.vars.map((v) => v.address?.toUpperCase()).filter(Boolean));
  const names = new Set(ld.vars.map((v) => v.name.toUpperCase()));
  const add: LdProgram['vars'] = [];
  const push = (name: string, address: string, comment: string) => {
    const a = address.toUpperCase();
    if (have.has(a)) return;
    let n = name;
    for (let i = 2; names.has(n.toUpperCase()); i++) n = `${name}_${i}`;
    names.add(n.toUpperCase());
    have.add(a);
    add.push({ name: n, type: 'BOOL', address: a, comment });
  };
  const pa = panelAddresses(panelDef);
  for (const c of panelDef?.components ?? []) {
    const a = c.params?.address;
    if (typeof a === 'string' && (pa.inputs.has(a.toUpperCase()) || pa.outputs.has(a.toUpperCase()))) push(`Panneau_${c.id}`, a, `panneau : ${c.id}`);
  }
  for (const e of entities) for (const s of SPECS[e.type].signals) if (e.io?.[s.name]) push(`${e.id}_${s.name}`, e.io[s.name]!, `${e.name ?? e.id} — ${s.label.fr}`);
  return { program: { ...ld, vars: [...ld.vars, ...add] }, added: add.length };
}
