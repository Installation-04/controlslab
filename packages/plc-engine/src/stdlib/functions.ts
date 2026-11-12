// SPDX-License-Identifier: AGPL-3.0-only
/** Standard functions (numeric, selection, bit shift, string, type conversion). */
import { PlcError, type SourcePos } from '../errors';
import {
  INT_RANGES, T, coerce, isBitString, isBool, isElementaryName, isInt, isNumeric, isReal, isString,
  promote, typeName, type PlcType, type Value,
} from '../types';

export interface StdFunction {
  /** Validate argument types; return the result type. */
  check(args: PlcType[], pos: SourcePos): PlcType;
  impl(args: Value[], result: PlcType): Value;
}

function arity(name: string, args: PlcType[], n: number, pos: SourcePos) {
  if (args.length !== n) throw new PlcError('semantic', 'BAD_ARG_COUNT', { name, expected: n, got: args.length }, pos);
}

function needNumeric(t: PlcType, pos: SourcePos, op: string) {
  if (!isNumeric(t)) throw new PlcError('semantic', 'BAD_OPERAND', { op, type: typeName(t) }, pos);
}

const concrete = (t: PlcType): PlcType => (t.kind === 'anyint' ? T.INT : t.kind === 'anyreal' ? T.REAL : t);

function realFn(name: string, f: (x: number) => number): [string, StdFunction] {
  return [
    name,
    {
      check(a, pos) {
        arity(name, a, 1, pos);
        needNumeric(a[0]!, pos, name);
        return isReal(a[0]!) && a[0]!.kind === 'elem' ? a[0]! : T.REAL;
      },
      impl: (a, r) => coerce(f(Number(a[0])), r),
    },
  ];
}

/** MIN/MAX/LIMIT/SEL/MUX accept any comparable type of matching kinds. */
function commonType(name: string, ts: PlcType[], pos: SourcePos): PlcType {
  let acc = ts[0]!;
  for (const t of ts.slice(1)) {
    if (isNumeric(acc) && isNumeric(t)) acc = promote(acc, t)!;
    else if (typeName(acc) !== typeName(t)) {
      throw new PlcError('semantic', 'TYPE_MISMATCH', { left: typeName(acc), right: typeName(t) }, pos);
    }
  }
  if (acc.kind === 'fb' || acc.kind === 'array') throw new PlcError('semantic', 'BAD_OPERAND', { op: name, type: typeName(acc) }, pos);
  return concrete(acc);
}

const lt = (a: Value, b: Value) => (a as number) < (b as number);

function shiftFn(name: string, f: (v: number, n: number, bits: number) => number): [string, StdFunction] {
  return [
    name,
    {
      check(a, pos) {
        arity(name, a, 2, pos);
        if (!(isBitString(a[0]!) || isInt(a[0]!))) throw new PlcError('semantic', 'BAD_OPERAND', { op: name, type: typeName(a[0]!) }, pos);
        if (!isInt(a[1]!)) throw new PlcError('semantic', 'EXPECTED_INT', { type: typeName(a[1]!) }, pos);
        return concrete(a[0]!);
      },
      impl(a, r) {
        const bits = r.kind === 'elem' ? (INT_RANGES[r.name]?.[2] ?? 16) : 16;
        const mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;
        const v = (Number(a[0]) & mask) >>> 0;
        const n = Number(a[1]) % bits;
        return coerce(f(v, n, bits) & mask, r);
      },
    },
  ];
}

