// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Semantic analysis + code generation. The AST is type-checked and turned
 * into a tree of JS closures (fast, no `eval`). Each closure receives the
 * current frame (the variable record of the running PROGRAM / FB / FUNCTION).
 */
import type { CallArg, CompilationUnit, Expr, Pou, Stmt, TypeSpec, VarDecl } from './ast';
import { PlcError, type SourcePos } from './errors';
import { normalizeAddress } from './lexer';
import { FUNCTIONS, NATIVE_FBS, lookupConversion, type FbInstance, type FbParam, type RtContext } from './stdlib';
import {
  T, addressType, assignable, coerce, defaultValue, isBitString, isBool, isElementaryName, isInt, isNumeric,
  isReal, isString, isTime, promote, typeName, type PlcType, type Value,
} from './types';

export type Frame = Record<string, Value>;
type Ev = (f: Frame) => Value;
type Exec = (f: Frame) => Signal;
const enum Signal {
  Normal = 0,
  Exit = 1,
  Return = 2,
}

interface CExpr {
  type: PlcType;
  ev: Ev;
  set?: (f: Frame, v: Value) => void;
  readOnly?: string;
}

interface VarInfo {
  decl: VarDecl;
  type: PlcType;
  global: boolean;
}

interface PouInfo {
  pou: Pou;
  vars: Map<string, VarInfo>;
  params: FbParam[];
  body?: Exec;
}

export interface IoPoint {
  address: string;
  name: string;
  program: string;
  area: 'I' | 'Q' | 'M';
  type: string;
}

export interface SymbolInfo {
  path: string;
  type: string;
}

export interface CompiledProgram {
  rt: RtContext;
  io: Record<string, Value>;
  globals: Frame;
  programs: Array<{ name: string; display: string; frame: Frame }>;
  ioPoints: IoPoint[];
  /** Run one scan of all PROGRAMs (declaration order). */
  run(): void;
  /** Cold restart: re-create all instances with their initial values. */
  reset(): void;
  symbols(): SymbolInfo[];
  read(path: string): Value | undefined;
}

export interface CompileOptions {
  /** Max statement executions per scan before the watchdog trips. */
  watchdogOps?: number;
}

const MAX_CALL_DEPTH = 64;

class UserFb implements FbInstance {
  readonly __fb = true as const;
  constructor(
    readonly typeName: string,
    public vars: Frame,
    private readonly info: PouInfo,
  ) {}
  execute(): void {
    this.info.body!(this.vars);
  }
}

const isFbValue = (v: Value): v is FbInstance & Value =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && '__fb' in v;

function cloneValue(v: Value): Value {
  return Array.isArray(v) ? v.map(cloneValue) : v;
}

export function compile(unit: CompilationUnit, opts: CompileOptions = {}): CompiledProgram {
  return new Compiler(unit, opts).build();
}

class Compiler {
  private readonly pous = new Map<string, PouInfo>();
  private readonly globalVars = new Map<string, VarInfo>();
  private readonly rt: RtContext = { now: 0 };
  private readonly io: Record<string, Value> = {};
  private readonly globals: Frame = {};
  private readonly watchdogOps: number;
  private ops = 0;
  private callDepth = 0;
  private instantiating: string[] = [];

  // Compile-time scope
  private scope: { info: PouInfo | null; loopDepth: number } = { info: null, loopDepth: 0 };

  constructor(
    private readonly unit: CompilationUnit,
    opts: CompileOptions,
  ) {
    this.watchdogOps = opts.watchdogOps ?? 200_000;
  }

