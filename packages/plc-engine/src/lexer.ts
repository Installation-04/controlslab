// SPDX-License-Identifier: AGPL-3.0-only
import { PlcError, type SourcePos } from './errors';

export type TokenKind =
  | 'ident'
  | 'keyword'
  | 'int'
  | 'real'
  | 'time'
  | 'string'
  | 'address'
  | 'typed' // TYPE# prefix, e.g. INT#  (value follows as separate token)
  | 'op'
  | 'eof';

export interface Token {
  kind: TokenKind;
  /** Upper-cased for keywords/identifiers lookup; original text in `text`. */
  value: string;
  text: string;
  num?: number;
  pos: SourcePos;
}

export const KEYWORDS = new Set([
  'PROGRAM', 'END_PROGRAM', 'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK', 'FUNCTION', 'END_FUNCTION',
  'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_GLOBAL', 'VAR_TEMP', 'VAR_EXTERNAL', 'END_VAR',
  'CONSTANT', 'RETAIN', 'NON_RETAIN', 'AT',
  'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF', 'CASE', 'OF', 'END_CASE',
  'FOR', 'TO', 'BY', 'DO', 'END_FOR', 'WHILE', 'END_WHILE', 'REPEAT', 'UNTIL', 'END_REPEAT',
  'EXIT', 'RETURN', 'TRUE', 'FALSE', 'AND', 'OR', 'XOR', 'NOT', 'MOD', 'ARRAY',
]);

const TYPE_PREFIXES = new Set([
  'BOOL', 'SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT',
  'BYTE', 'WORD', 'DWORD', 'LWORD', 'REAL', 'LREAL',
]);

const OPS = [':=', '=>', '<>', '<=', '>=', '**', '..', '(', ')', '[', ']', ',', ';', ':', '+', '-', '*', '/', '<', '>', '=', '&', '.', '#'];

const TIME_UNITS: Record<string, number> = { D: 86_400_000, H: 3_600_000, M: 60_000, S: 1000, MS: 1, US: 0.001, NS: 0.000001 };

/** Parse the body of a TIME literal (after T# / TIME#), e.g. "1h2m3s500ms", "-2.5s". Returns ms. */
export function parseTimeBody(body: string): number | undefined {
  let s = body.replace(/_/g, '').toUpperCase();
  let sign = 1;
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1);
  }
  if (!s) return undefined;
  const re = /(\d+(?:\.\d+)?)(MS|US|NS|D|H|M|S)/gy;
  let total = 0;
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    total += Number(m[1]) * (TIME_UNITS[m[2]!] ?? 0);
    consumed = re.lastIndex;
  }
  if (consumed !== s.length) return undefined;
  return sign * total;
}

