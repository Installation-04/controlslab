// SPDX-License-Identifier: AGPL-3.0-only
import { LIBRARY, type Machine, type Point, type WireDef } from '@controlslab/sim';
import { memo, type ReactNode } from 'react';
import { loc } from '../i18n';

export interface SchematicProps {
  machine: Machine;
  /** Changes on every refresh so the memoized tree re-renders. */
  rev: number;
  probes: { red?: string; black?: string };
  onProbe(ref: string): void;
  onPress(id: string): void;
  onRelease(id: string): void;
  onToggleDisconnect(id: string): void;
  onResetOverload(id: string): void;
  /** Clamp-meter mode: wires become clickable. */
  clampMode?: boolean;
  clampWire?: string;
  onWire?(id: string): void;
  highlight?: string[];
  /** Hide interactivity (lesson figures). */
  readOnly?: boolean;
}

const LIVE = 60;
export function wireColor(v: number): { stroke: string; width: number; cls: string } {
  if (v > 300) return { stroke: 'var(--wire-600)', width: 2.6, cls: 'w600' };
  if (v > LIVE) return { stroke: 'var(--wire-120)', width: 2.4, cls: 'w120' };
  return { stroke: 'var(--wire-off)', width: 1.6, cls: 'w0' };
}

function route(a: Point, b: Point, via?: Point[]): Point[] {
  if (via?.length) return [a, ...via, b];
  if (Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[1] - b[1]) < 0.5) return [a, b];
  if (Math.abs(b[1] - a[1]) >= Math.abs(b[0] - a[0])) {
    const my = (a[1] + b[1]) / 2;
    return [a, [a[0], my], [b[0], my], b];
  }
  const mx = (a[0] + b[0]) / 2;
  return [a, [mx, a[1]], [mx, b[1]], b];
}

const pts = (p: Point[]) => p.map((q) => q.join(',')).join(' ');
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

interface PartCtx {
  tag: string;
  state: Record<string, unknown>;
  params: Record<string, number | string | boolean>;
  part: string;
  faults: Set<string>;
}

