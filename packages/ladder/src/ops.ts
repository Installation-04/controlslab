// SPDX-License-Identifier: AGPL-3.0-only
/** Pure tree operations used by the editor. Every function returns a new structure. */
import { uid, type LogicNode } from './types';

type Group = Extract<LogicNode, { t: 'series' | 'parallel' }>;
const isGroup = (n: LogicNode): n is Group => n.t === 'series' || n.t === 'parallel';

/** Flatten nested same-type groups, unwrap single-item groups, drop empty ones. */
export function normalize(n: LogicNode | null): LogicNode | null {
  if (!n) return null;
  if (!isGroup(n)) return n;
  const items: LogicNode[] = [];
  for (const c of n.items) {
    const nc = normalize(c);
    if (!nc) continue;
    if (nc.t === n.t) items.push(...(nc as Group).items);
    else items.push(nc);
  }
  if (items.length === 0) return null;
  if (items.length === 1) return items[0]!;
  return { ...n, items };
}

export function find(n: LogicNode | null, id: string): LogicNode | null {
  if (!n) return null;
  if (n.id === id) return n;
  if (isGroup(n)) for (const c of n.items) {
    const f = find(c, id);
    if (f) return f;
  }
  return null;
}

export function parentOf(n: LogicNode | null, id: string): LogicNode | null {
  if (!n || !isGroup(n)) return null;
  for (const c of n.items) {
    if (c.id === id) return n;
    const p = parentOf(c, id);
    if (p) return p;
  }
  return null;
}

function replace(n: LogicNode, id: string, f: (target: LogicNode) => LogicNode | null): LogicNode | null {
  if (n.id === id) return f(n);
  if (!isGroup(n)) return n;
  const items = n.items.map((c) => replace(c, id, f)).filter((c): c is LogicNode => c !== null);
  return { ...n, items };
}

/** Put `add` in series right after the node `id` (or alone when the rung is empty). */
export function addAfter(logic: LogicNode | null, id: string | null, add: LogicNode): LogicNode {
  if (!logic || !id) return normalize(logic ? { id: uid('s'), t: 'series', items: [logic, add] } : add)!;
  const parent = parentOf(logic, id);
  if (parent?.t === 'series') {
    const out = replace(logic, parent.id, (p) => {
      const g = p as Group;
      const i = g.items.findIndex((c) => c.id === id);
      return { ...g, items: [...g.items.slice(0, i + 1), add, ...g.items.slice(i + 1)] };
    });
    return normalize(out)!;
  }
  return normalize(replace(logic, id, (t) => ({ id: uid('s'), t: 'series', items: [t, add] })))!;
}

/** Put `add` in parallel with the node/group `id`. */
export function addParallel(logic: LogicNode | null, id: string | null, add: LogicNode): LogicNode {
  if (!logic || !id) return normalize(logic ? { id: uid('p'), t: 'parallel', items: [logic, add] } : add)!;
  const parent = parentOf(logic, id);
  if (parent?.t === 'parallel') {
    const out = replace(logic, parent.id, (p) => {
      const g = p as Group;
      const i = g.items.findIndex((c) => c.id === id);
      return { ...g, items: [...g.items.slice(0, i + 1), add, ...g.items.slice(i + 1)] };
    });
    return normalize(out)!;
  }
  return normalize(replace(logic, id, (t) => ({ id: uid('p'), t: 'parallel', items: [t, add] })))!;
}

export function removeNode(logic: LogicNode | null, id: string): LogicNode | null {
  if (!logic) return null;
  return normalize(replace(logic, id, () => null));
}

export function updateNode(logic: LogicNode | null, id: string, patch: Partial<Extract<LogicNode, { t: 'contact' }>> | Partial<Extract<LogicNode, { t: 'cmp' }>>): LogicNode | null {
  if (!logic) return null;
  return replace(logic, id, (t) => ({ ...t, ...patch }) as LogicNode);
}

/** All leaf nodes (contacts and comparisons), left to right. */
export function leaves(n: LogicNode | null): LogicNode[] {
  if (!n) return [];
  return isGroup(n) ? n.items.flatMap(leaves) : [n];
}

/** Deep copy with fresh ids (used to duplicate rungs). */
export function cloneWithNewIds(n: LogicNode): LogicNode {
  return isGroup(n) ? { ...n, id: uid(n.t === 'series' ? 's' : 'p'), items: n.items.map(cloneWithNewIds) } : { ...n, id: uid('c') };
}
