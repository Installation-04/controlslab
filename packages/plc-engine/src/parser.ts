// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Recursive-descent parser for an IEC 61131-3 Structured Text subset.
 * Operator precedence (high → low): ( ) call, **, unary - NOT, * / MOD, + -,
 * < > <= >=, = <>, AND &, XOR, OR.
 */
import type {
  BinaryOp, CallArg, CaseBranch, CompilationUnit, Expr, Pou, Stmt, TypeSpec, VarDecl, VarSection,
} from './ast';
import { PlcError } from './errors';
import { tokenize, type Token } from './lexer';

const VAR_SECTIONS = new Set<string>([
  'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_GLOBAL', 'VAR_TEMP', 'VAR_EXTERNAL',
]);

export function parse(src: string): CompilationUnit {
  return new Parser(tokenize(src)).parseUnit();
}

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  private get cur(): Token {
    return this.toks[this.i]!;
  }
  private peek(n = 1): Token {
    return this.toks[Math.min(this.i + n, this.toks.length - 1)]!;
  }
  private next(): Token {
    const t = this.cur;
    if (t.kind !== 'eof') this.i++;
    return t;
  }
  private is(value: string): boolean {
    const t = this.cur;
    return (t.kind === 'keyword' || t.kind === 'op') && t.value === value;
  }
  private accept(value: string): boolean {
    if (this.is(value)) {
      this.i++;
      return true;
    }
    return false;
  }
  private expect(value: string): Token {
    if (!this.is(value)) {
      throw new PlcError('syntax', 'EXPECTED', { expected: value, found: this.cur.text }, this.cur.pos);
    }
    return this.next();
  }
  private ident(): Token {
    if (this.cur.kind !== 'ident') {
      throw new PlcError('syntax', 'EXPECTED', { expected: 'identificateur', found: this.cur.text }, this.cur.pos);
    }
    return this.next();
  }

  parseUnit(): CompilationUnit {
    const pous: Pou[] = [];
    const globals: VarDecl[] = [];
    while (this.cur.kind !== 'eof') {
      if (this.is('PROGRAM') || this.is('FUNCTION_BLOCK') || this.is('FUNCTION')) {
        pous.push(this.parsePou());
      } else if (this.is('VAR_GLOBAL')) {
        globals.push(...this.parseVarBlock());
      } else {
        throw new PlcError('syntax', 'EXPECTED', { expected: 'PROGRAM', found: this.cur.text }, this.cur.pos);
      }
    }
    return { pous, globals };
  }

  private parsePou(): Pou {
    const kw = this.next();
    const kind = kw.value as Pou['kind'];
    const nameTok = this.ident();
    let returnType: TypeSpec | undefined;
    if (kind === 'FUNCTION') {
      this.expect(':');
      returnType = this.parseType();
    }
    const vars: VarDecl[] = [];
    while (VAR_SECTIONS.has(this.cur.value) && this.cur.kind === 'keyword') vars.push(...this.parseVarBlock());
    const end = `END_${kind}`;
    const body = this.parseStatements([end]);
    this.expect(end);
    return { kind, name: nameTok.value, displayName: nameTok.text, returnType, vars, body, pos: kw.pos };
  }

  private parseVarBlock(): VarDecl[] {
    const section = this.next().value as VarSection;
    let constant = false;
    let retain = false;
    for (;;) {
      if (this.accept('CONSTANT')) constant = true;
      else if (this.accept('RETAIN')) retain = true;
      else if (this.accept('NON_RETAIN')) retain = false;
      else break;
    }
    const decls: VarDecl[] = [];
    while (!this.is('END_VAR')) {
      const names: Token[] = [this.ident()];
      while (this.accept(',')) names.push(this.ident());
      let address: string | undefined;
      if (this.accept('AT')) {
        const a = this.next();
        if (a.kind !== 'address') {
          throw new PlcError('syntax', 'EXPECTED', { expected: '%I/%Q/%M', found: a.text }, a.pos);
        }
        address = a.value;
      }
      this.expect(':');
      const type = this.parseType();
      let init: Expr | undefined;
      if (this.accept(':=')) init = this.parseInitializer();
      this.expect(';');
      for (const n of names) {
        decls.push({ name: n.value, displayName: n.text, section, constant, retain, address, type, init, pos: n.pos });
      }
    }
    this.expect('END_VAR');
    return decls;
  }

  /** Initializers: expression or array literal `[1, 2, 3]`. */
  private parseInitializer(): Expr {
    if (this.is('[')) {
      const pos = this.next().pos;
      const items: CallArg[] = [];
      if (!this.is(']')) {
        do {
          items.push({ value: this.parseExpr(), pos: this.cur.pos });
        } while (this.accept(','));
      }
      this.expect(']');
      return { kind: 'call', name: '__ARRAY__', display: '[]', args: items, pos };
    }
    return this.parseExpr();
  }

  private parseType(): TypeSpec {
    const pos = this.cur.pos;
    if (this.accept('ARRAY')) {
      this.expect('[');
      const lo = this.signedInt();
      this.expect('..');
      const hi = this.signedInt();
      this.expect(']');
      this.expect('OF');
      const elem = this.parseType();
      return { kind: 'array', name: 'ARRAY', elem, lo, hi, pos };
    }
    const t = this.cur;
    if (t.kind === 'typed') {
      // e.g. "INT" lexed as typed only when followed by '#', not the case here.
      this.next();
      return { kind: 'named', name: t.value, pos };
    }
    const id = this.ident();
    if (id.value === 'STRING' && this.accept('[')) {
      const n = this.signedInt();
      this.expect(']');
      return { kind: 'string', name: 'STRING', length: n, pos };
    }
    return { kind: 'named', name: id.value, pos };
  }

  private signedInt(): number {
    const neg = this.accept('-');
    const t = this.next();
    if (t.kind !== 'int') throw new PlcError('syntax', 'EXPECTED', { expected: 'entier', found: t.text }, t.pos);
    return neg ? -t.num! : t.num!;
  }

  // ---- Statements ----
  private parseStatements(terminators: string[]): Stmt[] {
    const out: Stmt[] = [];
    while (!terminators.some((t) => this.is(t)) && this.cur.kind !== 'eof') {
      out.push(this.parseStatement());
    }
    return out;
  }

  private parseStatement(): Stmt {
    const t = this.cur;
    const pos = t.pos;
    if (t.kind === 'op' && t.value === ';') {
      this.next();
      return { kind: 'empty', pos };
    }
    if (t.kind === 'keyword') {
      switch (t.value) {
        case 'IF':
          return this.parseIf();
        case 'CASE':
          return this.parseCase();
        case 'FOR':
          return this.parseFor();
        case 'WHILE': {
          this.next();
          const cond = this.parseExpr();
          this.expect('DO');
          const body = this.parseStatements(['END_WHILE']);
          this.expect('END_WHILE');
          this.accept(';');
          return { kind: 'while', cond, body, pos };
        }
        case 'REPEAT': {
          this.next();
          const body = this.parseStatements(['UNTIL']);
          this.expect('UNTIL');
          const until = this.parseExpr();
          this.expect('END_REPEAT');
          this.accept(';');
          return { kind: 'repeat', body, until, pos };
        }
        case 'EXIT':
          this.next();
          this.expect(';');
          return { kind: 'exit', pos };
        case 'RETURN':
          this.next();
          this.expect(';');
          return { kind: 'return', pos };
      }
    }
    if (t.kind === 'ident' || t.kind === 'address') {
      const target = this.parsePostfix();
      if (this.accept(':=')) {
        const value = this.parseExpr();
        this.expect(';');
        return { kind: 'assign', target, value, pos };
      }
      if (target.kind === 'call') {
        // FB instance call parsed as call on a name: convert.
        this.expect(';');
        return { kind: 'fbcall', target: { kind: 'name', name: target.name, display: target.display, pos: target.pos }, args: target.args, pos };
      }
      if (this.is('(')) {
        const args = this.parseArgs();
        this.expect(';');
        return { kind: 'fbcall', target, args, pos };
      }
      throw new PlcError('syntax', 'EXPECTED', { expected: ':=', found: this.cur.text }, this.cur.pos);
    }
    throw new PlcError('syntax', 'EXPECTED_STMT', { found: t.text }, pos);
  }

  private parseIf(): Stmt {
    const pos = this.expect('IF').pos;
    const branches: Array<{ cond: Expr; body: Stmt[] }> = [];
    const cond = this.parseExpr();
    this.expect('THEN');
    branches.push({ cond, body: this.parseStatements(['ELSIF', 'ELSE', 'END_IF']) });
    let elseBody: Stmt[] | undefined;
    for (;;) {
      if (this.accept('ELSIF')) {
        const c = this.parseExpr();
        this.expect('THEN');
        branches.push({ cond: c, body: this.parseStatements(['ELSIF', 'ELSE', 'END_IF']) });
      } else if (this.accept('ELSE')) {
        elseBody = this.parseStatements(['END_IF']);
      } else break;
    }
    this.expect('END_IF');
    this.accept(';');
    return { kind: 'if', branches, elseBody, pos };
  }

  private parseCase(): Stmt {
    const pos = this.expect('CASE').pos;
    const selector = this.parseExpr();
    this.expect('OF');
    const branches: CaseBranch[] = [];
    let elseBody: Stmt[] | undefined;
    while (!this.is('END_CASE')) {
      if (this.accept('ELSE')) {
        elseBody = this.parseStatements(['END_CASE']);
        break;
      }
      const labels: CaseBranch['labels'] = [];
      do {
        const from = this.parseExpr();
        const to = this.accept('..') ? this.parseExpr() : undefined;
        labels.push({ from, to });
      } while (this.accept(','));
      this.expect(':');
      const body = this.parseCaseBody();
      branches.push({ labels, body });
    }
    this.expect('END_CASE');
    this.accept(';');
    return { kind: 'case', selector, branches, elseBody, pos };
  }

  /** A case body ends at END_CASE, ELSE, or the start of the next label list (`expr [..expr] {, ...} :`). */
  private parseCaseBody(): Stmt[] {
    const out: Stmt[] = [];
    while (!this.is('END_CASE') && !this.is('ELSE') && !this.atCaseLabel()) {
      out.push(this.parseStatement());
    }
    return out;
  }

  private atCaseLabel(): boolean {
    // Look ahead: a label starts with a literal/ident/-literal and reaches ':' (not ':=') before ';'.
    const t = this.cur;
    if (!(t.kind === 'int' || t.kind === 'ident' || t.kind === 'typed' || (t.kind === 'op' && t.value === '-'))) return false;
    let j = this.i;
    while (j < this.toks.length) {
      const k = this.toks[j]!;
      if (k.kind === 'op' && k.value === ':') return true;
      if (k.kind === 'eof' || (k.kind === 'op' && (k.value === ';' || k.value === ':=' || k.value === '('))) return false;
      if (k.kind === 'keyword') return false;
      j++;
    }
    return false;
  }

  private parseFor(): Stmt {
    const pos = this.expect('FOR').pos;
    const v = this.ident();
    this.expect(':=');
    const from = this.parseExpr();
    this.expect('TO');
    const to = this.parseExpr();
    const by = this.accept('BY') ? this.parseExpr() : undefined;
    this.expect('DO');
    const body = this.parseStatements(['END_FOR']);
    this.expect('END_FOR');
    this.accept(';');
    return { kind: 'for', variable: v.value, display: v.text, from, to, by, body, pos };
  }

  private parseArgs(): CallArg[] {
    this.expect('(');
    const args: CallArg[] = [];
    if (!this.is(')')) {
      do {
        const pos = this.cur.pos;
        if (this.cur.kind === 'ident' && (this.peek().value === ':=' || this.peek().value === '=>') && this.peek().kind === 'op') {
          const name = this.next();
          const output = this.next().value === '=>';
          args.push({ name: name.value, output, value: this.parseExpr(), pos });
        } else {
          args.push({ value: this.parseExpr(), pos });
        }
      } while (this.accept(','));
    }
    this.expect(')');
    return args;
  }

  // ---- Expressions ----
  parseExpr(): Expr {
    return this.parseBinary(0);
  }

  private static readonly LEVELS: Array<{ ops: string[]; map?: Record<string, BinaryOp> }> = [
    { ops: ['OR'] },
    { ops: ['XOR'] },
    { ops: ['AND', '&'], map: { '&': 'AND' } },
    { ops: ['=', '<>'] },
    { ops: ['<', '>', '<=', '>='] },
    { ops: ['+', '-'] },
    { ops: ['*', '/', 'MOD'] },
  ];

  private parseBinary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.parseUnary();
    const { ops, map } = Parser.LEVELS[level]!;
    let left = this.parseBinary(level + 1);
    while ((this.cur.kind === 'op' || this.cur.kind === 'keyword') && ops.includes(this.cur.value)) {
      const t = this.next();
      const op = (map?.[t.value] ?? t.value) as BinaryOp;
      const right = this.parseBinary(level + 1);
      left = { kind: 'binary', op, left, right, pos: t.pos };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.cur;
    if (this.accept('NOT')) return { kind: 'unary', op: 'NOT', operand: this.parseUnary(), pos: t.pos };
    if (this.accept('-')) {
      // Fold negative numeric literals so INT#-5 / ranges behave.
      const operand = this.parseUnary();
      if (operand.kind === 'literal' && typeof operand.value === 'number') {
        return { ...operand, value: -operand.value, pos: t.pos };
      }
      return { kind: 'unary', op: '-', operand, pos: t.pos };
    }
    if (this.accept('+')) return this.parseUnary();
    return this.parsePower();
  }

  private parsePower(): Expr {
    const left = this.parsePostfix();
    if (this.is('**')) {
      const t = this.next();
      const right = this.parseUnary(); // right-assoc
      return { kind: 'binary', op: '**', left, right, pos: t.pos };
    }
    return left;
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      if (this.is('.')) {
        this.next();
        const m = this.cur;
        if (m.kind === 'int') {
          // Bit access x.3
          this.next();
          e = { kind: 'member', object: e, member: String(m.num), display: m.text, pos: m.pos };
          continue;
        }
        const id = this.ident();
        e = { kind: 'member', object: e, member: id.value, display: id.text, pos: id.pos };
      } else if (this.is('[')) {
        const pos = this.next().pos;
        const index = this.parseExpr();
        this.expect(']');
        e = { kind: 'index', object: e, index, pos };
      } else if (this.is('(') && e.kind === 'name') {
        const args = this.parseArgs();
        e = { kind: 'call', name: e.name, display: e.display, args, pos: e.pos };
      } else break;
    }
    return e;
  }

  private parsePrimary(): Expr {
    const t = this.cur;
    switch (t.kind) {
      case 'int':
        this.next();
        return { kind: 'literal', type: 'ANYINT', value: t.num!, pos: t.pos };
      case 'real':
        this.next();
        return { kind: 'literal', type: 'ANYREAL', value: t.num!, pos: t.pos };
      case 'time':
        this.next();
        return { kind: 'literal', type: 'TIME', value: t.num!, pos: t.pos };
      case 'string':
        this.next();
        return { kind: 'literal', type: 'STRING', value: t.value, pos: t.pos };
      case 'address':
        this.next();
        return { kind: 'address', address: t.value, pos: t.pos };
      case 'typed': {
        this.next();
        const neg = this.accept('-');
        const v = this.next();
        let value: number | boolean;
        if (v.kind === 'int' || v.kind === 'real') value = neg ? -v.num! : v.num!;
        else if (v.kind === 'keyword' && (v.value === 'TRUE' || v.value === 'FALSE')) value = v.value === 'TRUE';
        else throw new PlcError('syntax', 'EXPECTED_EXPR', { found: v.text }, v.pos);
        if (t.value === 'BOOL' && typeof value === 'number') value = value !== 0;
        return { kind: 'literal', type: t.value, value, pos: t.pos };
      }
      case 'ident':
        this.next();
        return { kind: 'name', name: t.value, display: t.text, pos: t.pos };
      case 'keyword':
        if (t.value === 'TRUE' || t.value === 'FALSE') {
          this.next();
          return { kind: 'literal', type: 'BOOL', value: t.value === 'TRUE', pos: t.pos };
        }
        break;
      case 'op':
        if (t.value === '(') {
          this.next();
          const e = this.parseExpr();
          this.expect(')');
          return e;
        }
        break;
    }
    throw new PlcError('syntax', 'EXPECTED_EXPR', { found: t.text }, t.pos);
  }
}
