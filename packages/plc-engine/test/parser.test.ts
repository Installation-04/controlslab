import { describe, expect, it } from 'vitest';
import { parse, PlcError } from '../src';

describe('parser', () => {
  it('parses a program with var sections, AT and initializers', () => {
    const u = parse(`
      VAR_GLOBAL Speed : INT := 5; END_VAR
      PROGRAM Main
      VAR_INPUT a : BOOL; END_VAR
      VAR CONSTANT k : INT := 3; END_VAR
      VAR
        start AT %IX0.0 : BOOL;
        x, y : DINT := 2;
        arr : ARRAY[1..3] OF INT := [1, 2, 3];
        s : STRING[20];
      END_VAR
      ;
      END_PROGRAM`);
    expect(u.globals).toHaveLength(1);
    const p = u.pous[0]!;
    expect(p.kind).toBe('PROGRAM');
    expect(p.vars.map((v) => v.name)).toEqual(['A', 'K', 'START', 'X', 'Y', 'ARR', 'S']);
    expect(p.vars[1]!.constant).toBe(true);
    expect(p.vars[2]!.address).toBe('%IX0.0');
    expect(p.vars[5]!.type).toMatchObject({ kind: 'array', lo: 1, hi: 3 });
  });

  it('respects operator precedence', () => {
    const u = parse('PROGRAM P VAR x : INT; END_VAR x := 1 + 2 * 3 ** 2; END_PROGRAM');
    const s = u.pous[0]!.body[0]!;
    expect(s.kind).toBe('assign');
    const v = (s as { value: { op: string; right: { op: string; right: { op: string } } } }).value;
    expect(v.op).toBe('+');
    expect(v.right.op).toBe('*');
    expect(v.right.right.op).toBe('**');
  });

  it('parses AND/& and OR precedence', () => {
    const u = parse('PROGRAM P VAR a,b,c : BOOL; END_VAR a := a OR b & c; END_PROGRAM');
    const v = (u.pous[0]!.body[0] as { value: { op: string; right: { op: string } } }).value;
    expect(v.op).toBe('OR');
    expect(v.right.op).toBe('AND');
  });

  it('parses control structures', () => {
    const u = parse(`PROGRAM P VAR i : INT; END_VAR
      IF i > 0 THEN i := 1; ELSIF i < 0 THEN i := 2; ELSE i := 3; END_IF;
      CASE i OF 1, 2: i := 0; 3..5: i := 1; ELSE i := 9; END_CASE;
      FOR i := 1 TO 10 BY 2 DO EXIT; END_FOR;
      WHILE i < 3 DO i := i + 1; END_WHILE;
      REPEAT i := i - 1; UNTIL i <= 0 END_REPEAT;
      RETURN;
    END_PROGRAM`);
    expect(u.pous[0]!.body.map((s) => s.kind)).toEqual(['if', 'case', 'for', 'while', 'repeat', 'return']);
  });

  it('parses FB calls with input and output bindings', () => {
    const u = parse('PROGRAM P VAR t : TON; q : BOOL; END_VAR t(IN := TRUE, PT := T#1s, Q => q); END_PROGRAM');
    const s = u.pous[0]!.body[0]!;
    expect(s.kind).toBe('fbcall');
    expect((s as { args: Array<{ name: string; output: boolean }> }).args.map((a) => [a.name, a.output])).toEqual([
      ['IN', false], ['PT', false], ['Q', true],
    ]);
  });

  it('parses functions and function blocks', () => {
    const u = parse(`FUNCTION Twice : INT VAR_INPUT x : INT; END_VAR Twice := x * 2; END_FUNCTION
      FUNCTION_BLOCK Fb VAR_OUTPUT o : BOOL; END_VAR o := TRUE; END_FUNCTION_BLOCK
      PROGRAM P END_PROGRAM`);
    expect(u.pous.map((p) => p.kind)).toEqual(['FUNCTION', 'FUNCTION_BLOCK', 'PROGRAM']);
    expect(u.pous[0]!.returnType!.name).toBe('INT');
  });

  it('parses typed literals, negative and bool forms', () => {
    const u = parse('PROGRAM P VAR x : INT; b : BOOL; END_VAR x := INT#-5; b := BOOL#1; END_PROGRAM');
    const [a, b] = u.pous[0]!.body as Array<{ value: { value: unknown; type: string } }>;
    expect(a!.value).toMatchObject({ value: -5, type: 'INT' });
    expect(b!.value).toMatchObject({ value: true, type: 'BOOL' });
  });

  it('parses member, index and bit access', () => {
    const u = parse('PROGRAM P VAR w : WORD; a : ARRAY[0..1] OF BOOL; END_VAR a[0] := w.3; END_PROGRAM');
    const s = u.pous[0]!.body[0] as { target: { kind: string }; value: { kind: string; member: string } };
    expect(s.target.kind).toBe('index');
    expect(s.value).toMatchObject({ kind: 'member', member: '3' });
  });

  it('reports syntax errors with location', () => {
    const cases: Array<[string, RegExp]> = [
      ['PROGRAM P x := ; END_PROGRAM', /Expression attendue/],
      ['PROGRAM P VAR x : INT END_VAR END_PROGRAM', /« ; » attendu/],
      ['PROGRAM P IF TRUE x := 1; END_IF END_PROGRAM', /THEN/],
      ['FOO', /PROGRAM/],
      ['PROGRAM P x; END_PROGRAM', /:=/],
      ['PROGRAM P 5 := 3; END_PROGRAM', /Instruction attendue/],
      ['PROGRAM P VAR x AT 5 : BOOL; END_VAR END_PROGRAM', /%I/],
      ['PROGRAM P VAR a : ARRAY[0..x] OF INT; END_VAR END_PROGRAM', /entier/],
    ];
    for (const [src, re] of cases) {
      expect(() => parse(src), src).toThrow(re);
    }
    try {
      parse('PROGRAM P\n  x := ;\nEND_PROGRAM');
    } catch (e) {
      expect((e as PlcError).pos).toEqual({ line: 2, col: 8 });
      expect((e as PlcError).kind).toBe('syntax');
    }
  });
});