/** Symbol drawings, origin at the part's `at`, unrotated. */
const SYMBOLS: Record<string, (c: PartCtx) => ReactNode> = {
  source3: ({ tag }) => (
    <g>
      <rect x={-12} y={-34} width={124} height={34} rx={4} {...S} />
      <text x={50} y={-12} className="sym-text" textAnchor="middle">{tag} 3~</text>
    </g>
  ),
  disconnect3: ({ state, tag }) => {
    const on = state.on === true;
    const locked = ((state.locks as string[] | undefined) ?? []).length > 0;
    return (
      <g>
        {[0, 50, 100].map((x) => (
          <g key={x}>
            <polyline points={`${x},0 ${x},12`} {...S} />
            <polyline points={on ? `${x},12 ${x},38` : `${x},12 ${x - 14},36`} {...S} />
            <polyline points={`${x},38 ${x},50`} {...S} />
            <circle cx={x} cy={12} r={2.5} fill="currentColor" />
          </g>
        ))}
        <polyline points={on ? '-8,25 108,25' : '-22,24 94,24'} {...S} strokeDasharray="4 3" strokeWidth={1.2} />
        <text x={118} y={30} className="sym-text">{tag}</text>
        <text x={118} y={44} className={`sym-state ${on ? 'on' : 'off'}`}>{on ? 'ON' : 'OFF'}</text>
        {locked && (
          <g transform="translate(-34 22)">
            <rect x={0} y={7} width={14} height={11} rx={2} fill="var(--lock)" stroke="currentColor" />
            <path d="M3 7V4a4 4 0 0 1 8 0v3" {...S} strokeWidth={1.6} />
          </g>
        )}
      </g>
    );
  },
  fuse: ({ state, tag, faults }) => {
    const blown = state.blown === true || faults.has('blown');
    return (
      <g>
        <polyline points="0,0 18,0" {...S} />
        <polyline points="42,0 60,0" {...S} />
        <rect x={18} y={-6} width={24} height={12} rx={2} {...S} className={blown ? 'blown' : ''} />
        {blown ? <polyline points="23,3 29,-3 33,3 38,-3" {...S} stroke="var(--bad)" /> : <line x1={18} y1={0} x2={42} y2={0} {...S} strokeWidth={1.4} />}
        <text x={30} y={-11} className="sym-text" textAnchor="middle">{tag}</text>
      </g>
    );
  },
  contacts3: ({ state, tag }) => {
    const closed = state.energized === true;
    return (
      <g>
        {[0, 50, 100].map((x) => (
          <g key={x}>
            <polyline points={`${x},0 ${x},12`} {...S} />
            <polyline points={closed ? `${x},12 ${x},38` : `${x},12 ${x - 12},34`} {...S} />
            <polyline points={`${x},38 ${x},50`} {...S} />
          </g>
        ))}
        <polyline points="-4,25 104,25" {...S} strokeDasharray="4 3" strokeWidth={1.2} />
        <text x={118} y={30} className="sym-text">{tag}</text>
      </g>
    );
  },
  coil: ({ state, tag }) => {
    const on = state.energized === true;
    return (
      <g>
        <polyline points="0,0 16,0" {...S} />
        <polyline points="44,0 60,0" {...S} />
        <circle cx={30} cy={0} r={14} {...S} fill={on ? 'var(--lit)' : 'var(--surface)'} />
        <text x={30} y={4} className="sym-text strong" textAnchor="middle">{tag}</text>
        <text x={4} y={-6} className="sym-term">A1</text>
        <text x={44} y={-6} className="sym-term">A2</text>
      </g>
    );
  },
  contact_no: ({ state, tag }) => {
    const closed = state.energized === true;
    return (
      <g>
        <polyline points="0,0 22,0" {...S} />
        <polyline points="38,0 60,0" {...S} />
        <polyline points="22,-10 22,10" {...S} />
        <polyline points="38,-10 38,10" {...S} />
        {closed && <line x1={22} y1={0} x2={38} y2={0} {...S} />}
        <text x={30} y={-16} className="sym-text" textAnchor="middle">{tag}</text>
        <text x={30} y={24} className="sym-term" textAnchor="middle">13 – 14</text>
      </g>
    );
  },
  heaters3: ({ tag }) => (
    <g>
      {[0, 50, 100].map((x) => (
        <g key={x}>
          <polyline points={`${x},0 ${x},12`} {...S} />
          <polyline points={`${x},12 ${x + 7},16 ${x - 7},21 ${x + 7},26 ${x - 7},31 ${x},35`} {...S} />
          <polyline points={`${x},35 ${x},50`} {...S} />
        </g>
      ))}
      <text x={118} y={30} className="sym-text">{tag}</text>
    </g>
  ),
  ol_nc: ({ state, tag, faults }) => {
    const tripped = state.tripped === true || faults.has('nc_open');
    return (
      <g>
        <polyline points="0,0 20,0" {...S} />
        <polyline points="40,0 60,0" {...S} />
        <polyline points="20,-10 20,10" {...S} />
        <polyline points="40,-10 40,10" {...S} />
        {!tripped && <line x1={20} y1={0} x2={40} y2={0} {...S} />}
        <polyline points="14,-14 46,14" {...S} strokeWidth={1.2} />
        <text x={30} y={-18} className="sym-text" textAnchor="middle">{tag}</text>
        <text x={30} y={26} className="sym-term" textAnchor="middle">95 – 96</text>
      </g>
    );
  },
  contact_nc: ({ state, tag }) => {
    // NC auxiliary of a contactor: closed at rest, opens when the contactor is energized.
    const open = state.energized === true;
    return (
      <g>
        <polyline points="0,0 22,0" {...S} />
        <polyline points="38,0 60,0" {...S} />
        <polyline points="22,-10 22,10" {...S} />
        <polyline points="38,-10 38,10" {...S} />
        {!open && <line x1={22} y1={0} x2={38} y2={0} {...S} />}
        <polyline points="17,-13 43,13" {...S} strokeWidth={1.2} />
        <text x={30} y={-16} className="sym-text" textAnchor="middle">{tag}</text>
        <text x={30} y={26} className="sym-term" textAnchor="middle">21 – 22</text>
      </g>
    );
  },
  ol_no: ({ state }) => {
    const tripped = state.tripped === true;
    return (
      <g>
        <polyline points="0,0 22,0" {...S} />
        <polyline points="38,0 60,0" {...S} />
        <polyline points="22,-10 22,10" {...S} />
        <polyline points="38,-10 38,10" {...S} />
        {tripped && <line x1={22} y1={0} x2={38} y2={0} {...S} />}
        <text x={30} y={24} className="sym-term" textAnchor="middle">97 – 98</text>
      </g>
    );
  },
  motor3: ({ state }) => {
    const speed = (state.speed as number) ?? 0;
    return (
      <g>
        <polyline points="0,0 0,16" {...S} />
        <polyline points="50,0 50,16" {...S} />
        <polyline points="100,0 100,16" {...S} />
        <circle cx={50} cy={46} r={34} {...S} fill={speed > 0.05 ? 'var(--lit-soft)' : 'var(--surface)'} />
        <g style={speed > 0.05 ? { transformOrigin: '50px 46px', animation: `spin ${Math.max(0.25, 1.2 - speed)}s linear infinite` } : undefined}>
          <polyline points="50,22 50,70" {...S} strokeWidth={1} opacity={0.35} />
        </g>
        <text x={50} y={44} className="sym-text strong" textAnchor="middle">M1</text>
        <text x={50} y={59} className="sym-text" textAnchor="middle">3~</text>
        {state.dir === 'fwd' && <text x={50} y={92} className="sym-state on" textAnchor="middle">↻ AV</text>}
        {state.dir === 'rev' && <text x={50} y={92} className="sym-state off" textAnchor="middle">↺ AR</text>}
      </g>
    );
  },
  transformer: ({ tag }) => (
    <g>
      <polyline points="0,0 0,10 " {...S} />
      <polyline points="60,0 60,10" {...S} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <circle cx={14 + i * 16} cy={22} r={8} {...S} />
          <circle cx={14 + i * 16} cy={48} r={8} {...S} />
        </g>
      ))}
      <polyline points="0,10 0,22 6,22" {...S} />
      <polyline points="60,10 60,22 54,22" {...S} />
      <polyline points="0,70 0,48 6,48" {...S} />
      <polyline points="60,70 60,48 54,48" {...S} />
      <text x={30} y={39} className="sym-text strong" textAnchor="middle">{tag}</text>
      <text x={-6} y={8} className="sym-term" textAnchor="end">H1</text>
      <text x={66} y={8} className="sym-term">H2</text>
      <text x={-6} y={68} className="sym-term" textAnchor="end">X1</text>
      <text x={66} y={68} className="sym-term">X2</text>
    </g>
  ),
  pushbutton: ({ state, tag, params }) => {
    const nc = params.contact === 'NC';
    const mush = params.kind === 'mushroom';
    const pressed = state.pressed === true;
    const color = params.color === 'green' ? 'var(--btn-green)' : params.color === 'amber' ? 'var(--btn-amber)' : 'var(--btn-red)';
    const closed = nc ? !pressed : pressed;
    return (
      <g>
        <polyline points="0,0 20,0" {...S} />
        <polyline points="40,0 60,0" {...S} />
        <polyline points="20,-8 20,8" {...S} />
        <polyline points="40,-8 40,8" {...S} />
        {closed && <line x1={20} y1={0} x2={40} y2={0} {...S} />}
        {nc && <polyline points="16,-12 44,12" {...S} strokeWidth={1.2} />}
        <polyline points={`30,${pressed ? -12 : -20} 30,-26`} {...S} strokeDasharray="3 2" strokeWidth={1.2} />
        <rect x={mush ? 14 : 18} y={pressed ? -26 : -34} width={mush ? 32 : 24} height={mush ? 10 : 8} rx={mush ? 5 : 2} fill={color} stroke="currentColor" strokeWidth={1.6} className="btn-cap" />
        <text x={30} y={26} className="sym-text" textAnchor="middle">{tag}</text>
      </g>
    );
  },
  lamp: ({ state, tag, params, faults }) => {
    const lit = state.lit === true;
    const color = params.color === 'amber' ? 'var(--btn-amber)' : 'var(--lamp-green)';
    return (
      <g>
        <polyline points="0,0 16,0" {...S} />
        <polyline points="44,0 60,0" {...S} />
        <circle cx={30} cy={0} r={14} {...S} fill={lit ? color : 'var(--surface)'} />
        <polyline points="21,-9 39,9" {...S} strokeWidth={1.4} className={faults.has('burnt') ? 'dead' : ''} />
        <polyline points="21,9 39,-9" {...S} strokeWidth={1.4} />
        <text x={30} y={-20} className="sym-text" textAnchor="middle">{tag}</text>
      </g>
    );
  },
  plc_input: ({ state, tag }) => (
    <g>
      <polyline points="0,0 14,0" {...S} />
      <polyline points="46,0 60,0" {...S} />
      <rect x={14} y={-14} width={32} height={28} rx={3} {...S} fill="var(--surface)" />
      <circle cx={22} cy={-6} r={3.5} fill={state.on ? 'var(--lamp-green)' : 'var(--wire-off)'} stroke="currentColor" strokeWidth={0.8} />
      <text x={30} y={9} className="sym-term" textAnchor="middle">{tag.replace('%IX', 'I')}</text>
    </g>
  ),
  plc_output: ({ state, tag }) => (
    <g>
      <polyline points="0,0 14,0" {...S} />
      <polyline points="46,0 60,0" {...S} />
      <rect x={14} y={-14} width={32} height={28} rx={3} {...S} fill="var(--surface)" />
      <circle cx={22} cy={-6} r={3.5} fill={state.closed ? 'var(--lamp-green)' : 'var(--wire-off)'} stroke="currentColor" strokeWidth={0.8} />
      <text x={30} y={9} className="sym-term" textAnchor="middle">{tag.replace('%QX', 'Q')}</text>
    </g>
  ),
  ground: () => (
    <g>
      <polyline points="0,0 0,10" {...S} />
      <polyline points="-12,10 12,10" {...S} />
      <polyline points="-8,15 8,15" {...S} />
      <polyline points="-4,20 4,20" {...S} />
    </g>
  ),
  terminal: ({ tag }) => (
    <g>
      <circle r={3.2} fill="currentColor" />
      {tag && <text x={6} y={-6} className="sym-term">{tag}</text>}
    </g>
  ),
};

