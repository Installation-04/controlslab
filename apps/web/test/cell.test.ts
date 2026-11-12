import { describe, expect, it } from 'vitest';
import { mergeDeclarations } from '../src/cell/st';

const gen = `VAR
    PH1_detect         AT %IX1.0  : BOOL;   (* sensor *)
    CV1_run            AT %QX1.0  : BOOL;   (* belt *)
END_VAR`;

describe('mergeDeclarations', () => {
  it('inserts new declarations before the first END_VAR', () => {
    const src = 'PROGRAM Main\nVAR\n    A AT %IX0.0 : BOOL;\nEND_VAR\nA := TRUE;\nEND_PROGRAM';
    const r = mergeDeclarations(src, gen);
    expect(r.added).toBe(2);
    expect(r.source.indexOf('PH1_detect')).toBeLessThan(r.source.indexOf('END_VAR'));
    expect(r.source).toContain('A := TRUE;');
  });

  it('skips addresses that are already declared (case-insensitive)', () => {
    const src = 'PROGRAM Main\nVAR\n    Capteur AT %ix1.0 : BOOL;\nEND_VAR\nEND_PROGRAM';
    const r = mergeDeclarations(src, gen);
    expect(r.added).toBe(1);
    expect(r.source).not.toContain('PH1_detect');
    expect(r.source).toContain('CV1_run');
  });

  it('is idempotent', () => {
    const once = mergeDeclarations('PROGRAM Main\nEND_PROGRAM', gen);
    const twice = mergeDeclarations(once.source, gen);
    expect(twice.added).toBe(0);
    expect(twice.source).toBe(once.source);
  });

  it('creates a VAR block when the program has none', () => {
    const r = mergeDeclarations('PROGRAM Main\nEND_PROGRAM', gen);
    expect(r.source).toMatch(/PROGRAM Main\nVAR\n/);
    expect(r.source).toContain('END_VAR');
  });
});
