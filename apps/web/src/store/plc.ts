// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PLC program storage: each program key can hold a Structured Text source and/or a
 * Ladder program (JSON), plus the language currently in use. Everything lives in the
 * progress store, so it is covered by backup/export automatically.
 */
import { parseLd, toST, type LdProgram } from '@controlslab/ladder';
import { useMemo } from 'react';
import { actions, getProgress, useProgress } from './progress';

export type PlcLang = 'st' | 'ld';

export interface Starters {
  st: string;
  ld?: LdProgram;
  /** Languages offered to the learner (default: ST, plus LD when a ladder starter exists). */
  languages?: PlcLang[];
  defaultLang?: PlcLang;
}

export const langsOf = (s: Starters): PlcLang[] => s.languages ?? (s.ld ? ['st', 'ld'] : ['st']);

const ldKey = (k: string) => `${k}:ld`;
const langKey = (k: string) => `${k}:lang`;

export function readLang(programs: Record<string, string>, key: string, s: Starters): PlcLang {
  const allowed = langsOf(s);
  const saved = programs[langKey(key)] as PlcLang | undefined;
  if (saved && allowed.includes(saved)) return saved;
  return s.defaultLang && allowed.includes(s.defaultLang) ? s.defaultLang : allowed[0]!;
}

export function readLd(programs: Record<string, string>, key: string, s: Starters): LdProgram {
  const raw = programs[ldKey(key)];
  if (raw) {
    const r = parseLd(raw);
    if (r.ok) return r.program;
  }
  return structuredClone(s.ld ?? { v: 1, name: 'Main', vars: [], rungs: [] });
}

/** The Structured Text to run/check for a program key (ladder is transpiled). */
export function resolveSource(programs: Record<string, string>, key: string, s: Starters): string {
  return readLang(programs, key, s) === 'ld' ? toST(readLd(programs, key, s)) : (programs[key] ?? s.st);
}

export const getPlcSource = (key: string, s: Starters) => resolveSource(getProgress().programs, key, s);

export interface PlcProgram {
  key: string;
  starters: Starters;
  lang: PlcLang;
  st: string;
  ld: LdProgram;
  /** ST source to execute (generated from the ladder when lang is "ld"). */
  source: string;
  setLang(l: PlcLang): void;
  setSt(v: string): void;
  setLd(p: LdProgram): void;
  resetToStarter(): void;
}

export function usePlcProgram(key: string, starters: Starters): PlcProgram {
  const { programs } = useProgress();
  const lang = readLang(programs, key, starters);
  const st = programs[key] ?? starters.st;
  const ldRaw = programs[ldKey(key)];
  const ld = useMemo(() => readLd(programs, key, starters), [ldRaw, key, starters]);
  const source = useMemo(() => (lang === 'ld' ? toST(ld) : st), [lang, ld, st]);
  return {
    key,
    starters,
    lang,
    st,
    ld,
    source,
    setLang: (l) => actions.saveProgram(langKey(key), l),
    setSt: (v) => actions.saveProgram(key, v),
    setLd: (p) => actions.saveProgram(ldKey(key), JSON.stringify(p)),
    resetToStarter: () => {
      actions.saveProgram(key, starters.st);
      if (starters.ld) actions.saveProgram(ldKey(key), JSON.stringify(starters.ld));
    },
  };
}