  build(): CompiledProgram {
    const { unit } = this;
    // 1. Register POU names (so FB types can be referenced before definition).
    for (const pou of unit.pous) {
      if (this.pous.has(pou.name) || NATIVE_FBS.has(pou.name) || FUNCTIONS.has(pou.name)) {
        throw new PlcError('semantic', 'DUPLICATE_POU', { name: pou.displayName }, pou.pos);
      }
      this.pous.set(pou.name, { pou, vars: new Map(), params: [] });
    }
    if (!unit.pous.some((p) => p.kind === 'PROGRAM')) throw new PlcError('semantic', 'NO_PROGRAM', {});
    // 2. Globals
    for (const d of unit.globals) {
      if (this.globalVars.has(d.name)) throw new PlcError('semantic', 'DUPLICATE_VAR', { name: d.displayName }, d.pos);
      this.globalVars.set(d.name, { decl: d, type: this.resolveType(d.type), global: true });
    }
    // 3. Variable tables & params
    for (const info of this.pous.values()) {
      const { pou } = info;
      if (pou.kind === 'FUNCTION') {
        const rt = this.resolveType(pou.returnType!);
        info.vars.set(pou.name, {
          decl: { name: pou.name, displayName: pou.displayName, section: 'VAR_OUTPUT', constant: false, retain: false, type: pou.returnType!, pos: pou.pos },
          type: rt,
          global: false,
        });
      }
      for (const d of pou.vars) {
        if (info.vars.has(d.name)) throw new PlcError('semantic', 'DUPLICATE_VAR', { name: d.displayName }, d.pos);
        if (d.section === 'VAR_EXTERNAL') {
          if (!this.globalVars.has(d.name)) throw new PlcError('semantic', 'UNKNOWN_VAR', { name: d.displayName }, d.pos);
          continue;
        }
        const type = this.resolveType(d.type);
        info.vars.set(d.name, { decl: d, type, global: false });
        const dir =
          d.section === 'VAR_INPUT' ? 'in' : d.section === 'VAR_OUTPUT' ? 'out' : d.section === 'VAR_IN_OUT' ? 'inout' : 'local';
        info.params.push({ name: d.name, type, dir });
      }
    }
    // 4. Initial-value expressions (compiled in their POU scope) + bodies
    const inits = new Map<VarDecl, Ev>();
    this.scope = { info: null, loopDepth: 0 };
    for (const v of this.globalVars.values()) if (v.decl.init) inits.set(v.decl, this.compileInit(v));
    for (const info of this.pous.values()) {
      this.scope = { info, loopDepth: 0 };
      for (const v of info.vars.values()) if (v.decl.init) inits.set(v.decl, this.compileInit(v));
      info.body = this.compileBlock(info.pou.body);
    }
    this.inits = inits;

    const programs = [...this.pous.values()].filter((p) => p.pou.kind === 'PROGRAM');
    const ioPoints: IoPoint[] = [];
    const addPoints = (vars: Iterable<VarInfo>, program: string) => {
      for (const v of vars) {
        if (v.decl.address) {
          ioPoints.push({
            address: v.decl.address,
            name: v.decl.displayName,
            program,
            area: v.decl.address[1] as IoPoint['area'],
            type: typeName(v.type),
          });
        }
      }
    };
    addPoints(this.globalVars.values(), '');
    for (const p of programs) addPoints(p.vars.values(), p.pou.displayName);

    const result: CompiledProgram = {
      rt: this.rt,
      io: this.io,
      globals: this.globals,
      programs: [],
      ioPoints,
      run: () => {
        this.ops = 0;
        this.callDepth = 0;
        for (const p of result.programs) programs.find((x) => x.pou.name === p.name)!.body!(p.frame);
      },
      reset: () => {
        for (const k of Object.keys(this.io)) delete this.io[k];
        for (const k of Object.keys(this.globals)) delete this.globals[k];
        this.rt.now = 0;
        this.initFrame(this.globals, this.globalVars.values());
        result.programs = programs.map((p) => ({ name: p.pou.name, display: p.pou.displayName, frame: this.instantiate(p) }));
      },
      symbols: () => this.symbols(result),
      read: (path) => this.readPath(result, path),
    };
    result.reset();
    return result;
  }

  private inits = new Map<VarDecl, Ev>();

  // ---------- Types ----------
  private resolveType(spec: TypeSpec): PlcType {
    if (spec.kind === 'array') {
      if (spec.hi! < spec.lo!) throw new PlcError('semantic', 'BAD_ARRAY_BOUNDS', {}, spec.pos);
      return { kind: 'array', elem: this.resolveType(spec.elem!), lo: spec.lo!, hi: spec.hi! };
    }
    if (spec.kind === 'string') return T.STRING;
    if (isElementaryName(spec.name)) return { kind: 'elem', name: spec.name };
    if (NATIVE_FBS.has(spec.name)) return { kind: 'fb', name: spec.name };
    const user = this.pous.get(spec.name);
    if (user && user.pou.kind === 'FUNCTION_BLOCK') return { kind: 'fb', name: spec.name };
    throw new PlcError('semantic', 'UNKNOWN_TYPE', { name: spec.name }, spec.pos);
  }

  private fbParams(name: string): FbParam[] {
    return NATIVE_FBS.get(name)?.params ?? this.pous.get(name)!.params;
  }

