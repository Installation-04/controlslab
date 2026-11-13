// SPDX-License-Identifier: AGPL-3.0-only
/** SVG drawing of one ladder rung, with live power flow. */
import { solveRung, type EdgeState, type Flow, type LogicNode, type Output, type Read, type Rung } from '@controlslab/ladder';
import { useRef } from 'react';

const CW = 96; // cell width
const CH = 64; // cell height
const OUT_W = 150;
const LEFT = 14;

interface Size {
  w: number;
  h: number;
}

function measure(n: LogicNode): Size {
  switch (n.t) {
    case 'contact':
    case 'cmp':
      return { w: 1, h: 1 };
    case 'series': {
      const s = n.items.map(measure);
      return { w: s.reduce((a, b) => a + b.w, 0), h: Math.max(...s.map((x) => x.h)) };
    }
    case 'parallel': {
      const s = n.items.map(measure);
      return { w: Math.max(...s.map((x) => x.w)), h: s.reduce((a, b) => a + b.h, 0) };
    }
  }
}

const COLOR_ON = 'var(--ld-on)';
const COLOR_OFF = 'var(--ld-off)';
const wire = (on: boolean | undefined) => (on ? COLOR_ON : COLOR_OFF);

interface DrawCtx {
  flows: Map<string, Flow> | null;
  selected: string | null;
  onSelect(id: string): void;
  els: JSX.Element[];
  k: number;
}

const flow = (c: DrawCtx, id: string): Flow | undefined => c.flows?.get(id);

function line(c: DrawCtx, x1: number, y1: number, x2: number, y2: number, on: boolean | undefined) {
  c.els.push(<line key={c.k++} x1={x1} y1={y1} x2={x2} y2={y2} stroke={wire(on)} strokeWidth={on ? 3 : 2} />);
}

function symbolLabel(n: Extract<LogicNode, { t: 'contact' | 'cmp' }>) {
  return n.t === 'contact' ? n.v : `${n.a} ${n.op} ${n.b}`;
}

/** Draw `n` inside the box [x, x+cells*CW] × [y, …]; returns the power at the right edge. */
function draw(n: LogicNode, x: number, y: number, cells: number, c: DrawCtx): void {
  const f = flow(c, n.id);
  const cy = y + CH / 2;
  if (n.t === 'contact' || n.t === 'cmp') {
    const cx = x + (cells * CW) / 2;
    const sel = c.selected === n.id;
    const closed = f?.closed;
    line(c, x, cy, cx - 14, cy, f?.in);
    line(c, cx + 14, cy, x + cells * CW, cy, f?.out);
    const stroke = closed ? COLOR_ON : 'var(--ld-sym)';
    c.els.push(
      <g key={c.k++} className={`ld-el ${sel ? 'sel' : ''}`} onClick={(e) => { e.stopPropagation(); c.onSelect(n.id); }} data-testid={`ld-node-${n.id}`}>
        <rect x={cx - 26} y={cy - 30} width={52} height={60} fill="transparent" />
        {sel && <rect x={cx - 28} y={cy - 29} width={56} height={58} className="ld-sel" rx={4} />}
        <line x1={cx - 14} y1={cy - 14} x2={cx - 14} y2={cy + 14} stroke={stroke} strokeWidth={3} />
        <line x1={cx + 14} y1={cy - 14} x2={cx + 14} y2={cy + 14} stroke={stroke} strokeWidth={3} />
        {n.t === 'contact' && n.k === 'NC' && <line x1={cx - 18} y1={cy + 14} x2={cx + 18} y2={cy - 14} stroke={stroke} strokeWidth={2.5} />}
        {n.t === 'contact' && (n.k === 'P' || n.k === 'N') && <text x={cx} y={cy + 5} textAnchor="middle" className="ld-mark">{n.k}</text>}
        {n.t === 'cmp' && <text x={cx} y={cy + 5} textAnchor="middle" className="ld-mark">{n.op}</text>}
        <text x={cx} y={cy - 20} textAnchor="middle" className="ld-label">{symbolLabel(n)}</text>
      </g>,
    );
    return;
  }
  const W = cells * CW;
  if (n.t === 'series') {
    let cx = x;
    n.items.forEach((child, i) => {
      const s = measure(child);
      const extra = i === n.items.length - 1 ? cells - n.items.reduce((a, b) => a + measure(b).w, 0) : 0;
      draw(child, cx, y, s.w + extra, c);
      cx += s.w * CW;
    });
    return;
  }
  // parallel
  let yy = y;
  const rows: number[] = [];
  n.items.forEach((child) => {
    const s = measure(child);
    rows.push(yy + CH / 2);
    draw(child, x, yy, cells, c);
    yy += s.h * CH;
  });
  const top = rows[0]!;
  const bottom = rows[rows.length - 1]!;
  line(c, x, top, x, bottom, f?.in);
  line(c, x + W, top, x + W, bottom, f?.out);
  void cy;
}

