// SPDX-License-Identifier: AGPL-3.0-only
/** Resolved (semantic) types and value helpers. */

export type ElementaryName =
  | 'BOOL' | 'SINT' | 'INT' | 'DINT' | 'LINT' | 'USINT' | 'UINT' | 'UDINT' | 'ULINT'
  | 'BYTE' | 'WORD' | 'DWORD' | 'LWORD' | 'REAL' | 'LREAL' | 'TIME' | 'STRING';

export type PlcType =
  | { kind: 'elem'; name: ElementaryName }
  | { kind: 'array'; elem: PlcType; lo: number; hi: number }
  | { kind: 'fb'; name: string }
  /** Untyped integer literal: adapts to the other operand. */
  | { kind: 'anyint' }
  /** Untyped real literal. */
  | { kind: 'anyreal' };

export type Value = boolean | number | string | Value[] | FbInstanceRef;

/** Opaque marker for FB instances stored in variable slots. */
export interface FbInstanceRef {
  readonly __fb: true;
}

export const T = {
  BOOL: { kind: 'elem', name: 'BOOL' } as PlcType,
  INT: { kind: 'elem', name: 'INT' } as PlcType,
  DINT: { kind: 'elem', name: 'DINT' } as PlcType,
  UINT: { kind: 'elem', name: 'UINT' } as PlcType,
  REAL: { kind: 'elem', name: 'REAL' } as PlcType,
  LREAL: { kind: 'elem', name: 'LREAL' } as PlcType,
  TIME: { kind: 'elem', name: 'TIME' } as PlcType,
  STRING: { kind: 'elem', name: 'STRING' } as PlcType,
  WORD: { kind: 'elem', name: 'WORD' } as PlcType,
  BYTE: { kind: 'elem', name: 'BYTE' } as PlcType,
  DWORD: { kind: 'elem', name: 'DWORD' } as PlcType,
  ANYINT: { kind: 'anyint' } as PlcType,
  ANYREAL: { kind: 'anyreal' } as PlcType,
};

export const INT_RANGES: Record<string, [number, number, number]> = {
  // [min, max, bits]
  SINT: [-128, 127, 8],
  INT: [-32768, 32767, 16],
  DINT: [-2147483648, 2147483647, 32],
  LINT: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 64],
  USINT: [0, 255, 8],
  UINT: [0, 65535, 16],
  UDINT: [0, 4294967295, 32],
  ULINT: [0, Number.MAX_SAFE_INTEGER, 64],
  BYTE: [0, 255, 8],
  WORD: [0, 65535, 16],
  DWORD: [0, 4294967295, 32],
  LWORD: [0, Number.MAX_SAFE_INTEGER, 64],
};

const ELEMENTARY = new Set<string>([
  'BOOL', 'SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT',
  'BYTE', 'WORD', 'DWORD', 'LWORD', 'REAL', 'LREAL', 'TIME', 'STRING',
]);

export function isElementaryName(n: string): n is ElementaryName {
  return ELEMENTARY.has(n);
}

export const isBool = (t: PlcType) => t.kind === 'elem' && t.name === 'BOOL';
export const isTime = (t: PlcType) => t.kind === 'elem' && t.name === 'TIME';
export const isString = (t: PlcType) => t.kind === 'elem' && t.name === 'STRING';
export const isReal = (t: PlcType) =>
  t.kind === 'anyreal' || (t.kind === 'elem' && (t.name === 'REAL' || t.name === 'LREAL'));
export const isInt = (t: PlcType) =>
  t.kind === 'anyint' || (t.kind === 'elem' && t.name in INT_RANGES);
export const isBitString = (t: PlcType) =>
  t.kind === 'elem' && ['BYTE', 'WORD', 'DWORD', 'LWORD'].includes(t.name);
export const isNumeric = (t: PlcType) => isInt(t) || isReal(t);

