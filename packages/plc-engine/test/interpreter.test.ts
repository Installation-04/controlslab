import { describe, expect, it } from 'vitest';
import { exec, loadErr, prog, run } from './helpers';

describe('expressions & types', () => {
  it('integer arithmetic truncates and wraps like a PLC', () => {
    const p = exec('a : INT; b : INT; c : INT; d : SINT := 127; e : UINT;', 'a := 7 / 2; b := -7 / 2; c := 7 MOD 3; d := d + 1; e := 0 - 1;');
    expect(p.read('a')).toBe(3);
    expect(p.read('b')).toBe(-3);
    expect(p.read('c')).toBe(1);
    expect(p.read('d')).toBe(-128);
    expect(p.read('e')).toBe(65535);
  });

  it('real arithmetic and int→real promotion', () => {
    const p = exec('r : REAL; l : LREAL; i : INT := 3;', 'r := i / 2.0; l := 2 ** 10;');
    expect(p.read('r')).toBe(1.5);
    expect(p.read('l')).toBe(1024);
  });

  it('boolean logic and comparisons', () => {
    const p = exec('a : BOOL := TRUE; b : BOOL; x, y, z, w : BOOL; i : INT := 5;',
      'x := a AND NOT b; y := a XOR TRUE; z := (i >= 5) & (i <> 4) OR b; w := a = b;');
    expect(p.snapshot()).toMatchObject({ 'Main.x': true, 'Main.y': false, 'Main.z': true, 'Main.w': false });
  });

  it('bitwise ops on WORD, NOT, bit access read/write', () => {
    const p = exec('w : WORD := 16#00F0; m : WORD; n : WORD; b3, b4 : BOOL;',
      'm := w AND 16#0030 OR 1; n := NOT w; b3 := w.3; b4 := w.4; w.0 := TRUE;');
    expect(p.read('m')).toBe(0x31);
    expect(p.read('n')).toBe(0xff0f);
    expect(p.read('b3')).toBe(false);
    expect(p.read('b4')).toBe(true);
    expect(p.read('w')).toBe(0xf1);
  });

  it('XOR/OR on integers', () => {
    const p = exec('a : INT; b : INT;', 'a := 6 XOR 3; b := 4 OR 1;');
    expect([p.read('a'), p.read('b')]).toEqual([5, 5]);
  });

  it('TIME arithmetic and comparison', () => {
    const p = exec('t : TIME := T#1s; u : TIME; ok : BOOL;', 'u := t * 2 + T#500ms - T#100ms; u := u / 2; ok := u > T#1s; t := -t;');
    expect(p.read('u')).toBe(1200);
    expect(p.read('ok')).toBe(true);
    expect(p.read('t')).toBe(-1000);
  });

  it('string handling', () => {
    const p = exec("s : STRING := 'Moteur'; n : INT; c : STRING; eq : BOOL; l, r : STRING;",
      "n := LEN(s); c := CONCAT(s, ' M1'); eq := s = 'Moteur'; l := LEFT(s, 3); r := RIGHT(s, 2);");
    expect([p.read('n'), p.read('c'), p.read('eq'), p.read('l'), p.read('r')]).toEqual([6, 'Moteur M1', true, 'Mot', 'ur']);
  });

  it('standard functions', () => {
    const p = exec('a : INT; b : INT; c : INT; d : REAL; e : INT; f : DINT; g : INT; h : WORD; k : WORD; m : INT; n : BYTE; o : BYTE; q : REAL;',
      `a := ABS(-4); b := MIN(3, 1, 2); c := MAX(3, 9); d := SQRT(16.0); e := LIMIT(0, 150, 100);
       f := TRUNC(3.7); g := SEL(TRUE, 1, 2); h := SHL(16#0001, 4); k := SHR(16#0100, 8); m := MUX(1, 10, 20, 30);
       n := ROL(BYTE#16#81, 1); o := ROR(BYTE#16#81, 1); q := MOVE(2.5);`);
    expect(p.snapshot()).toMatchObject({
      'Main.a': 4, 'Main.b': 1, 'Main.c': 9, 'Main.d': 4, 'Main.e': 100, 'Main.f': 3, 'Main.g': 2,
      'Main.h': 16, 'Main.k': 1, 'Main.m': 20, 'Main.n': 0x03, 'Main.o': 0xc0, 'Main.q': 2.5,
    });
  });

  it('trig/log functions return REAL', () => {
    const p = exec('a, b, c, d, e, f, g, h, i, j : REAL;',
      'a := SIN(0.0); b := COS(0.0); c := TAN(0.0); d := ASIN(0.0); e := ACOS(1.0); f := ATAN(0.0); g := LN(1.0); h := LOG(100.0); i := EXP(0.0); j := SQRT(2);');
    expect([p.read('b'), p.read('h'), p.read('i')]).toEqual([1, 2, 1]);
    expect(p.read('j')).toBeCloseTo(Math.SQRT2, 5);
  });

  it('type conversions', () => {
    const p = exec('i : INT; r : REAL; d : DINT; b : BOOL; s : STRING; t : DINT; j : INT; k : INT; bi : INT;',
      "r := INT_TO_REAL(7); i := REAL_TO_INT(2.5); j := REAL_TO_INT(-2.5); k := DINT_TO_INT(70000); d := TIME_TO_DINT(T#2s); b := INT_TO_BOOL(3); s := INT_TO_STRING(42); bi := BOOL_TO_INT(TRUE); t := STRING_TO_DINT('12');");
    expect(p.snapshot()).toMatchObject({
      'Main.r': 7, 'Main.i': 3, 'Main.j': -3, 'Main.k': 4464, 'Main.d': 2000, 'Main.b': true, 'Main.s': '42', 'Main.bi': 1, 'Main.t': 12,
    });
    const q = exec('b : BOOL; s : STRING;', "b := STRING_TO_BOOL('true'); s := BOOL_TO_STRING(FALSE);");
    expect([q.read('b'), q.read('s')]).toEqual([true, 'FALSE']);
  });

  it('arrays: init, index, bounds fault, whole-array copy', () => {
    const p = exec('a : ARRAY[1..3] OF INT := [10, 20]; b : ARRAY[1..3] OF INT; s : INT; i : INT;',
      'FOR i := 1 TO 3 DO s := s + a[i]; END_FOR; b := a; b[1] := 99;');
    expect(p.read('s')).toBe(30);
    expect(p.read('a')).toEqual([10, 20, 0]);
    expect(p.read('b')).toEqual([99, 20, 0]);
    expect(p.read('a.1')).toBe(20);
    const q = run(prog('a : ARRAY[0..1] OF INT; i : INT := 5;', 'a[i] := 1;'));
    q.scan();
    expect(q.mode).toBe('faulted');
    expect(q.fault?.code).toBe('INDEX_OUT_OF_RANGE');
  });

  it('constants and globals', () => {
    const p = run(`VAR_GLOBAL g : INT := 2; END_VAR
      PROGRAM Main VAR CONSTANT K : INT := 10; END_VAR VAR x : INT; END_VAR VAR_EXTERNAL g : INT; END_VAR
      x := K * g; g := g + 1; END_PROGRAM`);
    p.scan();
    expect(p.read('x')).toBe(20);
    expect(p.read('g')).toBe(3);
  });
});