function OutputBox({ o, x, y, c, live }: { o: Output; x: number; y: number; c: DrawCtx; live: boolean | undefined }) {
  const sel = c.selected === o.id;
  const cy = y + CH / 2;
  const cx = x + OUT_W / 2;
  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    c.onSelect(o.id);
  };
  if (o.t === 'coil') {
    const letter = o.k === 'set' ? 'S' : o.k === 'reset' ? 'R' : o.k === 'negated' ? '/' : '';
    return (
      <g className={`ld-el ${sel ? 'sel' : ''}`} onClick={click} data-testid={`ld-out-${o.id}`}>
        <rect x={x} y={y + 2} width={OUT_W} height={CH - 4} fill="transparent" />
        {sel && <rect x={cx - 34} y={cy - 30} width={68} height={60} className="ld-sel" rx={4} />}
        <line x1={x} y1={cy} x2={cx - 16} y2={cy} stroke={wire(live)} strokeWidth={live ? 3 : 2} />
        <line x1={cx + 16} y1={cy} x2={x + OUT_W} y2={cy} stroke={wire(live)} strokeWidth={live ? 3 : 2} />
        <circle cx={cx} cy={cy} r={16} fill={live ? 'var(--ld-coil-on)' : 'none'} stroke={live ? COLOR_ON : 'var(--ld-sym)'} strokeWidth={3} />
        <text x={cx} y={cy + 5} textAnchor="middle" className="ld-mark">{letter}</text>
        <text x={cx} y={cy - 22} textAnchor="middle" className="ld-label">{o.v}</text>
      </g>
    );
  }
  const title = o.t === 'timer' ? `${o.fb} ${o.name}` : `${o.fb} ${o.name}`;
  const sub = o.t === 'timer' ? `PT ${o.pt}` : `PV ${o.pv}${o.reset ? ` · R ${o.reset}` : ''}`;
  return (
    <g className={`ld-el ${sel ? 'sel' : ''}`} onClick={click} data-testid={`ld-out-${o.id}`}>
      <rect x={x} y={y + 2} width={OUT_W} height={CH - 4} fill="transparent" />
      <line x1={x} y1={cy} x2={x + 20} y2={cy} stroke={wire(live)} strokeWidth={live ? 3 : 2} />
      <rect x={x + 20} y={y + 6} width={OUT_W - 24} height={CH - 12} rx={4} className={`ld-box ${sel ? 'sel' : ''}`} fill={live ? 'var(--ld-coil-on)' : 'none'} />
      <text x={x + 20 + (OUT_W - 24) / 2} y={y + 25} textAnchor="middle" className="ld-label strong">{title}</text>
      <text x={x + 20 + (OUT_W - 24) / 2} y={y + 42} textAnchor="middle" className="ld-label">{sub}</text>
    </g>
  );
}

export function LadderRung({ rung, index, selected, onSelect, read, selectedRung }: {
  rung: Rung;
  index: number;
  selected: string | null;
  selectedRung: boolean;
  onSelect(id: string | null): void;
  /** Live variable reader (undefined = static drawing). */
  read?: Read;
}) {
  const edges = useRef<EdgeState>({ prev: new Map() });
  const solved = read ? solveRung(rung, read, edges.current) : null;
  const size = rung.logic ? measure(rung.logic) : { w: 1, h: 1 };
  const outs = Math.max(1, rung.outputs.length);
  const rows = Math.max(size.h, outs);
  const logicW = size.w * CW;
  const outX = LEFT + logicW + 16;
  const width = outX + OUT_W + 14;
  const height = rows * CH;
  const c: DrawCtx = { flows: solved?.flows ?? null, selected, onSelect: (id) => onSelect(id), els: [], k: 0 };
  const cy = CH / 2;

  if (rung.logic) draw(rung.logic, LEFT, 0, size.w, c);
  else line(c, LEFT, cy, LEFT + logicW, cy, solved?.power ?? false);
  // connect logic → outputs
  const power = solved ? solved.power : undefined;
  line(c, LEFT + logicW, cy, outX, cy, power);
  const outEls = rung.outputs.map((o, i) => <OutputBox key={o.id} o={o} x={outX} y={i * CH} c={c} live={power} />);
  if (rung.outputs.length > 1) {
    line(c, outX, cy, outX, (rung.outputs.length - 1) * CH + cy, power);
    line(c, outX + OUT_W, cy, outX + OUT_W, (rung.outputs.length - 1) * CH + cy, power);
  }
  return (
    <div className={`ld-rung ${selectedRung ? 'sel' : ''}`} data-testid={`ld-rung-${index + 1}`}>
      <div className="ld-rung-head">
        <b>{index + 1}</b>
        {rung.comment && <span className="muted"> — {rung.comment}</span>}
      </div>
      <svg width={width} height={height + 6} viewBox={`0 0 ${width} ${height + 6}`} className="ld-svg" onClick={() => onSelect(null)} role="img" aria-label={`Échelon ${index + 1}`}>
        <line x1={4} y1={0} x2={4} y2={height} stroke="var(--ld-rail)" strokeWidth={4} />
        <line x1={width - 4} y1={0} x2={width - 4} y2={height} stroke="var(--ld-rail)" strokeWidth={4} />
        <line x1={4} y1={cy} x2={LEFT} y2={cy} stroke={COLOR_ON} strokeWidth={3} />
        {c.els}
        {outEls}
        <line x1={outX + OUT_W} y1={cy} x2={width - 4} y2={cy} stroke={wire(power)} strokeWidth={power ? 3 : 2} />
      </svg>
    </div>
  );
}
