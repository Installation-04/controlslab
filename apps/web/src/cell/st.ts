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