describe('statements', () => {
  it('IF/ELSIF/ELSE picks the first true branch', () => {
    const src = (v: number) => exec(`i : INT := ${v}; r : INT;`, 'IF i > 10 THEN r := 1; ELSIF i > 5 THEN r := 2; ELSE r := 3; END_IF');
    expect([src(11).read('r'), src(6).read('r'), src(0).read('r')]).toEqual([1, 2, 3]);
  });

  it('CASE with lists, ranges and ELSE', () => {
    const src = (v: number) => exec(`i : INT := ${v}; r : INT;`, 'CASE i OF 1, 2: r := 10; 3..5: r := 20; -1: r := 30; ELSE r := 99; END_CASE');
    expect([1, 2, 4, -1, 7].map((v) => src(v).read('r'))).toEqual([10, 10, 20, 30, 99]);
  });

  it('CASE without ELSE leaves values', () => {
    expect(exec('i : INT := 7; r : INT := 5;', 'CASE i OF 1: r := 1; END_CASE').read('r')).toBe(5);
  });

  it('FOR counts up, down, with BY and EXIT', () => {
    expect(exec('i, s : INT;', 'FOR i := 1 TO 5 DO s := s + i; END_FOR').read('s')).toBe(15);
    expect(exec('i, s : INT;', 'FOR i := 10 TO 1 BY -3 DO s := s + i; END_FOR').read('s')).toBe(22);
    expect(exec('i, s : INT;', 'FOR i := 1 TO 100 DO IF i > 3 THEN EXIT; END_IF; s := s + 1; END_FOR').read('s')).toBe(3);
    expect(exec('i, s : INT;', 'FOR i := 5 TO 1 DO s := 1; END_FOR').read('s')).toBe(0);
  });

  it('WHILE and REPEAT', () => {
    expect(exec('i : INT;', 'WHILE i < 7 DO i := i + 2; END_WHILE').read('i')).toBe(8);
    expect(exec('i : INT := 10;', 'REPEAT i := i + 1; UNTIL TRUE END_REPEAT').read('i')).toBe(11);
    expect(exec('i : INT;', 'WHILE TRUE DO i := i + 1; IF i = 4 THEN EXIT; END_IF END_WHILE').read('i')).toBe(4);
    expect(exec('i : INT;', 'REPEAT i := i + 1; IF i = 2 THEN EXIT; END_IF UNTIL FALSE END_REPEAT').read('i')).toBe(2);
  });

  it('RETURN stops the program body', () => {
    expect(exec('i : INT;', 'i := 1; IF TRUE THEN RETURN; END_IF; i := 2;').read('i')).toBe(1);
    expect(exec('i : INT;', 'WHILE TRUE DO i := 1; RETURN; END_WHILE; i := 2;').read('i')).toBe(1);
    expect(exec('i, j : INT;', 'FOR j := 1 TO 3 DO RETURN; END_FOR; i := 2;').read('i')).toBe(0);
    expect(exec('i : INT;', 'REPEAT RETURN; UNTIL TRUE END_REPEAT; i := 2;').read('i')).toBe(0);
  });

  it('watchdog trips on an infinite loop and faults the PLC', () => {
    const p = run(prog('i : INT;', 'WHILE TRUE DO i := i + 1; END_WHILE'));
    expect(p.scan()).toBe(false);
    expect(p.mode).toBe('faulted');
    expect(p.fault?.code).toBe('WATCHDOG');
    expect(p.scan()).toBe(false);
    p.reset();
    expect(p.mode).toBe('stopped');
  });

  it('integer division by zero faults', () => {
    const p = run(prog('a : INT; z : INT;', 'a := 5 / z;'));
    p.scan();
    expect(p.fault?.code).toBe('DIV_BY_ZERO');
    const m = run(prog('a : INT; z : INT;', 'a := 5 MOD z;'));
    m.scan();
    expect(m.fault?.code).toBe('DIV_BY_ZERO');
    const t = run(prog('a : TIME; z : INT;', 'a := T#1s / z;'));
    t.scan();
    expect(t.fault?.code).toBe('DIV_BY_ZERO');
  });

  it('real division by zero gives infinity (no fault)', () => {
    const p = exec('r : LREAL; z : LREAL;', 'r := 1.0 / z;');
    expect(p.read('r')).toBe(Infinity);
  });
});