  // ---------- Instantiation ----------
  private newValue(t: PlcType, pos: SourcePos): Value {
    if (t.kind === 'fb') return this.newFb(t.name, pos) as unknown as Value;
    if (t.kind === 'array') {
      return Array.from({ length: t.hi - t.lo + 1 }, () => this.newValue(t.elem, pos));
    }
    return defaultValue(t);
  }

  private newFb(name: string, pos: SourcePos): FbInstance {
    const native = NATIVE_FBS.get(name);
    if (native) return native.create();
    if (this.instantiating.includes(name)) throw new PlcError('semantic', 'RECURSIVE_TYPE', { name }, pos);
    const info = this.pous.get(name)!;
    this.instantiating.push(name);
    const frame = this.instantiate(info);
    this.instantiating.pop();
    return new UserFb(name, frame, info);
  }

  private instantiate(info: PouInfo): Frame {
    const frame: Frame = {};
    this.initFrame(frame, info.vars.values());
    return frame;
  }

  private initFrame(frame: Frame, vars: Iterable<VarInfo>) {
    for (const v of vars) {
      const init = this.inits.get(v.decl);
      const value = init ? coerce(init(frame), v.type) : this.newValue(v.type, v.decl.pos);
      if (v.decl.address) {
        if (!(v.decl.address in this.io) || init) this.io[v.decl.address] = value;
      } else frame[v.decl.name] = value;
    }
  }

  private compileInit(v: VarInfo): Ev {
    const init = v.decl.init!;
    if (init.kind === 'call' && init.name === '__ARRAY__') {
      if (v.type.kind !== 'array') throw new PlcError('semantic', 'CONSTANT_INIT', { name: v.decl.displayName }, init.pos);
      const elemT = v.type.elem;
      const items = init.args.map((a) => {
        const c = this.expr(a.value);
        if (!assignable(c.type, elemT)) {
          throw new PlcError('semantic', 'ASSIGN_MISMATCH', { from: typeName(c.type), to: typeName(elemT) }, a.pos);
        }
        return c.ev;
      });
      const len = v.type.hi - v.type.lo + 1;
      if (items.length > len) throw new PlcError('semantic', 'CONSTANT_INIT', { name: v.decl.displayName }, init.pos);
      return (f) => Array.from({ length: len }, (_, i) => (i < items.length ? coerce(items[i]!(f), elemT) : defaultValue(elemT)));
    }
    if (v.type.kind === 'fb' || v.type.kind === 'array') {
      throw new PlcError('semantic', 'CONSTANT_INIT', { name: v.decl.displayName }, init.pos);
    }
    const c = this.expr(init);
    if (!assignable(c.type, v.type)) {
      throw new PlcError('semantic', 'ASSIGN_MISMATCH', { from: typeName(c.type), to: typeName(v.type) }, init.pos);
    }
    return c.ev;
  }

  // ---------- Statements ----------
  private tick(pos: SourcePos) {
    if (++this.ops > this.watchdogOps) {
      throw new PlcError('runtime', 'WATCHDOG', { limit: this.watchdogOps }, pos);
    }
  }

  private compileBlock(stmts: Stmt[]): Exec {
    const execs = stmts.filter((s) => s.kind !== 'empty').map((s) => this.stmt(s));
    if (execs.length === 1) return execs[0]!;
    return (f) => {
      for (const e of execs) {
        const s = e(f);
        if (s !== Signal.Normal) return s;
      }
      return Signal.Normal;
    };
  }

  private cond(e: Expr): Ev {
    const c = this.expr(e);
    if (!isBool(c.type)) throw new PlcError('semantic', 'EXPECTED_BOOL', { type: typeName(c.type) }, e.pos);
    return c.ev;
  }