export function typeName(t: PlcType): string {
  switch (t.kind) {
    case 'elem':
      return t.name;
    case 'array':
      return `ARRAY[${t.lo}..${t.hi}] OF ${typeName(t.elem)}`;
    case 'fb':
      return t.name;
    case 'anyint':
      return 'ANY_INT';
    case 'anyreal':
      return 'ANY_REAL';
  }
}

export function sameType(a: PlcType, b: PlcType): boolean {
  return typeName(a) === typeName(b);
}

/** Bit width rank, to pick the wider integer type of two. */
function intRank(t: PlcType): number {
  if (t.kind !== 'elem') return 0;
  return INT_RANGES[t.name]?.[2] ?? 0;
}

/**
 * Result type of numeric promotion (lenient vs IEC: allows implicit widening
 * and int→real, which is what most field engineers expect).
 */
export function promote(a: PlcType, b: PlcType): PlcType | undefined {
  if (!isNumeric(a) || !isNumeric(b)) return undefined;
  if (isReal(a) || isReal(b)) {
    if ((a.kind === 'elem' && a.name === 'LREAL') || (b.kind === 'elem' && b.name === 'LREAL')) return T.LREAL;
    if (a.kind === 'elem' && isReal(a)) return a;
    if (b.kind === 'elem' && isReal(b)) return b;
    return T.ANYREAL;
  }
  if (a.kind === 'anyint') return b;
  if (b.kind === 'anyint') return a;
  return intRank(a) >= intRank(b) ? a : b;
}

/** Can a value of type `from` be stored into `to` without an explicit conversion? */
export function assignable(from: PlcType, to: PlcType): boolean {
  if (to.kind === 'fb' || from.kind === 'fb') return false;
  if (to.kind === 'array' || from.kind === 'array') {
    return to.kind === 'array' && from.kind === 'array' && sameType(to, from);
  }
  if (sameType(from, to)) return true;
  if (from.kind === 'anyint') return isInt(to) || isReal(to) || isBitString(to);
  if (from.kind === 'anyreal') return isReal(to);
  if (isInt(from) && isInt(to)) return intRank(from) <= intRank(to);
  if (isInt(from) && isReal(to)) return true;
  if (isReal(from) && isReal(to)) return true;
  return false;
}

/** Normalize a numeric value to the storage semantics of `t` (wrap ints, like a real PLC). */
export function coerce(v: Value, t: PlcType): Value {
  if (t.kind !== 'elem') return v;
  if (t.name === 'BOOL') return Boolean(v);
  if (t.name === 'STRING') return String(v);
  if (t.name === 'REAL') return Math.fround(Number(v));
  if (t.name === 'LREAL' || t.name === 'TIME') return Number(v);
  const r = INT_RANGES[t.name];
  if (!r) return v;
  let n = typeof v === 'boolean' ? (v ? 1 : 0) : Math.trunc(Number(v));
  const [min, max, bits] = r;
  if (bits <= 32) {
    const span = 2 ** bits;
    n = ((((n - min) % span) + span) % span) + min;
  } else {
    n = Math.max(min, Math.min(max, n));
  }
  return n;
}

export function defaultValue(t: PlcType): Value {
  switch (t.kind) {
    case 'elem':
      return t.name === 'BOOL' ? false : t.name === 'STRING' ? '' : 0;
    case 'anyint':
    case 'anyreal':
      return 0;
    case 'array':
      return Array.from({ length: t.hi - t.lo + 1 }, () => defaultValue(t.elem));
    case 'fb':
      throw new Error('FB default value must be created by the interpreter');
  }
}

/** Type of a direct address, by its size letter. */
export function addressType(address: string): PlcType {
  const size = address[2];
  switch (size) {
    case 'X':
      return T.BOOL;
    case 'B':
      return T.BYTE;
    case 'W':
      return T.WORD;
    case 'D':
      return T.DWORD;
    default:
      return { kind: 'elem', name: 'LWORD' };
  }
}
