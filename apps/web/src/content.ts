// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Content registry: bundled YAML (compiled into the app by Vite) + content
 * imported by the user (kept in localStorage, validated by the same schemas).
 */
import { parseContent, type Checkpoint, type Lesson, type WorkOrder } from '@controlslab/content';
import type { MachineDef } from '@controlslab/sim';
import { useSyncExternalStore } from 'react';

const bundled = import.meta.glob('@content/{lessons,workorders,checkpoints,machines}/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface Registry {
  lessons: Lesson[];
  workorders: WorkOrder[];
  checkpoints: Checkpoint[];
  machines: MachineDef[];
  /** ids that came from user imports. */
  local: Set<string>;
  errors: string[];
}

const USER_KEY = 'controlslab.content.v1';

function read(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function build(): Registry {
  const reg: Registry = { lessons: [], workorders: [], checkpoints: [], machines: [], local: new Set(), errors: [] };
  const add = (name: string, text: string, isLocal: boolean) => {
    try {
      const p = parseContent(text);
      const list = { lesson: reg.lessons, workorder: reg.workorders, checkpoint: reg.checkpoints, machine: reg.machines }[p.kind] as Array<{ id: string }>;
      const i = list.findIndex((x) => x.id === p.id);
      if (i >= 0) list.splice(i, 1); // user content overrides bundled content with the same id
      list.push(p.data as { id: string });
      if (isLocal) reg.local.add(`${p.kind}:${p.id}`);
    } catch (e) {
      reg.errors.push(`${name}: ${(e as Error).message}`);
    }
  };
  for (const [path, text] of Object.entries(bundled)) add(path, text, false);
  for (const [name, text] of Object.entries(read())) add(name, text, true);
  reg.lessons.sort((a, b) => a.order - b.order);
  reg.workorders.sort((a, b) => a.number.localeCompare(b.number));
  return reg;
}

let registry = build();
const listeners = new Set<() => void>();

export const getRegistry = () => registry;
export const useRegistry = () =>
  useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => registry,
  );

/** Validate + store a YAML document. Throws ContentError with a readable message. */
export function importContent(text: string, name = 'import'): { kind: string; id: string } {
  const p = parseContent(text);
  const all = read();
  all[`${p.kind}:${p.id}`] = text;
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(all));
  } catch {
    throw new Error('Stockage local plein ou indisponible');
  }
  void name;
  registry = build();
  listeners.forEach((f) => f());
  return { kind: p.kind, id: p.id };
}

export function removeContent(key: string) {
  const all = read();
  delete all[key];
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  registry = build();
  listeners.forEach((f) => f());
}

export const userContentKeys = () => Object.keys(read());
export const machineById = (id: string) => registry.machines.find((m) => m.id === id);
export const workorderById = (id: string) => registry.workorders.find((w) => w.id === id);
export const lessonById = (id: string) => registry.lessons.find((l) => l.id === id);
