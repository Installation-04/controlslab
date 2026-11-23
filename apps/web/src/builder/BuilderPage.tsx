// SPDX-License-Identifier: AGPL-3.0-only
import {
  BUILDER_TYPES, LIBRARY, Machine, addComponent, checkStarterBuild, connect, emptyMachine, finalize, moveComponent, removeComponent,
  removeWire, rotateComponent, setParam, setTag, snap, validateBuild, withoutWires,
  type BuildCheckResult, type MachineDef, type Point,
} from '@controlslab/sim';
import { parseContent } from '@controlslab/content';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stringify } from 'yaml';
import { importContent, useRegistry } from '../content';
import { useT } from '../i18n';
import { Lab } from '../lab/Lab';
import { Schematic, route } from '../lab/Schematic';
import type { StringKey } from '../strings';

const KEY = 'controlslab.builder.v1';
const CONTROL_WIRES = ['W30', 'W31', 'W32', 'W33', 'W34', 'W35', 'W36', 'W37'];
const CHALLENGE_BASE = 'motor-starter-3w';
const noop = () => undefined;

const OPTIONS: Record<string, string[]> = {
  contact: ['NO', 'NC'],
  kind: ['momentary', 'mushroom', 'toggle'],
  color: ['green', 'red', 'amber', 'black'],
};

type Selection = { kind: 'part'; id: string } | { kind: 'wire'; id: string } | null;