  private stmt(s: Stmt): Exec {
    const pos = s.pos;
    switch (s.kind) {
      case 'empty':
        return () => Signal.Normal;
      case 'assign': {
        const target = this.expr(s.target);
        if (!target.set) throw new PlcError('semantic', 'NOT_ASSIGNABLE', {}, s.target.pos);
        if (target.readOnly) throw new PlcError('semantic', 'READ_ONLY', { name: target.readOnly }, s.target.pos);
        const value = this.expr(s.value);
        if (!assignable(value.type, target.type)) {
          throw new PlcError('semantic', 'ASSIGN_MISMATCH', { from: typeName(value.type), to: typeName(target.type) }, s.value.pos);
        }
        const set = target.set;
        const ev = value.ev;
        const copy = target.type.kind === 'array';
        return (f) => {
          this.tick(pos);
          set(f, copy ? cloneValue(ev(f)) : ev(f));
          return Signal.Normal;
        };
      }
      case 'fbcall':
        return this.fbCall(s.target, s.args, pos);
      case 'if': {
        const branches = s.branches.map((b) => ({ cond: this.cond(b.cond), body: this.compileBlock(b.body) }));
        const elseBody = s.elseBody ? this.compileBlock(s.elseBody) : undefined;
        return (f) => {
          this.tick(pos);
          for (const b of branches) if (b.cond(f)) return b.body(f);
          return elseBody ? elseBody(f) : Signal.Normal;
        };
      }
      case 'case': {
        const sel = this.expr(s.selector);
        if (!isInt(sel.type)) throw new PlcError('semantic', 'EXPECTED_INT', { type: typeName(sel.type) }, s.selector.pos);
        const branches = s.branches.map((b) => ({
          labels: b.labels.map((l) => {
            const from = this.expr(l.from);
            const to = l.to ? this.expr(l.to) : undefined;
            for (const x of [from, to]) {
              if (x && !isInt(x.type)) throw new PlcError('semantic', 'EXPECTED_INT', { type: typeName(x.type) }, l.from.pos);
            }
            return { from: from.ev, to: to?.ev };
          }),
          body: this.compileBlock(b.body),
        }));
        const elseBody = s.elseBody ? this.compileBlock(s.elseBody) : undefined;
        return (f) => {
          this.tick(pos);
          const v = sel.ev(f) as number;
          for (const b of branches) {
            for (const l of b.labels) {
              const lo = l.from(f) as number;
              if (l.to ? v >= lo && v <= (l.to(f) as number) : v === lo) return b.body(f);
            }
          }
          return elseBody ? elseBody(f) : Signal.Normal;
        };
      }
      case 'for': {
        const variable = this.expr({ kind: 'name', name: s.variable, display: s.display, pos });
        if (!isInt(variable.type)) throw new PlcError('semantic', 'EXPECTED_INT', { type: typeName(variable.type) }, pos);
        if (variable.readOnly || !variable.set) throw new PlcError('semantic', 'READ_ONLY', { name: s.display }, pos);
        const from = this.expr(s.from);
        const to = this.expr(s.to);
        const by = s.by ? this.expr(s.by) : undefined;
        for (const x of [from, to, by]) {
          if (x && !isInt(x.type)) throw new PlcError('semantic', 'EXPECTED_INT', { type: typeName(x.type) }, pos);
        }
        this.scope.loopDepth++;
        const body = this.compileBlock(s.body);
        this.scope.loopDepth--;
        const set = variable.set;
        return (f) => {
          this.tick(pos);
          const end = to.ev(f) as number;
          const step = by ? (by.ev(f) as number) : 1;
          let i = from.ev(f) as number;
          set(f, i);
          while (step >= 0 ? i <= end : i >= end) {
            this.tick(pos);
            const sig = body(f);
            if (sig === Signal.Exit) break;
            if (sig === Signal.Return) return sig;
            i = (variable.ev(f) as number) + step;
            set(f, i);
            if (step === 0) continue;
          }
          return Signal.Normal;
        };
      }
      case 'while': {
        const cond = this.cond(s.cond);
        this.scope.loopDepth++;
        const body = this.compileBlock(s.body);
        this.scope.loopDepth--;
        return (f) => {
          this.tick(pos);
          while (cond(f)) {
            this.tick(pos);
            const sig = body(f);
            if (sig === Signal.Exit) break;
            if (sig === Signal.Return) return sig;
          }
          return Signal.Normal;
        };
      }
      case 'repeat': {
        this.scope.loopDepth++;
        const body = this.compileBlock(s.body);
        this.scope.loopDepth--;
        const until = this.cond(s.until);
        return (f) => {
          this.tick(pos);
          do {
            this.tick(pos);
            const sig = body(f);
            if (sig === Signal.Exit) break;
            if (sig === Signal.Return) return sig;
          } while (!until(f));
          return Signal.Normal;
        };
      }
      case 'exit':
        if (this.scope.loopDepth === 0) throw new PlcError('semantic', 'EXIT_OUTSIDE_LOOP', {}, pos);
        return () => Signal.Exit;
      case 'return':
        return () => Signal.Return;
    }
  }

