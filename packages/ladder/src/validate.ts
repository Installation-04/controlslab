// SPDX-License-Identifier: AGPL-3.0-only
import { leaves } from './ops';
import type { LdProgram } from './types';

export interface LdIssue {
  level: 'error' | 'warning';
  code: 'bad_name' | 'duplicate' | 'unknown_var' | 'write_input' | 'bad_time' | 'bad_address' | 'empty_rung' | 'not_bool' | 'reserved';
  rung?: number;
  detail?: string;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ADDR = /^%[IQM]X\d+\.[0-7]$/i;
const RESERVED = new Set(['IF', 'THEN', 'ELSE', 'END_IF', 'VAR', 'END_VAR', 'PROGRAM', 'END_PROGRAM', 'AND', 'OR', 'NOT', 'XOR', 'TRUE', 'FALSE', 'MOD', 'FOR', 'WHILE', 'CASE', 'TO', 'DO', 'BY', 'OF', 'AT', 'EXIT', 'RETURN', 'REPEAT', 'UNTIL']);
const FB_MEMBERS: Record<string, string[]> = {
  TON: ['IN', 'PT', 'Q', 'ET'], TOF: ['IN', 'PT', 'Q', 'ET'], TP: ['IN', 'PT', 'Q', 'ET'],
  CTU: ['CU', 'R', 'PV', 'Q', 'CV'], CTD: ['CD', 'LD', 'PV', 'Q', 'CV'],
};

export function validateLd(p: LdProgram): LdIssue[] {
  const issues: LdIssue[] = [];
  const names = new Map<string, string>(); // upper → type
  const inputs = new Set<string>();
  for (const v of p.vars) {
    if (!NAME.test(v.name)) issues.push({ level: 'error', code: 'bad_name', detail: v.name });
    else if (RESERVED.has(v.name.toUpperCase())) issues.push({ level: 'error', code: 'reserved', detail: v.name });
    if (names.has(v.name.toUpperCase())) issues.push({ level: 'error', code: 'duplicate', detail: v.name });
    names.set(v.name.toUpperCase(), v.type);
    if (v.address) {
      if (!ADDR.test(v.address)) issues.push({ level: 'error', code: 'bad_address', detail: `${v.name} ${v.address}` });
      else if (v.address[1]!.toUpperCase() === 'I') inputs.add(v.name.toUpperCase());
    }
  }
  const fbs = new Map<string, string>();
  for (const r of p.rungs)
    for (const o of r.outputs)
      if (o.t === 'timer' || o.t === 'counter') {
        if (!NAME.test(o.name)) issues.push({ level: 'error', code: 'bad_name', detail: o.name });
        if (names.has(o.name.toUpperCase()) || fbs.has(o.name.toUpperCase())) issues.push({ level: 'error', code: 'duplicate', detail: o.name });
        fbs.set(o.name.toUpperCase(), o.fb);
      }

  const known = (ref: string): boolean => {
    const t = ref.trim();
    if (/^-?\d+(\.\d+)?$/.test(t) || /^(TRUE|FALSE)$/i.test(t) || /^T#/i.test(t)) return true;
    const [head, member] = t.split('.');
    if (member !== undefined) {
      const fb = fbs.get(head!.toUpperCase());
      return !!fb && (FB_MEMBERS[fb] ?? []).includes(member.toUpperCase());
    }
    return names.has(t.toUpperCase());
  };

  p.rungs.forEach((r, i) => {
    const n = i + 1;
    if (!r.logic && r.outputs.length === 0) issues.push({ level: 'warning', code: 'empty_rung', rung: n });
    for (const l of leaves(r.logic)) {
      const refs = l.t === 'contact' ? [l.v] : l.t === 'cmp' ? [l.a, l.b] : [];
      for (const ref of refs) if (!known(ref)) issues.push({ level: 'error', code: 'unknown_var', rung: n, detail: ref || '(vide)' });
      if (l.t === 'contact' && names.get(l.v.trim().toUpperCase()) && names.get(l.v.trim().toUpperCase()) !== 'BOOL') issues.push({ level: 'error', code: 'not_bool', rung: n, detail: l.v });
    }
    for (const o of r.outputs) {
      if (o.t === 'coil') {
        if (!known(o.v) || o.v.includes('.')) issues.push({ level: 'error', code: 'unknown_var', rung: n, detail: o.v || '(vide)' });
        else if (inputs.has(o.v.trim().toUpperCase())) issues.push({ level: 'error', code: 'write_input', rung: n, detail: o.v });
        else if (names.get(o.v.trim().toUpperCase()) && names.get(o.v.trim().toUpperCase()) !== 'BOOL') issues.push({ level: 'error', code: 'not_bool', rung: n, detail: o.v });
      } else if (o.t === 'timer') {
        if (!/^T#[0-9a-zA-Z_.]+$/i.test(o.pt.trim())) issues.push({ level: 'error', code: 'bad_time', rung: n, detail: o.pt });
      } else if (o.reset?.trim() && !known(o.reset)) issues.push({ level: 'error', code: 'unknown_var', rung: n, detail: o.reset });
    }
  });
  return issues;
}