describe('POUs', () => {
  it('user FUNCTION with positional and named args', () => {
    const p = run(`FUNCTION Scale : REAL VAR_INPUT raw : INT; k : REAL; END_VAR VAR tmp : REAL; END_VAR
        tmp := raw * k; Scale := tmp; END_FUNCTION
      PROGRAM Main VAR a, b : REAL; END_VAR a := Scale(10, 0.5); b := Scale(k := 2.0, raw := 3); END_PROGRAM`);
    p.scan();
    expect([p.read('a'), p.read('b')]).toEqual([5, 6]);
  });

  it('recursive function call faults at runtime', () => {
    const p = run(`FUNCTION F : INT VAR_INPUT n : INT; END_VAR F := F(n); END_FUNCTION
      PROGRAM Main VAR a : INT; END_VAR a := F(1); END_PROGRAM`);
    p.scan();
    expect(p.fault?.code).toBe('RECURSION');
  });

  it('user FUNCTION_BLOCK keeps state between calls; outputs readable; in/out param', () => {
    const p = run(`FUNCTION_BLOCK Latch
        VAR_INPUT set, rst : BOOL; END_VAR
        VAR_OUTPUT q : BOOL; END_VAR
        VAR_IN_OUT n : INT; END_VAR
        VAR hits : INT; END_VAR
        IF set THEN q := TRUE; hits := hits + 1; n := n + 1; END_IF
        IF rst THEN q := FALSE; END_IF
      END_FUNCTION_BLOCK
      PROGRAM Main VAR l : Latch; s : BOOL := TRUE; r : BOOL; out : BOOL; cnt : INT; END_VAR
        l(set := s, rst := r, q => out, n := cnt); s := FALSE;
      END_PROGRAM`);
    p.scan();
    p.scan();
    expect(p.read('out')).toBe(true);
    expect(p.read('l.q')).toBe(true);
    expect(p.read('cnt')).toBe(1);
    expect(p.read('Main.l.HITS')).toBe(1);
  });

  it('FB inputs may be assigned before a call (IN := then call without args)', () => {
    const p = run(prog('t : TON; q : BOOL;', 't.IN := TRUE; t.PT := T#20ms; t(); q := t.Q;'));
    p.runFor(30);
    expect(p.read('q')).toBe(true);
  });

  it('positional FB args map to inputs in order', () => {
    const p = run(prog('t : TON;', 't(TRUE, T#10ms);'));
    p.runFor(20);
    expect(p.read('t.Q')).toBe(true);
  });

  it('arrays of FB instances', () => {
    const p = run(prog('t : ARRAY[0..1] OF TON; i : INT;', 'FOR i := 0 TO 1 DO t[i](IN := i = 1, PT := T#10ms); END_FOR'));
    p.runFor(30);
    expect(p.read('t.0')).toBeDefined();
    const s = p.snapshot();
    expect(Object.keys(s)).toContain('Main.t');
  });

  it('nested user FB instances', () => {
    const p = run(`FUNCTION_BLOCK Inner VAR_OUTPUT o : INT; END_VAR o := o + 1; END_FUNCTION_BLOCK
      FUNCTION_BLOCK Outer VAR_OUTPUT v : INT; END_VAR VAR i : Inner; END_VAR i(); v := i.o; END_FUNCTION_BLOCK
      PROGRAM Main VAR x : Outer; r : INT; END_VAR x(); r := x.v; END_PROGRAM`);
    p.scan();
    p.scan();
    expect(p.read('r')).toBe(2);
  });

  it('multiple PROGRAMs run in declaration order each scan', () => {
    const p = run(`VAR_GLOBAL g : INT; END_VAR
      PROGRAM A VAR_EXTERNAL g : INT; END_VAR g := g * 10; END_PROGRAM
      PROGRAM B VAR_EXTERNAL g : INT; END_VAR g := g + 1; END_PROGRAM`);
    p.scan();
    p.scan();
    expect(p.read('g')).toBe(11);
    expect(p.read('B.g')).toBe(11);
  });
});