  private fbCall(targetExpr: Expr, args: CallArg[], pos: SourcePos): Exec {
    const target = this.expr(targetExpr);
    if (target.type.kind !== 'fb') {
      const name = targetExpr.kind === 'name' ? targetExpr.display : typeName(target.type);
      throw new PlcError('semantic', 'NOT_CALLABLE', { name }, targetExpr.pos);
    }
    const fbName = target.type.name;
    const params = this.fbParams(fbName);
    const inputs = params.filter((p) => p.dir === 'in' || p.dir === 'inout');
    const before: Array<(f: Frame, inst: FbInstance) => void> = [];
    const after: Array<(f: Frame, inst: FbInstance) => void> = [];
    args.forEach((a, idx) => {
      const p = a.name ? params.find((x) => x.name === a.name) : inputs[idx];
      if (!p || p.dir === 'local') {
        throw new PlcError('semantic', 'BAD_ARG', { name: a.name ?? String(idx + 1), fb: fbName }, a.pos);
      }
      const key = p.name;
      if (a.output) {
        if (p.dir !== 'out') throw new PlcError('semantic', 'OUTPUT_BINDING', { name: key }, a.pos);
        const dest = this.expr(a.value);
        if (!dest.set || dest.readOnly) throw new PlcError('semantic', 'NOT_ASSIGNABLE', {}, a.value.pos);
        if (!assignable(p.type, dest.type)) {
          throw new PlcError('semantic', 'ASSIGN_MISMATCH', { from: typeName(p.type), to: typeName(dest.type) }, a.pos);
        }
        const set = dest.set;
        after.push((f, inst) => set(f, inst.vars[key]!));
        return;
      }
      if (p.dir === 'out') throw new PlcError('semantic', 'OUTPUT_BINDING', { name: key }, a.pos);
      const src = this.expr(a.value);
      if (!assignable(src.type, p.type)) {
        throw new PlcError('semantic', 'ASSIGN_MISMATCH', { from: typeName(src.type), to: typeName(p.type) }, a.pos);
      }
      const ev = src.ev;
      const pt = p.type;
      before.push((f, inst) => {
        inst.vars[key] = coerce(ev(f), pt);
      });
      if (p.dir === 'inout') {
        if (!src.set || src.readOnly) throw new PlcError('semantic', 'NOT_LVALUE', { name: key }, a.pos);
        const set = src.set;
        after.push((f, inst) => set(f, inst.vars[key]!));
      }
    });
    const getInst = target.ev;
    return (f) => {
      this.tick(pos);
      const inst = getInst(f) as unknown as FbInstance;
      for (const b of before) b(f, inst);
      if (++this.callDepth > MAX_CALL_DEPTH) throw new PlcError('runtime', 'RECURSION', { name: fbName }, pos);
      inst.execute(this.rt);
      this.callDepth--;
      for (const a of after) a(f, inst);
      return Signal.Normal;
    };
  }

  // ---------- Expressions ----------
  private lookup(name: string): VarInfo | undefined {
    const local = this.scope.info?.vars.get(name);
    if (local) return local;
    return this.globalVars.get(name);
  }

