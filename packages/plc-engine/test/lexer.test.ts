import { describe, expect, it } from 'vitest';
import { PlcError, normalizeAddress, parseTimeBody, tokenize } from '../src';

const kinds = (s: string) => tokenize(s).map((t) => t.kind);

describe('lexer', () => {
  it('tokenizes identifiers, keywords case-insensitively', () => {
    const t = tokenize('if Motor then END_IF');
    expect(t.map((x) => [x.kind, x.value])).toEqual([
      ['keyword', 'IF'], ['ident', 'MOTOR'], ['keyword', 'THEN'], ['keyword', 'END_IF'], ['eof', '<EOF>'],
    ]);
    expect(t[1]!.text).toBe('Motor');
  });

  it('skips all comment styles and tracks positions', () => {
    const t = tokenize('(* a\n b *) x // c\n/* d */ y');
    expect(t.filter((x) => x.kind === 'ident').map((x) => [x.value, x.pos.line])).toEqual([['X', 2], ['Y', 3]]);
  });

  it('parses numbers: int, real, exponent, based, underscores', () => {
    const t = tokenize('42 3.14 1e3 16#FF 2#1010 8#17 1_000');
    expect(t.slice(0, 7).map((x) => x.num)).toEqual([42, 3.14, 1000, 255, 10, 15, 1000]);
    expect(t[1]!.kind).toBe('real');
    expect(t[3]!.kind).toBe('int');
  });

  it('does not eat ranges as decimals', () => {
    expect(kinds('1..5')).toEqual(['int', 'op', 'int', 'eof']);
  });

  it('parses time literals', () => {
    expect(tokenize('T#1s500ms')[0]!.num).toBe(1500);
    expect(tokenize('TIME#1h2m')[0]!.num).toBe(3_720_000);
    expect(tokenize('t#2.5s')[0]!.num).toBe(2500);
    expect(tokenize('T#1d')[0]!.num).toBe(86_400_000);
    expect(tokenize('T#-5s')[0]!.num).toBe(-5000);
    expect(tokenize('T#1_000ms')[0]!.num).toBe(1000);
    expect(parseTimeBody('100us')).toBeCloseTo(0.1);
    expect(parseTimeBody('')).toBeUndefined();
    expect(() => tokenize('T#5x')).toThrow(PlcError);
  });

  it('parses strings with $ escapes', () => {
    expect(tokenize("'a$Nb$$c'")[0]!.value).toBe('a\nb$c');
    expect(tokenize('"dq"')[0]!.value).toBe('dq');
    expect(() => tokenize("'open")).toThrow(/Chaîne/);
  });

  it('parses direct addresses and normalizes', () => {
    expect(tokenize('%ix0.1')[0]!.value).toBe('%IX0.1');
    expect(tokenize('%QW4')[0]!.value).toBe('%QW4');
    expect(normalizeAddress('%I0.0')).toBe('%IX0.0');
    expect(() => normalizeAddress('%Z1')).toThrow();
    expect(() => tokenize('%Z1')).toThrow(/Adresse/);
  });

  it('parses typed literal prefixes', () => {
    const t = tokenize('INT#5');
    expect(t[0]!.kind).toBe('typed');
    expect(t[1]!.num).toBe(5);
  });

  it('parses multi-char operators greedily', () => {
    expect(tokenize(':= => <> <= >= ** ..').slice(0, 7).map((x) => x.value)).toEqual([':=', '=>', '<>', '<=', '>=', '**', '..']);
  });

  it('reports unexpected characters and unterminated comments with position', () => {
    try {
      tokenize('x\n  @');
      expect.unreachable();
    } catch (e) {
      expect((e as PlcError).pos).toEqual({ line: 2, col: 3 });
      expect((e as PlcError).localized('en')).toContain('Unexpected character');
    }
    expect(() => tokenize('(* never')).toThrow(/Commentaire/);
  });
});