function parseNumberText(text: string, pos: SourcePos): { kind: 'int' | 'real'; num: number } {
  const clean = text.replace(/_/g, '');
  const based = /^(2|8|16)#([0-9A-Fa-f]+)$/.exec(clean);
  if (based) {
    const n = parseInt(based[2]!, Number(based[1]));
    if (Number.isNaN(n)) throw new PlcError('syntax', 'BAD_NUMBER', { text }, pos);
    return { kind: 'int', num: n };
  }
  if (/^\d+$/.test(clean)) return { kind: 'int', num: Number(clean) };
  if (/^\d+\.\d+([eE][+-]?\d+)?$/.test(clean) || /^\d+[eE][+-]?\d+$/.test(clean)) {
    return { kind: 'real', num: Number(clean) };
  }
  throw new PlcError('syntax', 'BAD_NUMBER', { text }, pos);
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = (n: number) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') {
        line++;
        col = 1;
      } else col++;
      i++;
    }
  };

  while (i < src.length) {
    const ch = src[i]!;
    const pos = { line, col };

    if (/\s/.test(ch)) {
      advance(1);
      continue;
    }
    // Comments: (* *), /* */, //
    if (src.startsWith('(*', i) || src.startsWith('/*', i)) {
      const close = src.startsWith('(*', i) ? '*)' : '*/';
      const end = src.indexOf(close, i + 2);
      if (end < 0) throw new PlcError('syntax', 'UNTERMINATED_COMMENT', {}, pos);
      advance(end + 2 - i);
      continue;
    }
    if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') advance(1);
      continue;
    }
    // Strings
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let out = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '$' && j + 1 < src.length) {
          const e = src[j + 1]!.toUpperCase();
          out += e === 'N' || e === 'L' ? '\n' : e === 'T' ? '\t' : e === 'R' ? '\r' : src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === '\n') break;
        out += src[j];
        j++;
      }
      if (src[j] !== ch) throw new PlcError('syntax', 'UNTERMINATED_STRING', {}, pos);
      const text = src.slice(i, j + 1);
      tokens.push({ kind: 'string', value: out, text, pos });
      advance(j + 1 - i);
      continue;
    }
    // Direct addresses %IX0.0, %QW2, %MD10
    if (ch === '%') {
      const m = /^%([IQM])([XBWDL]?)(\d+(?:\.\d+)*)/i.exec(src.slice(i));
      if (!m) throw new PlcError('syntax', 'BAD_ADDRESS', { text: src.slice(i, i + 6) }, pos);
      const text = m[0];
      tokens.push({ kind: 'address', value: normalizeAddress(text), text, pos });
      advance(text.length);
      continue;
    }
    // Numbers (incl. based 16#FF)
    if (/\d/.test(ch)) {
      const m = /^(?:(?:2|8|16)#[0-9A-Fa-f_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/.exec(src.slice(i))!;
      let text = m[0];
      // Avoid swallowing range ".." as decimal: "1..5"
      if (text.includes('.') && src.startsWith('..', i + text.indexOf('.'))) {
        text = text.slice(0, text.indexOf('.'));
      }
      const { kind, num } = parseNumberText(text, pos);
      tokens.push({ kind, value: text, text, num, pos });
      advance(text.length);
      continue;
    }
    // Identifiers / keywords / typed literals
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      const text = m[0];
      const up = text.toUpperCase();
      if (src[i + text.length] === '#') {
        if (up === 'T' || up === 'TIME') {
          const body = /^-?[0-9A-Za-z_.]+/.exec(src.slice(i + text.length + 1));
          const ms = body ? parseTimeBody(body[0]) : undefined;
          const full = src.slice(i, i + text.length + 1 + (body?.[0].length ?? 0));
          if (ms === undefined) throw new PlcError('syntax', 'BAD_TIME', { text: full }, pos);
          tokens.push({ kind: 'time', value: full, text: full, num: ms, pos });
          advance(full.length);
          continue;
        }
        if (TYPE_PREFIXES.has(up)) {
          tokens.push({ kind: 'typed', value: up, text: text + '#', pos });
          advance(text.length + 1);
          continue;
        }
      }
      tokens.push({ kind: KEYWORDS.has(up) ? 'keyword' : 'ident', value: up, text, pos });
      advance(text.length);
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ kind: 'op', value: op, text: op, pos });
      advance(op.length);
      continue;
    }
    throw new PlcError('syntax', 'UNEXPECTED_CHAR', { ch }, pos);
  }
  tokens.push({ kind: 'eof', value: '<EOF>', text: '<EOF>', pos: { line, col } });
  return tokens;
}

/** Canonical address form: %IX0.0 (upper-case, bit size letter explicit). */
export function normalizeAddress(text: string): string {
  const m = /^%([IQM])([XBWDL]?)(\d+(?:\.\d+)*)$/i.exec(text.trim());
  if (!m) throw new PlcError('syntax', 'BAD_ADDRESS', { text });
  const area = m[1]!.toUpperCase();
  let size = m[2]!.toUpperCase();
  const idx = m[3]!;
  if (!size) size = idx.includes('.') ? 'X' : 'X';
  return `%${area}${size}${idx}`;
}