  private expr(e: Expr): CExpr {
    switch (e.kind) {
      case 'literal': {
        const v = e.value;
        const type: PlcType =
          e.type === 'ANYINT' ? T.ANYINT : e.type === 'ANYREAL' ? T.ANYREAL : { kind: 'elem', name: e.type as 'BOOL' };
        const val = coerce(v, type);
        return { type, ev: () => val };
      }
      case 'name': {
        const v = this.lookup(e.name);
        if (!v) throw new PlcError('semantic', 'UNKNOWN_VAR', { name: e.display }, e.pos);
        const type = v.type;
        const readOnly = v.decl.constant ? v.decl.displayName : undefined;
        if (v.decl.address) {
          const addr = v.decl.address;
          const io = this.io;
          return { type, readOnly, ev: () => io[addr]!, set: (_f, x) => void (io[addr] = coerce(x, type)) };
        }
        const key = v.decl.name;
        if (v.global) {
          const g = this.globals;
          return { type, readOnly, ev: () => g[key]!, set: (_f, x) => void (g[key] = coerce(x, type)) };
        }
        if (type.kind === 'fb') return { type, readOnly: v.decl.displayName, ev: (f) => f[key]! };
        return { type, readOnly, ev: (f) => f[key]!, set: (f, x) => void (f[key] = coerce(x, type)) };
      }
      case 'address': {
        const type = addressType(e.address);
        const addr = e.address;
        const io = this.io;
        return {
          type,
          ev: () => io[addr] ?? defaultValue(type),
          set: (_f, x) => void (io[addr] = coerce(x, type)),
        };
      }
      case 'member':
        return this.member(e);
      case 'index': {
        const obj = this.expr(e.object);
        if (obj.type.kind !== 'array') {
          throw new PlcError('semantic', 'NOT_INDEXABLE', { name: exprName(e.object) }, e.pos);
        }
        const idx = this.expr(e.index);
        if (!isInt(idx.type)) throw new PlcError('semantic', 'EXPECTED_INT', { type: typeName(idx.type) }, e.index.pos);
        const { lo, hi, elem } = obj.type;
        const pos = e.pos;
        const slot = (f: Frame): number => {
          const i = idx.ev(f) as number;
          if (i < lo || i > hi) throw new PlcError('runtime', 'INDEX_OUT_OF_RANGE', { index: i, lo, hi }, pos);
          return i - lo;
        };
        const oev = obj.ev;
        return {
          type: elem,
          readOnly: elem.kind === 'fb' ? 'FB' : obj.readOnly,
          ev: (f) => (oev(f) as Value[])[slot(f)]!,
          set: (f, x) => {
            (oev(f) as Value[])[slot(f)] = coerce(x, elem);
          },
        };
      }
      case 'unary': {
        const o = this.expr(e.operand);
        if (e.op === 'NOT') {
          if (isBool(o.type)) return { type: T.BOOL, ev: (f) => !o.ev(f) };
          if (isBitString(o.type) || (isInt(o.type) && o.type.kind === 'elem')) {
            const t = o.type;
            return { type: t, ev: (f) => coerce(~(o.ev(f) as number), t) };
          }
          throw new PlcError('semantic', 'BAD_OPERAND', { op: 'NOT', type: typeName(o.type) }, e.pos);
        }
        if (!isNumeric(o.type) && !isTime(o.type)) {
          throw new PlcError('semantic', 'BAD_OPERAND', { op: e.op, type: typeName(o.type) }, e.pos);
        }
        const t = o.type;
        return { type: t, ev: (f) => coerce(-(o.ev(f) as number), t) };
      }
      case 'binary':
        return this.binary(e);
      case 'call':
        return this.call(e);
    }
  }

  private member(e: Extract<Expr, { kind: 'member' }>): CExpr {
    const obj = this.expr(e.object);
    // Bit access: x.3
    if (/^\d+$/.test(e.member)) {
      if (!(isBitString(obj.type) || (isInt(obj.type) && obj.type.kind === 'elem'))) {
        throw new PlcError('semantic', 'UNKNOWN_MEMBER', { member: e.member, type: typeName(obj.type) }, e.pos);
      }
      const bit = Number(e.member);
      const ot = obj.type;
      const oev = obj.ev;
      const oset = obj.set;
      return {
        type: T.BOOL,
        readOnly: obj.readOnly,
        ev: (f) => ((Number(oev(f)) >>> bit) & 1) === 1,
        set: oset
          ? (f, x) => {
              const cur = Number(oev(f));
              oset(f, coerce(x ? cur | (1 << bit) : cur & ~(1 << bit), ot));
            }
          : undefined,
      };
    }
    if (obj.type.kind !== 'fb') {
      throw new PlcError('semantic', 'UNKNOWN_MEMBER', { member: e.display, type: typeName(obj.type) }, e.pos);
    }
    const p = this.fbParams(obj.type.name).find((x) => x.name === e.member);
    if (!p || p.dir === 'local') {
      throw new PlcError('semantic', 'UNKNOWN_MEMBER', { member: e.display, type: obj.type.name }, e.pos);
    }
    const key = p.name;
    const type = p.type;
    const oev = obj.ev;
    return {
      type,
      readOnly: p.dir === 'out' ? `${exprName(e.object)}.${e.display}` : undefined,
      ev: (f) => (oev(f) as unknown as FbInstance).vars[key]!,
      set: (f, x) => {
        (oev(f) as unknown as FbInstance).vars[key] = coerce(x, type);
      },
    };
  }

