// SPDX-License-Identifier: AGPL-3.0-only
import type { SourcePos } from './errors';

export interface TypeSpec {
  kind: 'named' | 'array' | 'string';
  name: string; // upper-case type name ('ARRAY' / 'STRING' for others)
  elem?: TypeSpec;
  lo?: number;
  hi?: number;
  length?: number; // STRING[n]
  pos: SourcePos;
}

export type VarSection =
  | 'VAR'
  | 'VAR_INPUT'
  | 'VAR_OUTPUT'
  | 'VAR_IN_OUT'
  | 'VAR_GLOBAL'
  | 'VAR_TEMP'
  | 'VAR_EXTERNAL';

export interface VarDecl {
  name: string; // upper-case key
  displayName: string;
  section: VarSection;
  constant: boolean;
  retain: boolean;
  address?: string;
  type: TypeSpec;
  init?: Expr;
  pos: SourcePos;
}

export interface Pou {
  kind: 'PROGRAM' | 'FUNCTION_BLOCK' | 'FUNCTION';
  name: string;
  displayName: string;
  returnType?: TypeSpec;
  vars: VarDecl[];
  body: Stmt[];
  pos: SourcePos;
}

export interface CompilationUnit {
  pous: Pou[];
  globals: VarDecl[];
}

// ---- Expressions ----
export type Expr =
  | { kind: 'literal'; type: string; value: boolean | number | string; pos: SourcePos }
  | { kind: 'name'; name: string; display: string; pos: SourcePos }
  | { kind: 'address'; address: string; pos: SourcePos }
  | { kind: 'member'; object: Expr; member: string; display: string; pos: SourcePos }
  | { kind: 'index'; object: Expr; index: Expr; pos: SourcePos }
  | { kind: 'unary'; op: '-' | 'NOT' | '+'; operand: Expr; pos: SourcePos }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; pos: SourcePos }
  | { kind: 'call'; name: string; display: string; args: CallArg[]; pos: SourcePos };

export type BinaryOp =
  | '+' | '-' | '*' | '/' | 'MOD' | '**'
  | '=' | '<>' | '<' | '>' | '<=' | '>='
  | 'AND' | 'OR' | 'XOR';

export interface CallArg {
  name?: string; // formal parameter (upper-case)
  output?: boolean; // `=>` binding
  value: Expr;
  pos: SourcePos;
}

// ---- Statements ----
export interface CaseBranch {
  labels: Array<{ from: Expr; to?: Expr }>;
  body: Stmt[];
}

export type Stmt =
  | { kind: 'assign'; target: Expr; value: Expr; pos: SourcePos }
  | { kind: 'fbcall'; target: Expr; args: CallArg[]; pos: SourcePos }
  | { kind: 'if'; branches: Array<{ cond: Expr; body: Stmt[] }>; elseBody?: Stmt[]; pos: SourcePos }
  | { kind: 'case'; selector: Expr; branches: CaseBranch[]; elseBody?: Stmt[]; pos: SourcePos }
  | { kind: 'for'; variable: string; display: string; from: Expr; to: Expr; by?: Expr; body: Stmt[]; pos: SourcePos }
  | { kind: 'while'; cond: Expr; body: Stmt[]; pos: SourcePos }
  | { kind: 'repeat'; body: Stmt[]; until: Expr; pos: SourcePos }
  | { kind: 'exit'; pos: SourcePos }
  | { kind: 'return'; pos: SourcePos }
  | { kind: 'empty'; pos: SourcePos };
