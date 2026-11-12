// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tiny i18n layer (no dependency). UI strings live in `strings.ts`; lesson /
 * machine text is `string | { fr, en? }` and resolved with `loc()`.
 * French (Québec) is the reference language; English falls back to French.
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import { STRINGS, type StringKey } from './strings';

export type Lang = 'fr' | 'en';
export type Loc = string | { fr: string; en?: string } | undefined;

const KEY = 'controlslab.lang';
let lang: Lang = 'fr';
try {
  const saved = localStorage.getItem(KEY);
  if (saved === 'fr' || saved === 'en') lang = saved;
} catch {
  /* storage unavailable */
}
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}
export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = l === 'fr' ? 'fr-CA' : 'en';
  listeners.forEach((f) => f());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => lang,
  );
}

/** Resolve localized content text. */
export function locIn(l: Lang, v: Loc): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  return l === 'en' ? (v.en ?? v.fr) : v.fr;
}
export const loc = (v: Loc) => locIn(lang, v);

/** UI string with {param} interpolation. */
export function tIn(l: Lang, key: StringKey, params?: Record<string, string | number>): string {
  const entry = STRINGS[key];
  const s = (l === 'en' ? entry.en : undefined) ?? entry.fr;
  return params ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? '')) : s;
}

export function useT() {
  const l = useLang();
  return {
    lang: l,
    t: (key: StringKey, params?: Record<string, string | number>) => tIn(l, key, params),
    loc: (v: Loc) => locIn(l, v),
  };
}

export const I18nContext = createContext<Lang>('fr');
export const useI18nContext = () => useContext(I18nContext);