  private binary(e: Extract<Expr, { kind: 'binary' }>): CExpr {
    const l = this.expr(e.left);
    const r = this.expr(e.right);
    const lt = l.type;
    const rt = r.type;
    const le = l.ev;
    const re = r.ev;
    const pos = e.pos;
    const bad = (): never => {
      throw new PlcError('semantic', 'TYPE_MISMATCH', { left: typeName(lt), right: typeName(rt) }, pos);
    };
    const op = e.op;
    switch (op) {
      case 'AND':
      case 'OR':
      case 'XOR': {
        if (isBool(lt) && isBool(rt)) {
          if (op === 'AND') return { type: T.BOOL, ev: (f) => Boolean(le(f)) && Boolean(re(f)) };
          if (op === 'OR') return { type: T.BOOL, ev: (f) => Boolean(le(f)) || Boolean(re(f)) };
          return { type: T.BOOL, ev: (f) => Boolean(le(f)) !== Boolean(re(f)) };
        }
        if (isInt(lt) && isInt(rt)) {
          const t = promote(lt, rt)!;
          const fn =
            op === 'AND' ? (a: number, b: number) => a & b : op === 'OR' ? (a: number, b: number) => a | b : (a: number, b: number) => a ^ b;
          return { type: t, ev: (f) => coerce(fn(le(f) as number, re(f) as number), t) };
        }
        return bad();
      }
      case '=':
      case '<>':
      case '<':
      case '>':
      case '<=':
      case '>=': {
        const ok =
          (isNumeric(lt) && isNumeric(rt)) ||
          (isTime(lt) && isTime(rt)) ||
          (isString(lt) && isString(rt)) ||
          (isBool(lt) && isBool(rt) && (op === '=' || op === '<>'));
        if (!ok) bad();
        const cmp: Record<string, (a: Value, b: Value) => boolean> = {
          '=': (a, b) => a === b,
          '<>': (a, b) => a !== b,
          '<': (a, b) => a < b,
          '>': (a, b) => a > b,
          '<=': (a, b) => a <= b,
          '>=': (a, b) => a >= b,
        };
        const fn = cmp[op]!;
        return { type: T.BOOL, ev: (f) => fn(le(f), re(f)) };
      }
      case '+':
      case '-': {
        if (isTime(lt) && isTime(rt)) {
          return { type: T.TIME, ev: op === '+' ? (f) => (le(f) as number) + (re(f) as number) : (f) => (le(f) as number) - (re(f) as number) };
        }
        const t = promote(lt, rt) ?? bad();
        return op === '+'
          ? { type: t, ev: (f) => coerce((le(f) as number) + (re(f) as number), t) }
          : { type: t, ev: (f) => coerce((le(f) as number) - (re(f) as number), t) };
      }
      case '*': {
        if (isTime(lt) && isNumeric(rt)) return { type: T.TIME, ev: (f) => (le(f) as number) * (re(f) as number) };
        if (isNumeric(lt) && isTime(rt)) return { type: T.TIME, ev: (f) => (le(f) as number) * (re(f) as number) };
        const t = promote(lt, rt) ?? bad();
        return { type: t, ev: (f) => coerce((le(f) as number) * (re(f) as number), t) };
      }
      case '/': {
        if (isTime(lt) && isNumeric(rt)) {
          return {
            type: T.TIME,
            ev: (f) => {
              const d = re(f) as number;
              if (d === 0) throw new PlcError('runtime', 'DIV_BY_ZERO', {}, pos);
              return Math.trunc((le(f) as number) / d);
            },
          };
        }
        const t = promote(lt, rt) ?? bad();
        const intDiv = isInt(t);
        return {
          type: t,
          ev: (f) => {
            const d = re(f) as number;
            if (intDiv && d === 0) throw new PlcError('runtime', 'DIV_BY_ZERO', {}, pos);
            const q = (le(f) as number) / d;
            return coerce(intDiv ? Math.trunc(q) : q, t);
          },
        };
      }
      case 'MOD': {
        if (!isInt(lt) || !isInt(rt)) bad();
        const t = promote(lt, rt)!;
        return {
          type: t,
          ev: (f) => {
            const d = re(f) as number;
            if (d === 0) throw new PlcError('runtime', 'DIV_BY_ZERO', {}, pos);
            return coerce((le(f) as number) % d, t);
          },
        };
      }
      case '**': {
        if (!isNumeric(lt) || !isNumeric(rt)) bad();
        const t = isReal(lt) && lt.kind === 'elem' ? lt : T.REAL;
        return { type: t, ev: (f) => coerce((le(f) as number) ** (re(f) as number), t) };
      }
    }
  }

