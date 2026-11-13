// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ladder → Structured Text. The result is readable, idiomatic ST: one BOOL per
 * rung (`_R1`), edge contacts via R_TRIG/F_TRIG, timers and counters as FB calls.
 * Execution order is top to bottom, exactly like a ladder scan.
 */
import type { LdProgram, LogicNode, Output, Rung } from './types';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const NUMBER = /^-?\d+(\.\d+)?$/;

/** Operand: identifier (maybe FB member), number or TRUE/FALSE; anything else is quoted as a comment-safe error marker. */
function operand(s: string): string {
  const t = s.trim();
  return IDENT.test(t) || NUMBER.test(t) || /^T#[0-9a-zA-Z_.]+$/i.test(t) ? t : `FALSE (* opérande invalide: ${t.replace(/\*\)/g, '')} *)`;
}

interface Ctx {
  edges: Array<{ name: string; fb: 'R_TRIG' | 'F_TRIG'; clk: string }>;
  n: number;
}

function expr(n: LogicNode, ctx: Ctx, top = true): string {
  switch (n.t) {
    case 'contact': {
      const v = operand(n.v);
      if (n.k === 'NO') return v;
      if (n.k === 'NC') return `NOT ${v}`;
      const name = `_${n.k}${++ctx.n}`;
      ctx.edges.push({ name, fb: n.k === 'P' ? 'R_TRIG' : 'F_TRIG', clk: v });
      return `${name}.Q`;
    }
    case 'cmp':
      return `(${operand(n.a)} ${n.op} ${operand(n.b)})`;
    case 'series': {
      const parts = n.items.map((c) => (c.t === 'parallel' ? `(${expr(c, ctx, false)})` : expr(c, ctx, false)));
      return parts.join(' AND ');
    }
    case 'parallel': {
      const parts = n.items.map((c) => expr(c, ctx, false));
      const s = parts.join(' OR ');
      return top ? s : s;
    }
  }
}

function outputST(o: Output, power: string): string[] {
  switch (o.t) {
    case 'coil': {
      const v = operand(o.v);
      if (o.k === 'normal') return [`${v} := ${power};`];
      if (o.k === 'negated') return [`${v} := NOT ${power};`];
      return [`IF ${power} THEN ${v} := ${o.k === 'set' ? 'TRUE' : 'FALSE'}; END_IF;`];
    }
    case 'timer':
      return [`${o.name}(IN := ${power}, PT := ${/^T#/i.test(o.pt.trim()) ? o.pt.trim() : 'T#1s'});`];
    case 'counter': {
      const r = o.reset?.trim() ? operand(o.reset) : 'FALSE';
      return o.fb === 'CTU'
        ? [`${o.name}(CU := ${power}, R := ${r}, PV := ${o.pv});`]
        : [`${o.name}(CD := ${power}, LD := ${r}, PV := ${o.pv});`];
    }
  }
}

const decl = (v: LdProgram['vars'][number]) =>
  `    ${v.name}${v.address ? ` AT ${v.address.toUpperCase()}` : ''} : ${v.type};${v.comment ? `   (* ${v.comment.replace(/\*\)/g, '')} *)` : ''}`;

export function toST(p: LdProgram): string {
  const body: string[] = [];
  const fbDecls: string[] = [];
  const temps: string[] = [];
  const ctx: Ctx = { edges: [], n: 0 };

  p.rungs.forEach((r: Rung, i: number) => {
    const before = ctx.edges.length;
    const cond = r.logic ? expr(r.logic, ctx) : 'TRUE';
    const lines: string[] = [];
    lines.push(`(* Échelon ${i + 1}${r.comment ? ` — ${r.comment.replace(/\*\)/g, '')}` : ''} *)`);
    for (const e of ctx.edges.slice(before)) lines.push(`${e.name}(CLK := ${e.clk});`);
    const tmp = `_R${i + 1}`;
    temps.push(`    ${tmp} : BOOL;`);
    lines.push(`${tmp} := ${cond};`);
    for (const o of r.outputs) {
      lines.push(...outputST(o, tmp));
      if (o.t === 'timer' || o.t === 'counter') {
        const line = `    ${o.name} : ${o.fb};`;
        if (!fbDecls.includes(line)) fbDecls.push(line);
      }
    }
    body.push(lines.join('\n'));
  });
  for (const e of ctx.edges) fbDecls.push(`    ${e.name} : ${e.fb};`);

  const declared = p.vars.map(decl);
  return [
    `PROGRAM ${p.name}`,
    'VAR',
    ...declared,
    ...fbDecls,
    ...temps,
    'END_VAR',
    '',
    body.join('\n\n'),
    '',
    'END_PROGRAM',
    '',
  ].join('\n');
}