export const FUNCTIONS = new Map<string, StdFunction>([
  ['ABS', {
    check(a, pos) { arity('ABS', a, 1, pos); needNumeric(a[0]!, pos, 'ABS'); return concrete(a[0]!); },
    impl: (a, r) => coerce(Math.abs(Number(a[0])), r),
  }],
  realFn('SQRT', Math.sqrt), realFn('LN', Math.log), realFn('LOG', Math.log10), realFn('EXP', Math.exp),
  realFn('SIN', Math.sin), realFn('COS', Math.cos), realFn('TAN', Math.tan),
  realFn('ASIN', Math.asin), realFn('ACOS', Math.acos), realFn('ATAN', Math.atan),
  ['TRUNC', {
    check(a, pos) { arity('TRUNC', a, 1, pos); needNumeric(a[0]!, pos, 'TRUNC'); return T.DINT; },
    impl: (a) => Math.trunc(Number(a[0])),
  }],
  ['MIN', {
    check(a, pos) { if (a.length < 2) arity('MIN', a, 2, pos); return commonType('MIN', a, pos); },
    impl: (a, r) => coerce(a.reduce((m, x) => (lt(x, m) ? x : m)), r),
  }],
  ['MAX', {
    check(a, pos) { if (a.length < 2) arity('MAX', a, 2, pos); return commonType('MAX', a, pos); },
    impl: (a, r) => coerce(a.reduce((m, x) => (lt(m, x) ? x : m)), r),
  }],
  ['LIMIT', {
    check(a, pos) { arity('LIMIT', a, 3, pos); return commonType('LIMIT', a, pos); },
    impl: (a, r) => {
      const [mn, v, mx] = a as number[];
      return coerce(Math.min(Math.max(v!, mn!), mx!), r);
    },
  }],
  ['SEL', {
    check(a, pos) {
      arity('SEL', a, 3, pos);
      if (!isBool(a[0]!)) throw new PlcError('semantic', 'EXPECTED_BOOL', { type: typeName(a[0]!) }, pos);
      return commonType('SEL', a.slice(1), pos);
    },
    impl: (a, r) => coerce(a[0] ? a[2]! : a[1]!, r),
  }],
  ['MUX', {
    check(a, pos) {
      if (a.length < 3) arity('MUX', a, 3, pos);
      if (!isInt(a[0]!)) throw new PlcError('semantic', 'EXPECTED_INT', { type: typeName(a[0]!) }, pos);
      return commonType('MUX', a.slice(1), pos);
    },
    impl: (a, r) => {
      const k = Math.max(0, Math.min(a.length - 2, Number(a[0])));
      return coerce(a[k + 1]!, r);
    },
  }],
  ['MOVE', {
    check(a, pos) { arity('MOVE', a, 1, pos); return concrete(a[0]!); },
    impl: (a) => a[0]!,
  }],
  shiftFn('SHL', (v, n) => v << n),
  shiftFn('SHR', (v, n) => v >>> n),
  shiftFn('ROL', (v, n, b) => (v << n) | (v >>> (b - n))),
  shiftFn('ROR', (v, n, b) => (v >>> n) | (v << (b - n))),
  ['LEN', {
    check(a, pos) { arity('LEN', a, 1, pos); if (!isString(a[0]!)) throw new PlcError('semantic', 'BAD_OPERAND', { op: 'LEN', type: typeName(a[0]!) }, pos); return T.INT; },
    impl: (a) => String(a[0]).length,
  }],
  ['CONCAT', {
    check(a, pos) {
      if (a.length < 2) arity('CONCAT', a, 2, pos);
      for (const t of a) if (!isString(t)) throw new PlcError('semantic', 'BAD_OPERAND', { op: 'CONCAT', type: typeName(t) }, pos);
      return T.STRING;
    },
    impl: (a) => a.map(String).join(''),
  }],
  ['LEFT', {
    check(a, pos) { arity('LEFT', a, 2, pos); return T.STRING; },
    impl: (a) => String(a[0]).slice(0, Math.max(0, Number(a[1]))),
  }],
  ['RIGHT', {
    check(a, pos) { arity('RIGHT', a, 2, pos); return T.STRING; },
    impl: (a) => { const s = String(a[0]); const n = Math.max(0, Number(a[1])); return n === 0 ? '' : s.slice(-n); },
  }],
]);

/** Resolve X_TO_Y conversion functions (e.g. INT_TO_REAL, REAL_TO_INT, TIME_TO_DINT, BOOL_TO_INT). */
export function lookupConversion(name: string): StdFunction | undefined {
  const m = /^([A-Z]+)_TO_([A-Z]+)$/.exec(name);
  if (!m) return undefined;
  const [, fromName, toName] = m as unknown as [string, string, string];
  if (!isElementaryName(fromName) || !isElementaryName(toName)) return undefined;
  const to: PlcType = { kind: 'elem', name: toName };
  return {
    check(a, pos) {
      arity(name, a, 1, pos);
      const src = a[0]!;
      const ok =
        typeName(src) === fromName ||
        (src.kind === 'anyint' && (fromName in INT_RANGES)) ||
        (src.kind === 'anyreal' && (fromName === 'REAL' || fromName === 'LREAL')) ||
        (fromName === 'REAL' && src.kind === 'anyint');
      if (!ok) throw new PlcError('semantic', 'TYPE_MISMATCH', { left: fromName, right: typeName(src) }, pos);
      return to;
    },
    impl(a) {
      const v = a[0]!;
      if (toName === 'STRING') return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
      if (toName === 'BOOL') return typeof v === 'string' ? v.toUpperCase() === 'TRUE' : Number(v) !== 0;
      const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
      // REAL→INT rounds (IEC: round half to even is implementation-dependent; we round half away from zero).
      const fromReal = fromName === 'REAL' || fromName === 'LREAL';
      const intTarget = toName in INT_RANGES;
      const val = fromReal && intTarget ? Math.sign(n) * Math.round(Math.abs(n)) : n;
      return coerce(val, to);
    },
  };
}