  private call(e: Extract<Expr, { kind: 'call' }>): CExpr {
    if (e.name === '__ARRAY__') throw new PlcError('semantic', 'EXPECTED_EXPR', { found: '[' }, e.pos);
    const user = this.pous.get(e.name);
    if (user) {
      if (user.pou.kind !== 'FUNCTION') throw new PlcError('semantic', 'UNKNOWN_FUNCTION', { name: e.display }, e.pos);
      return this.userFunctionCall(user, e);
    }
    if (this.lookup(e.name)?.type.kind === 'fb') {
      throw new PlcError('semantic', 'NOT_CALLABLE', { name: e.display }, e.pos);
    }
    const fn = FUNCTIONS.get(e.name) ?? lookupConversion(e.name);
    if (!fn) throw new PlcError('semantic', 'UNKNOWN_FUNCTION', { name: e.display }, e.pos);
    const args = e.args.map((a) => this.expr(a.value));
    const type = fn.check(
      args.map((a) => a.type),
      e.pos,
    );
    const evs = args.map((a) => a.ev);
    const impl = fn.impl;
    return { type, ev: (f) => impl(evs.map((x) => x(f)), type) };
  }

  private userFunctionCall(info: PouInfo, e: Extract<Expr, { kind: 'call' }>): CExpr {
    const inputs = info.params.filter((p) => p.dir === 'in');
    const sets: Array<{ key: string; type: PlcType; ev: Ev }> = [];
    e.args.forEach((a, idx) => {
      const p = a.name ? inputs.find((x) => x.name === a.name) : inputs[idx];
      if (!p || a.output) throw new PlcError('semantic', 'BAD_ARG', { name: a.name ?? String(idx + 1), fb: info.pou.displayName }, a.pos);
      const c = this.expr(a.value);
      if (!assignable(c.type, p.type)) {
        throw new PlcError('semantic', 'ASSIGN_MISMATCH', { from: typeName(c.type), to: typeName(p.type) }, a.pos);
      }
      sets.push({ key: p.name, type: p.type, ev: c.ev });
    });
    const retKey = info.pou.name;
    const type = info.vars.get(retKey)!.type;
    const pos = e.pos;
    return {
      type,
      ev: (f) => {
        const frame = this.instantiate(info);
        for (const s of sets) frame[s.key] = coerce(s.ev(f), s.type);
        if (++this.callDepth > MAX_CALL_DEPTH) throw new PlcError('runtime', 'RECURSION', { name: info.pou.displayName }, pos);
        info.body!(frame);
        this.callDepth--;
        return frame[retKey]!;
      },
    };
  }

  // ---------- Introspection ----------
  private symbols(prog: CompiledProgram): SymbolInfo[] {
    const out: SymbolInfo[] = [];
    const walk = (prefix: string, vars: Iterable<VarInfo>) => {
      for (const v of vars) {
        const path = prefix ? `${prefix}.${v.decl.displayName}` : v.decl.displayName;
        if (v.type.kind === 'fb') {
          for (const p of this.fbParams(v.type.name)) {
            if (p.dir !== 'local') out.push({ path: `${path}.${p.name}`, type: typeName(p.type) });
          }
        } else out.push({ path, type: typeName(v.type) });
      }
    };
    walk('', this.globalVars.values());
    for (const p of prog.programs) walk(p.display, this.pous.get(p.name)!.vars.values());
    return out;
  }

  private readPath(prog: CompiledProgram, path: string): Value | undefined {
    if (path.trim().startsWith('%')) return prog.io[normalizeAddress(path)];
    const parts = path.toUpperCase().split('.');
    let frame: Frame | undefined;
    let vars: Map<string, VarInfo> | undefined;
    const program = prog.programs.find((p) => p.name === parts[0]);
    if (program) {
      frame = program.frame;
      vars = this.pous.get(program.name)!.vars;
      parts.shift();
    } else if (this.globalVars.has(parts[0]!)) {
      frame = prog.globals;
      vars = this.globalVars;
    } else {
      const first = prog.programs[0];
      if (!first) return undefined;
      frame = first.frame;
      vars = this.pous.get(first.name)!.vars;
    }
    const head = parts.shift();
    if (!head) return undefined;
    const info = vars.get(head) ?? this.globalVars.get(head);
    if (!info) return undefined;
    let value: Value | undefined = info.decl.address
      ? prog.io[info.decl.address]
      : (info.global ? prog.globals : frame)[head];
    for (const p of parts) {
      if (value === undefined) return undefined;
      if (isFbValue(value)) value = value.vars[p];
      else if (Array.isArray(value)) value = value[Number(p)];
      else return undefined;
    }
    return value;
  }
}

function exprName(e: Expr): string {
  switch (e.kind) {
    case 'name':
      return e.display;
    case 'member':
      return `${exprName(e.object)}.${e.display}`;
    case 'index':
      return `${exprName(e.object)}[]`;
    case 'address':
      return e.address;
    default:
      return '?';
  }
}