describe('semantic errors', () => {
  const cases: Array<[string, string]> = [
    [prog('x : INT;', 'y := 1;'), 'UNKNOWN_VAR'],
    [prog('x : FOO;', ''), 'UNKNOWN_TYPE'],
    [prog('x : INT; x : BOOL;', ''), 'DUPLICATE_VAR'],
    [prog('x : INT;', 'x := TRUE;'), 'ASSIGN_MISMATCH'],
    [prog('x : INT; r : REAL;', 'x := r;'), 'ASSIGN_MISMATCH'],
    [prog('x : INT; d : DINT;', 'x := d;'), 'ASSIGN_MISMATCH'],
    [prog('x : INT;', 'IF x THEN x := 1; END_IF'), 'EXPECTED_BOOL'],
    [prog('x : BOOL;', 'x := 1 + TRUE;'), 'TYPE_MISMATCH'],
    [prog('x : BOOL;', 'x := TRUE < FALSE;'), 'TYPE_MISMATCH'],
    [prog('x : BOOL; s : STRING;', 'x := s AND x;'), 'TYPE_MISMATCH'],
    [prog('x : REAL;', 'x := 1.0 MOD 2.0;'), 'TYPE_MISMATCH'],
    [prog('x : REAL;', 'x := TRUE ** 2;'), 'TYPE_MISMATCH'],
    [prog('x : BOOL;', 'x := TRUE * 2;'), 'TYPE_MISMATCH'],
    [prog('x : BOOL;', 'x := TRUE / 2;'), 'TYPE_MISMATCH'],
    [prog('x : BOOL;', 'x := TRUE - 2;'), 'TYPE_MISMATCH'],
    [prog('', 'EXIT;'), 'EXIT_OUTSIDE_LOOP'],
    [prog('t : TON;', 't.Q := TRUE;'), 'READ_ONLY'],
    [prog('t : TON;', 't.FOO := TRUE;'), 'UNKNOWN_MEMBER'],
    [prog('t : TON;', 't(FOO := TRUE);'), 'BAD_ARG'],
    [prog('t : TON; b : BOOL;', 't(Q := b);'), 'OUTPUT_BINDING'],
    [prog('t : TON; b : BOOL;', 't(IN => b);'), 'OUTPUT_BINDING'],
    [prog('t : TON;', 't(Q => TRUE);'), 'NOT_ASSIGNABLE'],
    [prog('t : TON; i : INT;', 't(Q => i);'), 'ASSIGN_MISMATCH'],
    [prog('t : TON;', 't(IN := 5);'), 'ASSIGN_MISMATCH'],
    [prog('x : INT;', 'x();'), 'NOT_CALLABLE'],
    [prog('t : TON; b : BOOL;', 'b := t();'), 'NOT_CALLABLE'],
    [prog('x : INT;', 'x := NOPE(1);'), 'UNKNOWN_FUNCTION'],
    [prog('x : INT;', 'x := ABS(1, 2);'), 'BAD_ARG_COUNT'],
    [prog('x : INT;', 'x[1] := 1;'), 'NOT_INDEXABLE'],
    [prog('a : ARRAY[0..1] OF INT;', 'a[TRUE] := 1;'), 'EXPECTED_INT'],
    [prog('a : ARRAY[0..1] OF INT := [1,2,3];', ''), 'CONSTANT_INIT'],
    [prog('a : ARRAY[0..1] OF INT := [TRUE];', ''), 'ASSIGN_MISMATCH'],
    [prog('a : ARRAY[3..1] OF INT;', ''), 'BAD_ARRAY_BOUNDS'],
    [prog('a : INT := [1];', ''), 'CONSTANT_INIT'],
    [prog('t : TON := 5;', ''), 'CONSTANT_INIT'],
    [prog('a : INT := TRUE;', ''), 'ASSIGN_MISMATCH'],
    [prog('i : INT;', 'CASE TRUE OF 1: i := 1; END_CASE'), 'EXPECTED_INT'],
    [prog('i : INT;', 'CASE i OF 1.5: i := 1; END_CASE'), 'EXPECTED_INT'],
    [prog('r : REAL;', 'FOR r := 1 TO 2 DO END_FOR'), 'EXPECTED_INT'],
    [prog('i : INT;', 'FOR i := 1 TO 2.5 DO END_FOR'), 'EXPECTED_INT'],
    [prog('i : INT;', 'i := i.FOO;'), 'UNKNOWN_MEMBER'],
    [prog('r : REAL; b : BOOL;', 'b := r.1;'), 'UNKNOWN_MEMBER'],
    [prog('s : STRING; b : BOOL;', 'b := NOT s;'), 'BAD_OPERAND'],
    [prog('b : BOOL;', 'b := -b;'), 'BAD_OPERAND'],
    [prog('i : INT;', 'i := LEN(5);'), 'BAD_OPERAND'],
    [prog('i : INT;', 'i := SQRT(TRUE);'), 'BAD_OPERAND'],
    [prog('i : INT;', 'i := MIN(1, TRUE);'), 'TYPE_MISMATCH'],
    [prog('i : INT;', 'i := SEL(1, 2, 3);'), 'EXPECTED_BOOL'],
    [prog('i : INT;', 'i := MUX(TRUE, 2, 3);'), 'EXPECTED_INT'],
    [prog('i : INT;', 'i := SHL(1.5, 2);'), 'BAD_OPERAND'],
    [prog('i : INT;', 'i := SHL(1, 2.5);'), 'EXPECTED_INT'],
    [prog('s : STRING;', "s := CONCAT('a', 5);"), 'BAD_OPERAND'],
    [prog('i : INT;', 'i := REAL_TO_INT(TRUE);'), 'TYPE_MISMATCH'],
    [prog('a : ARRAY[0..1] OF TON;', 'a[0] := a[1];'), 'READ_ONLY'],
    [prog('t : TON; u : TON;', 't := u;'), 'NOT_ASSIGNABLE'],
    [prog('i : INT;', '5(); '), 'EXPECTED_STMT'],
    ['FUNCTION_BLOCK F END_FUNCTION_BLOCK', 'NO_PROGRAM'],
    ['PROGRAM A END_PROGRAM PROGRAM A END_PROGRAM', 'DUPLICATE_POU'],
    ['PROGRAM TON END_PROGRAM', 'DUPLICATE_POU'],
    ['VAR_GLOBAL g : INT; g : INT; END_VAR PROGRAM A END_PROGRAM', 'DUPLICATE_VAR'],
    ['PROGRAM A VAR_EXTERNAL g : INT; END_VAR END_PROGRAM', 'UNKNOWN_VAR'],
    ['FUNCTION_BLOCK F VAR f : F; END_VAR END_FUNCTION_BLOCK PROGRAM A VAR x : F; END_VAR END_PROGRAM', 'RECURSIVE_TYPE'],
    ['FUNCTION_BLOCK F END_FUNCTION_BLOCK PROGRAM A VAR x : INT; END_VAR x := F(); END_PROGRAM', 'UNKNOWN_FUNCTION'],
    ['FUNCTION F : INT VAR_INPUT a : INT; END_VAR F := a; END_FUNCTION PROGRAM A VAR x : INT; END_VAR x := F(b := 1); END_PROGRAM', 'BAD_ARG'],
    ['FUNCTION F : INT VAR_INPUT a : INT; END_VAR F := a; END_FUNCTION PROGRAM A VAR x : INT; END_VAR x := F(TRUE); END_PROGRAM', 'ASSIGN_MISMATCH'],
    ['FUNCTION_BLOCK F VAR_IN_OUT n : INT; END_VAR END_FUNCTION_BLOCK PROGRAM A VAR f : F; END_VAR f(n := 5); END_PROGRAM', 'NOT_LVALUE'],
  ];
  it.each(cases)('%s → %s', (src, code) => {
    const e = loadErr(src);
    expect(e.code).toBe(code);
    expect(e.kind === 'semantic' || e.kind === 'syntax').toBe(true);
  });

  it('constants are read-only', () => {
    expect(loadErr('PROGRAM A VAR CONSTANT k : INT := 1; END_VAR k := 2; END_PROGRAM').code).toBe('READ_ONLY');
  });

  it('localizes messages in English', async () => {
    const { formatMessage } = await import('../src');
    expect(formatMessage('UNKNOWN_VAR', { name: 'x' }, 'en')).toBe('Undeclared variable "x"');
    expect(formatMessage('NOPE')).toBe('NOPE');
    expect(formatMessage('UNKNOWN_VAR', {})).toContain('{name}');
  });
});