function load(): MachineDef {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as MachineDef;
  } catch {
    /* ignore */
  }
  return emptyMachine();
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/yaml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function BuilderPage() {
  const { t } = useT();
  const reg = useRegistry();
  const [def, setDef] = useState<MachineDef>(load);
  const [mode, setMode] = useState<'edit' | 'run'>('edit');
  const [armed, setArmed] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(false);
  const [result, setResult] = useState<BuildCheckResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; start: Point; base: MachineDef; moved: boolean } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(def));
    } catch {
      /* storage unavailable */
    }
  }, [def]);

  const final = useMemo(() => finalize(def), [def]);
  const machine = useMemo(() => {
    try {
      return new Machine(final);
    } catch {
      return null;
    }
  }, [final]);
  const issues = useMemo(() => validateBuild(def), [def]);
  const hasError = issues.some((i) => i.level === 'error');

  const edit = useCallback((next: MachineDef) => {
    setDef(next);
    setResult(null);
  }, []);

  const pointOf = (e: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [p.x, p.y];
  };

  const deleteSelection = useCallback(() => {
    if (!selected) return;
    edit(selected.kind === 'part' ? removeComponent(def, selected.id) : removeWire(def, selected.id));
    setSelected(null);
  }, [selected, def, edit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        setPending(null);
        setArmed(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, deleteSelection]);

  const onBackground = (e: React.PointerEvent) => {
    if (armed) {
      const [x, y] = pointOf(e);
      const r = addComponent(def, armed, [snap(x), snap(y)]);
      edit(r.def);
      setSelected({ kind: 'part', id: r.id });
      setArmed(null);
    } else {
      setSelected(null);
      setPending(null);
    }
  };

  const onTerminal = (ref: string) => {
    if (!pending) {
      setPending(ref);
      return;
    }
    const r = connect(def, pending, ref);
    if (r.ok) {
      edit(r.def);
      setSelected({ kind: 'wire', id: r.id });
    }
    setPending(null);
  };

  const startDrag = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (armed) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    drag.current = { id, start: pointOf(e), base: def, moved: false };
    setSelected({ kind: 'part', id });
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = pointOf(e);
    const dx = x - d.start[0];
    const dy = y - d.start[1];
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    setDef(moveComponent(d.base, d.id, snap(dx), snap(dy)));
  };
  const onUp = () => {
    if (drag.current?.moved) setResult(null);
    drag.current = null;
  };

  const loadChallenge = () => {
    const base = reg.machines.find((m) => m.id === CHALLENGE_BASE);
    if (!base) return;
    const d = withoutWires(base, CONTROL_WIRES);
    d.id = 'challenge-starter';
    d.title = t('builder.challenge');
    setDef(d);
    setChallenge(true);
    setResult(null);
    setSelected(null);
    setMode('edit');
  };
  const showSolution = () => {
    const base = reg.machines.find((m) => m.id === CHALLENGE_BASE);
    if (!base) return;
    setDef({ ...structuredClone(base), id: 'challenge-starter', title: t('builder.challenge') });
    setResult(null);
  };
  const newPanel = () => {
    if (def.components.length && !window.confirm(t('builder.confirmnew'))) return;
    setDef(emptyMachine());
    setChallenge(false);
    setSelected(null);
    setResult(null);
  };

  const exportYaml = () => download(`${def.id || 'my-panel'}.yaml`, stringify(finalize(def)));
  const addToLab = () => {
    try {
      importContent(stringify(finalize(def)), def.id);
      setNotice(t('builder.added'));
    } catch (e) {
      setNotice(t('builder.importfail', { msg: (e as Error).message }));
    }
  };
  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const p = parseContent(await file.text());
      if (p.kind !== 'machine') throw new Error('machine?');
      setDef(p.data as MachineDef);
      setChallenge(false);
      setSelected(null);
      setResult(null);
      setNotice(t('builder.imported'));
    } catch (e) {
      setNotice(t('builder.importfail', { msg: (e as Error).message }));
    }
  };

  const selComp = selected?.kind === 'part' ? def.components.find((c) => c.id === selected.id) : undefined;
  const selWire = selected?.kind === 'wire' ? def.wires.find((w) => w.id === selected.id) : undefined;
  const typeName = (type: string) => t(`builder.type.${type}` as StringKey);

  const overlay = (m: Machine) => {
    const parts = def.components.flatMap((c) =>
      Object.keys(c.parts).map((part) => {
        const refs = Object.keys(LIBRARY[c.type]!.parts[part]!.terminals).map((term) => m.terminalPosition(`${c.id}:${term}`)).filter((p): p is Point => !!p);
        const xs = refs.map((p) => p[0]);
        const ys = refs.map((p) => p[1]);
        return { c, part, x: Math.min(...xs) - 16, y: Math.min(...ys) - 42, w: Math.max(...xs) - Math.min(...xs) + 32, h: Math.max(...ys) - Math.min(...ys) + 72 };
      }),
    );
    return (
      <>
        {def.wires.map((w) => {
          const a = m.terminalPosition(w.from);
          const b = m.terminalPosition(w.to);
          if (!a || !b) return null;
          const pts = route(a, b, w.via).map((p) => p.join(',')).join(' ');
          const sel = selected?.kind === 'wire' && selected.id === w.id;
          return (
            <g key={w.id}>
              {sel && <polyline points={pts} fill="none" stroke="var(--amber, #f59f00)" strokeWidth={7} opacity={0.5} pointerEvents="none" />}
              <polyline
                points={pts}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                style={{ cursor: 'pointer' }}
                data-testid={`bw-${w.id}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSelected({ kind: 'wire', id: w.id });
                }}
              >
                <title>{`${w.id}: ${w.from} → ${w.to}`}</title>
              </polyline>
            </g>
          );
        })}
        {parts.map(({ c, part, x, y, w, h }) => {
          const sel = selected?.kind === 'part' && selected.id === c.id;
          return (
            <rect
              key={`${c.id}.${part}`}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={6}
              fill={sel ? 'rgba(47,131,224,.10)' : 'transparent'}
              stroke={sel ? 'var(--accent, #1c7ed6)' : 'none'}
              strokeDasharray="5 4"
              style={{ cursor: armed ? 'crosshair' : 'move' }}
              data-testid={`bp-${c.id}${part === 'main' ? '' : '-' + part}`}
              onPointerDown={(e) => startDrag(e, c.id)}
            />
          );
        })}
        {m.terminals().map((ref) => {
          const p = m.terminalPosition(ref);
          if (!p) return null;
          return (
            <g
              key={ref}
              data-terminal={ref}
              style={{ cursor: 'crosshair' }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onTerminal(ref);
              }}
            >
              <title>{ref}</title>
              <circle cx={p[0]} cy={p[1]} r={9} fill="transparent" />
              <circle cx={p[0]} cy={p[1]} r={pending === ref ? 7 : 3.8} className={`bterm ${pending === ref ? 'pending' : ''}`} />
            </g>
          );
        })}
      </>
    );
  };

  return (
    <main className="page wide builder">
      <h1>{t('builder.title')}</h1>
      <p className="muted">{t('builder.intro')}</p>
      <div className="builder-toolbar no-print">
        <div className="seg" role="group">
          <button className={mode === 'edit' ? 'sel' : ''} onClick={() => setMode('edit')} data-testid="mode-edit">{t('builder.edit')}</button>
          <button className={mode === 'run' ? 'sel' : ''} onClick={() => setMode('run')} disabled={hasError || !def.components.length} data-testid="mode-run">{t('builder.run')}</button>
        </div>
        <button className="ghost" onClick={newPanel} data-testid="builder-new">{t('builder.new')}</button>
        <button className="ghost" onClick={loadChallenge} data-testid="builder-challenge">{t('builder.challenge')}</button>
        <button className="ghost" onClick={exportYaml} disabled={!def.components.length}>{t('builder.export')}</button>
        <label className="ghost filebtn">
          {t('builder.import')}
          <input type="file" accept=".yaml,.yml" hidden onChange={(e) => void onImport(e.target.files?.[0])} />
        </label>
        <button className="ghost" onClick={addToLab} disabled={hasError || !def.components.length}>{t('builder.addlab')}</button>
      </div>
      {notice && <p className="alert" role="status">{notice}</p>}
      {challenge && (
        <section className="panel" data-testid="builder-challenge-panel">
          <h3>{t('builder.challenge')}</h3>
          <p>{t('builder.challenge.intro')}</p>
          <div className="row">
            <button className="primary" onClick={() => setResult(checkStarterBuild(def))} data-testid="builder-check">{t('builder.check')}</button>
            <button className="ghost" onClick={showSolution}>{t('builder.solution')}</button>
          </div>
          {result && (
            <div data-testid="builder-result">
              <p className={result.passed ? 'alert ok' : 'alert bad'}>{result.passed ? t('builder.passed') : t('builder.failed')}</p>
              <ul className="checks">
                {result.steps.map((s) => (
                  <li key={s.id} className={s.pass ? 'pass' : 'fail'} data-testid={`step-${s.id}`}>
                    {s.pass ? '✓' : '✗'} {t(`builder.step.${s.id}` as StringKey)}
                    {s.detail ? <small> — {s.detail}</small> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {mode === 'run' ? (
        hasError ? null : <Lab key={JSON.stringify(final)} def={final} instructor programKey="builder" />
      ) : (
        <div className="builder-layout">
          <aside className="panel palette no-print" aria-label={t('builder.palette')}>
            <h3>{t('builder.palette')}</h3>
            <p className="muted small">{t('builder.palette.hint')}</p>
            <div className="palette-list">
              {BUILDER_TYPES.map((type) => (
                <button key={type} className={`ghost ${armed === type ? 'sel' : ''}`} onClick={() => setArmed(armed === type ? null : type)} data-testid={`palette-${type}`}>
                  {typeName(type)}
                </button>
              ))}
            </div>
            {selComp && (
              <div className="inspector" data-testid="builder-inspector">
                <h4>{t('builder.selected')}: {typeName(selComp.type)}</h4>
                <label className="field">
                  <span>{t('builder.tag')}</span>
                  <input value={selComp.tag ?? selComp.id} onChange={(e) => edit(setTag(def, selComp.id, e.target.value))} />
                </label>
                {Object.entries(LIBRARY[selComp.type]!.defaults ?? {}).map(([k, dv]) => {
                  const cur = selComp.params?.[k] ?? dv;
                  const opts = OPTIONS[k];
                  return (
                    <label className="field" key={k}>
                      <span>{k}</span>
                      {opts && typeof dv === 'string' ? (
                        <select value={String(cur)} onChange={(e) => edit(setParam(def, selComp.id, k, e.target.value))}>
                          {opts.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      ) : typeof dv === 'number' ? (
                        <input type="number" value={Number(cur)} step="any" onChange={(e) => Number.isFinite(e.target.valueAsNumber) && edit(setParam(def, selComp.id, k, e.target.valueAsNumber))} />
                      ) : (
                        <input value={String(cur)} onChange={(e) => edit(setParam(def, selComp.id, k, e.target.value))} />
                      )}
                    </label>
                  );
                })}
                <div className="row">
                  <button className="ghost" onClick={() => edit(rotateComponent(def, selComp.id))}>{t('builder.rotate')}</button>
                  <button className="ghost danger" onClick={deleteSelection} data-testid="builder-delete">{t('builder.delete')}</button>
                </div>
              </div>
            )}
            {selWire && (
              <div className="inspector">
                <p>{t('builder.wire', { id: selWire.id, from: selWire.from, to: selWire.to })}</p>
                <button className="ghost danger" onClick={deleteSelection} data-testid="builder-delete">{t('builder.delete')}</button>
              </div>
            )}
          </aside>
          <section className="builder-main">
            <p className="muted small" role="status" data-testid="builder-status">
              {pending ? t('builder.pending', { ref: pending }) : armed ? t('builder.placing', { name: typeName(armed) }) : t('builder.help')}
            </p>
            {!def.components.length && <p className="muted">{t('builder.empty')}</p>}
            {machine ? (
              <div className="builder-canvas">
                <Schematic machine={machine} rev={0} probes={{}} onProbe={noop} onPress={noop} onRelease={noop} onToggleDisconnect={noop} onResetOverload={noop} readOnly />
                <svg
                  ref={svgRef}
                  className="schematic builder-overlay"
                  viewBox={`0 0 ${final.viewBox[0]} ${final.viewBox[1]}`}
                  preserveAspectRatio="xMidYMin meet"
                  data-testid="builder-overlay"
                  style={{ cursor: armed ? 'crosshair' : 'default' }}
                  onPointerDown={onBackground}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                >
                  {overlay(machine)}
                </svg>
              </div>
            ) : null}
            <ul className="issues" aria-live="polite">
              {issues.map((i) => (
                <li key={i.code} className={i.level}>{t(`builder.issue.${i.code}` as StringKey, { detail: i.detail ?? '' })}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}
