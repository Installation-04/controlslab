// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Error model. Every error carries a stable `code` + params so the UI can
 * translate it; `message` is the French default (primary audience).
 */

export type Locale = 'fr' | 'en';

export interface SourcePos {
  line: number;
  col: number;
}

type Params = Record<string, string | number>;

const MESSAGES: Record<string, { fr: string; en: string }> = {
  UNEXPECTED_CHAR: { fr: 'Caractère inattendu « {ch} »', en: 'Unexpected character "{ch}"' },
  UNTERMINATED_COMMENT: { fr: 'Commentaire non terminé', en: 'Unterminated comment' },
  UNTERMINATED_STRING: { fr: 'Chaîne non terminée', en: 'Unterminated string' },
  BAD_NUMBER: { fr: 'Nombre invalide « {text} »', en: 'Invalid number "{text}"' },
  BAD_TIME: { fr: 'Littéral de durée invalide « {text} »', en: 'Invalid time literal "{text}"' },
  BAD_ADDRESS: { fr: 'Adresse directe invalide « {text} »', en: 'Invalid direct address "{text}"' },
  EXPECTED: { fr: '« {expected} » attendu, trouvé « {found} »', en: 'Expected "{expected}", found "{found}"' },
  EXPECTED_EXPR: { fr: 'Expression attendue, trouvé « {found} »', en: 'Expression expected, found "{found}"' },
  EXPECTED_STMT: { fr: 'Instruction attendue, trouvé « {found} »', en: 'Statement expected, found "{found}"' },
  NO_PROGRAM: { fr: 'Aucun PROGRAM trouvé', en: 'No PROGRAM found' },
  DUPLICATE_POU: { fr: 'POU « {name} » déjà défini', en: 'POU "{name}" already defined' },
  DUPLICATE_VAR: { fr: 'Variable « {name} » déjà déclarée', en: 'Variable "{name}" already declared' },
  UNKNOWN_TYPE: { fr: 'Type inconnu « {name} »', en: 'Unknown type "{name}"' },
  UNKNOWN_VAR: { fr: 'Variable non déclarée « {name} »', en: 'Undeclared variable "{name}"' },
  UNKNOWN_MEMBER: { fr: '« {member} » n’existe pas dans « {type} »', en: '"{member}" is not a member of "{type}"' },
  UNKNOWN_FUNCTION: { fr: 'Fonction inconnue « {name} »', en: 'Unknown function "{name}"' },
  NOT_CALLABLE: { fr: '« {name} » n’est pas un bloc fonctionnel', en: '"{name}" is not a function block instance' },
  NOT_INDEXABLE: { fr: '« {name} » n’est pas un tableau', en: '"{name}" is not an array' },
  NOT_ASSIGNABLE: { fr: 'Affectation impossible à cette cible', en: 'Cannot assign to this target' },
  READ_ONLY: { fr: '« {name} » est en lecture seule', en: '"{name}" is read-only' },
  TYPE_MISMATCH: { fr: 'Types incompatibles : {left} et {right}', en: 'Type mismatch: {left} and {right}' },
  ASSIGN_MISMATCH: {
    fr: 'Impossible d’affecter {from} à {to}',
    en: 'Cannot assign {from} to {to}',
  },
  EXPECTED_BOOL: { fr: 'Condition BOOL attendue, trouvé {type}', en: 'BOOL condition expected, found {type}' },
  EXPECTED_INT: { fr: 'Entier attendu, trouvé {type}', en: 'Integer expected, found {type}' },
  BAD_OPERAND: { fr: 'Opérateur {op} invalide pour {type}', en: 'Operator {op} not valid for {type}' },
  BAD_ARG: { fr: 'Paramètre « {name} » inconnu pour {fb}', en: 'Unknown parameter "{name}" for {fb}' },
  BAD_ARG_COUNT: {
    fr: '{name} attend {expected} argument(s), reçu {got}',
    en: '{name} expects {expected} argument(s), got {got}',
  },
  OUTPUT_BINDING: { fr: '« => » réservé aux sorties ({name})', en: '"=>" is only for outputs ({name})' },
  EXIT_OUTSIDE_LOOP: { fr: 'EXIT hors d’une boucle', en: 'EXIT outside of a loop' },
  BAD_ARRAY_BOUNDS: { fr: 'Bornes de tableau invalides', en: 'Invalid array bounds' },
  NOT_LVALUE: { fr: 'VAR_IN_OUT « {name} » exige une variable', en: 'VAR_IN_OUT "{name}" requires a variable' },
  CONSTANT_INIT: { fr: 'Valeur initiale invalide pour « {name} »', en: 'Invalid initial value for "{name}"' },
  RECURSION: { fr: 'Appel récursif interdit ({name})', en: 'Recursive call not allowed ({name})' },
  RECURSIVE_TYPE: { fr: 'Instanciation récursive de « {name} »', en: 'Recursive instantiation of "{name}"' },
  // Runtime
  INDEX_OUT_OF_RANGE: {
    fr: 'Indice {index} hors limites [{lo}..{hi}]',
    en: 'Index {index} out of range [{lo}..{hi}]',
  },
  DIV_BY_ZERO: { fr: 'Division par zéro', en: 'Division by zero' },
  WATCHDOG: {
    fr: 'Chien de garde : le cycle dépasse {limit} opérations (boucle infinie?)',
    en: 'Watchdog: scan exceeded {limit} operations (infinite loop?)',
  },
};

export function formatMessage(code: string, params: Params = {}, locale: Locale = 'fr'): string {
  const tpl = MESSAGES[code]?.[locale] ?? code;
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

export class PlcError extends Error {
  readonly code: string;
  readonly params: Params;
  readonly pos: SourcePos | undefined;
  readonly kind: 'syntax' | 'semantic' | 'runtime';

  constructor(kind: PlcError['kind'], code: string, params: Params = {}, pos?: SourcePos) {
    const base = formatMessage(code, params, 'fr');
    super(pos ? `${pos.line}:${pos.col} ${base}` : base);
    this.name = 'PlcError';
    this.kind = kind;
    this.code = code;
    this.params = params;
    this.pos = pos;
  }

  localized(locale: Locale): string {
    const m = formatMessage(this.code, this.params, locale);
    return this.pos ? `${this.pos.line}:${this.pos.col} ${m}` : m;
  }

  toJSON(): PlcErrorInfo {
    return { kind: this.kind, code: this.code, params: this.params, pos: this.pos, message: this.message };
  }
}

export interface PlcErrorInfo {
  kind: PlcError['kind'];
  code: string;
  params: Params;
  pos: SourcePos | undefined;
  message: string;
}