function SchematicImpl(p: SchematicProps) {
  const { machine: m } = p;
  const def = m.def;
  const [W, H] = def.viewBox;
  const hl = new Set(p.highlight ?? []);

  const wireEls = def.wires.map((w: WireDef) => {
    const a = m.terminalPosition(w.from);
    const b = m.terminalPosition(w.to);
    if (!a || !b) return null;
    const open = m.activeFaults().some((f) => f.target === w.id);
    const v = m.voltage(w.from);
    const c = wireColor(v);
    const path = route(a, b, w.via);
    const mid = path[Math.floor(path.length / 2) - 1] ?? a;
    const mid2 = path[Math.floor(path.length / 2)] ?? b;
    return (
      <g key={w.id} className={`wire ${c.cls} ${hl.has(w.id) ? 'hl' : ''} ${p.clampWire === w.id ? 'clamped' : ''}`} data-wire={w.id}>
        <polyline points={pts(path)} fill="none" stroke={open ? 'var(--bad)' : c.stroke} strokeWidth={c.width} strokeDasharray={open ? '5 4' : undefined} strokeLinejoin="round" />
        {p.clampMode && p.onWire && (
          <polyline points={pts(path)} fill="none" stroke="transparent" strokeWidth={14} style={{ cursor: 'copy' }} onClick={() => p.onWire!(w.id)} data-testid={`wire-${w.id}`}>
            <title>{`${w.label ?? w.id} — ${w.from} → ${w.to}`}</title>
          </polyline>
        )}
        {p.clampWire === w.id && <polyline points={pts(path)} fill="none" stroke="var(--amber)" strokeWidth={c.width + 6} opacity={0.45} pointerEvents="none" />}
        {w.junctions?.map((j, i) => <circle key={i} cx={j[0]} cy={j[1]} r={3.4} fill={open ? 'var(--bad)' : c.stroke} />)}
        {w.label && (
          <text x={(mid[0] + mid2[0]) / 2 + 3} y={(mid[1] + mid2[1]) / 2 - 3} className="wire-label">
            {w.label}
          </text>
        )}
      </g>
    );
  });

  const partEls = def.components.flatMap((c) => {
    const type = LIBRARY[c.type]!;
    const state = m.state<Record<string, unknown>>(c.id);
    const comp = m.component(c.id);
    return Object.entries(c.parts).map(([part, place]) => {
      const draw = SYMBOLS[type.parts[part]!.symbol];
      if (!draw) return null;
      const interactive = !p.readOnly;
      const handlers: Record<string, unknown> = {};
      let cursor: string | undefined;
      if (interactive && c.type === 'pushbutton') {
        cursor = 'pointer';
        handlers.onPointerDown = (e: React.PointerEvent) => {
          e.preventDefault();
          if (comp.params.kind === 'mushroom' || comp.params.kind === 'toggle') p.onPress(c.id);
          else {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            p.onPress(c.id);
          }
        };
        if (comp.params.kind !== 'mushroom' && comp.params.kind !== 'toggle') {
          handlers.onPointerUp = () => p.onRelease(c.id);
          handlers.onPointerCancel = () => p.onRelease(c.id);
        }
      } else if (interactive && c.type === 'disconnect3') {
        cursor = 'pointer';
        handlers.onClick = () => p.onToggleDisconnect(c.id);
      } else if (interactive && c.type === 'overload' && part === 'nc') {
        cursor = 'pointer';
        handlers.onClick = () => p.onResetOverload(c.id);
      }
      const rot = place.rot ?? 0;
      const tag = c.tag ?? c.id;
      const title = loc(c.label);
      return (
        <g
          key={`${c.id}.${part}`}
          transform={`translate(${place.at[0]} ${place.at[1]}) rotate(${rot})`}
          className={`part part-${c.type} ${hl.has(c.id) ? 'hl' : ''}`}
          data-testid={`part-${c.id}${part === 'main' ? '' : '-' + part}`}
          style={{ cursor }}
          {...handlers}
        >
          {title && <title>{`${tag} — ${title}`}</title>}
          {/* invisible hit area so thin symbols are easy to click */}
          <rect x={-8} y={-38} width={rot % 180 === 0 ? 130 : 70} height={rot % 180 === 0 ? 96 : 90} fill="transparent" pointerEvents={interactive && cursor ? 'all' : 'none'} />
          <g transform={rot ? `rotate(${-rot})` : undefined} style={{ display: 'none' }} />
          <g>{draw({ tag, state, params: comp.params, part, faults: comp.faults })}</g>
        </g>
      );
    });
  });

  const terminalEls = p.readOnly
    ? null
    : m.terminals().map((ref) => {
        const pos = m.terminalPosition(ref);
        if (!pos) return null;
        const isRed = p.probes.red === ref;
        const isBlack = p.probes.black === ref;
        return (
          <g key={ref} className={`terminal ${isRed ? 'red' : ''} ${isBlack ? 'black' : ''}`} data-terminal={ref} onClick={() => p.onProbe(ref)}>
            <title>{ref}</title>
            <circle cx={pos[0]} cy={pos[1]} r={9} fill="transparent" />
            <circle cx={pos[0]} cy={pos[1]} r={isRed || isBlack ? 6 : 3.6} className="term-dot" />
          </g>
        );
      });

  const notes = (def.notes ?? []).map((n, i) => (
    <text key={i} x={n.at[0]} y={n.at[1]} className="note" fontSize={n.size ?? 12}>
      {loc(n.text)}
    </text>
  ));

  return (
    <svg className="schematic" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={loc(def.title)} preserveAspectRatio="xMidYMin meet">
      <rect x={0} y={0} width={W} height={H} className="sheet" />
      {notes}
      <g>{wireEls}</g>
      <g>{partEls}</g>
      <g>{terminalEls}</g>
    </svg>
  );
}

export const Schematic = memo(SchematicImpl);
