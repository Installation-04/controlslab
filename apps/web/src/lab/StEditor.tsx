// SPDX-License-Identifier: AGPL-3.0-only
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

const KEYWORDS = new Set(
  'PROGRAM END_PROGRAM FUNCTION_BLOCK END_FUNCTION_BLOCK FUNCTION END_FUNCTION VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_GLOBAL VAR_TEMP VAR_EXTERNAL END_VAR CONSTANT RETAIN AT IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT EXIT RETURN AND OR XOR NOT MOD ARRAY'.split(' '),
);
const TYPES = new Set('BOOL SINT INT DINT LINT USINT UINT UDINT ULINT BYTE WORD DWORD LWORD REAL LREAL TIME STRING TON TOF TP CTU CTD CTUD R_TRIG F_TRIG SR RS'.split(' '));

const stLanguage = StreamLanguage.define<{ comment: boolean }>({
  startState: () => ({ comment: false }),
  token(stream, state) {
    if (state.comment) {
      if (stream.match(/^.*?\*\)/)) state.comment = false;
      else stream.skipToEnd();
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('(*')) {
      state.comment = true;
      if (stream.match(/^.*?\*\)/)) state.comment = false;
      else stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^'[^']*'?/) || stream.match(/^"[^"]*"?/)) return 'string';
    if (stream.match(/^%[IQM][XBWDL]?\d+(\.\d+)*/i)) return 'atom';
    if (stream.match(/^(T|TIME)#[-0-9A-Za-z_.]+/i)) return 'number';
    if (stream.match(/^(16|8|2)#[0-9A-Fa-f_]+/) || stream.match(/^\d[\d_]*(\.\d+)?([eE][-+]?\d+)?/)) return 'number';
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const w = stream.current().toUpperCase();
      if (w === 'TRUE' || w === 'FALSE') return 'bool';
      if (KEYWORDS.has(w)) return 'keyword';
      if (TYPES.has(w)) return 'typeName';
      return 'variableName';
    }
    stream.next();
    return 'operator';
  },
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: t.typeName, color: 'var(--syn-type)' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.bool, color: 'var(--syn-number)' },
  { tag: t.atom, color: 'var(--syn-addr)' },
]);

export interface EditorError {
  line: number;
  message: string;
}

const setErrors = StateEffect.define<EditorError[]>();
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrors)) {
        const ranges = e.value
          .filter((x) => x.line >= 1 && x.line <= tr.state.doc.lines)
          .map((x) => Decoration.line({ class: 'cm-error-line', attributes: { title: x.message } }).range(tr.state.doc.line(x.line).from));
        deco = Decoration.set(ranges, true);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function StEditor({ value, onChange, errors, readOnly }: { value: string; onChange(v: string): void; errors: EditorError[]; readOnly?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          stLanguage,
          syntaxHighlighting(highlight),
          errorField,
          EditorState.readOnly.of(!!readOnly),
          EditorView.contentAttributes.of({ 'aria-label': 'Éditeur de code Structured Text', spellcheck: 'false' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
  }, [readOnly]);

  // External value changes (import, starter reset).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setErrors.of(errors) });
  }, [errors]);

  return <div className="st-editor" ref={host} data-testid="st-editor" />;
}
