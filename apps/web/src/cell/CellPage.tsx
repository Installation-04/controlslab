// SPDX-License-Identifier: AGPL-3.0-only
import { checkScenario, EntitySchema, type Scenario, type ScenarioResult } from '@controlslab/content';
import { SPECS, generateDeclarations, newId, nextAddress, validateCell, defaultParams, type EntityDef, type EntityType } from '@controlslab/factory';
import type { MachineDef } from '@controlslab/sim';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { useRegistry } from '../content';
import { useT } from '../i18n';
import { PanelWorkbench } from '../lab/PanelWorkbench';
import { PlcStatusPanel } from '../lab/Panels';
import { StEditor } from '../lab/StEditor';
import { actions, getProgress, useProgress } from '../store/progress';
import { checkStSource, download, pickFile } from '../store/transfer';
import { Inspector, issueText } from './Inspector';
import { CellView3D, snap, type ViewCallbacks } from './scene3d';
import { mergeDeclarations } from './st';
import { useCellRuntime } from './useCell';

const PALETTE: EntityType[] = ['conveyor', 'spawner', 'photo', 'prox', 'pusher', 'button', 'light', 'stacklight', 'bin'];
const DND_MIME = 'text/plain';
const DND_PREFIX = 'controlslab-entity:';

const FREE_ENTITIES: EntityDef[] = [
  { id: 'PN1', type: 'panel', x: -1.6, z: -1.7, rot: 0, params: { machine: 'motor-starter-plc' }, name: 'Panneau de commande' },
  { id: 'CV1', type: 'conveyor', x: 0, z: 0, rot: 0, params: { length: 3, drive: 'panel' } },
  { id: 'SP1', type: 'spawner', x: -1.2, z: 0, rot: 0, params: { intervalMs: 3000, max: 10, pattern: 'plastic,metal' } },
  { id: 'BN1', type: 'bin', x: 1.65, z: 0, rot: 0, params: { size: 0.7 } },
];

const FREE_STARTER = `PROGRAM Main
VAR
    Marche       AT %IX0.0 : BOOL;   (* panneau : MARCHE *)
    Arret        AT %IX0.1 : BOOL;   (* panneau : ARRÊT, NF *)
    Surcharge    AT %IX0.2 : BOOL;
    AU_OK        AT %IX0.3 : BOOL;
    RetourM      AT %IX0.4 : BOOL;
    BobineM      AT %QX0.0 : BOOL;   (* bobine du contacteur → moteur du convoyeur *)
    VoyantMarche AT %QX0.1 : BOOL;
END_VAR

BobineM := (Marche OR BobineM) AND Arret AND NOT Surcharge AND AU_OK;
VoyantMarche := RetourM;

END_PROGRAM
`;

const LayoutSchema = z.array(EntitySchema);
const layoutKey = (id: string) => `cell-layout:${id}`;
const progKey = (id: string) => `cell-prog:${id}`;

function loadLayout(id: string, fallback: EntityDef[]): EntityDef[] {
  const raw = getProgress().programs[layoutKey(id)];
  if (!raw) return structuredClone(fallback);
  try {
    const r = LayoutSchema.safeParse(JSON.parse(raw));
    return r.success ? (r.data as EntityDef[]) : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

const CellFile = z.object({ app: z.literal('controlslab'), kind: z.literal('cell'), v: z.literal(1), scenario: z.string(), entities: LayoutSchema, program: z.string().max(200_000) });

// ---------------- List ----------------
export function CellsList() {
  const { t, loc } = useT();
  const reg = useRegistry();
  const progress = useProgress();
  return (
    <main className="page">
      <h1>{t('cell.list.title')}</h1>
      <p className="lead">{t('cell.list.intro')}</p>
      <ul className="cards">
        {reg.scenarios.map((s) => (
          <li key={s.id} className={`card ${progress.orders[s.id]?.passed ? 'done' : ''}`}>
            <Link to={`/cells/${s.id}`}>
              <span className="num small">{s.number}</span>
              <span className="body">
                <strong>{loc(s.title)}</strong>
                <span className="muted">{loc(s.complaint)}</span>
                <span className="meta">{progress.orders[s.id]?.passed ? <b className="ok">✓ {t('wo.status.passed')}</b> : t('wo.status.todo')}</span>
              </span>
            </Link>
          </li>
        ))}
        <li className="card">
          <Link to="/cells/free" data-testid="cell-free">
            <span className="num small">∞</span>
            <span className="body">
              <strong>{t('cell.free')}</strong>
              <span className="muted">{t('cell.free.desc')}</span>
            </span>
          </Link>
        </li>
      </ul>
    </main>
  );
}

// ---------------- Page ----------------
export function CellPage() {
  const { id = 'free' } = useParams();
  const reg = useRegistry();
  const scenario = id === 'free' ? undefined : reg.scenarios.find((s) => s.id === id);
  if (id !== 'free' && !scenario) return <main className="page"><p>Scénario introuvable. <Link to="/cells">←</Link></p></main>;
  return <CellEditor key={id} id={id} scenario={scenario} />;
}

function CellEditor({ id, scenario }: { id: string; scenario?: Scenario }) {
  const { t, loc, lang } = useT();
  const reg = useRegistry();
  const progress = useProgress();
  const machines = useMemo(() => Object.fromEntries(reg.machines.map((m) => [m.id, m])), [reg.machines]);
  const panelMachines = useMemo(() => reg.machines.filter((m) => m.mode === 'plc'), [reg.machines]);
  const defaults = scenario ? (scenario.entities as EntityDef[]) : FREE_ENTITIES;
  const [entities, setEntities] = useState<EntityDef[]>(() => loadLayout(id, defaults));
  const [selected, setSelected] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [hints, setHints] = useState(0);
  const [webgl, setWebgl] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<CellView3D | null>(null);

  const source = progress.programs[progKey(id)] ?? scenario?.plc.starter ?? FREE_STARTER;
  const rt = useCellRuntime(entities, machines, scenario?.faults);
  const panelEntity = entities.find((e) => e.type === 'panel');
  const panelDef: MachineDef | undefined = panelEntity ? machines[String(panelEntity.params?.machine ?? 'motor-starter-plc')] : undefined;
  const issues = useMemo(() => validateCell(entities, panelDef), [entities, panelDef]);
  const errors = issues.filter((i) => i.level === 'error');
  const editable = !rt.running && (scenario?.editable ?? true);

  // Test/debug hook (read-only access to the running cell).
  useEffect(() => {
    (window as unknown as { __cellCore?: unknown }).__cellCore = rt.core;
  }, [rt.core]);

  // Persist the layout.
  useEffect(() => {
    actions.saveProgram(layoutKey(id), JSON.stringify(entities));
  }, [entities, id]);

  const update = useCallback((e: EntityDef) => setEntities((list) => list.map((x) => (x.id === e.id ? e : x))), []);

  const addEntity = useCallback(
    (type: EntityType, at?: { x: number; z: number }, machine?: string) => {
      setEntities((list) => {
        if (type === 'panel' && list.some((e) => e.type === 'panel')) return list;
        const idNew = newId(type, list.map((e) => e.id));
        const pd = machine ? machines[machine] : panelDef;
        let x = at ? snap(at.x) : 0;
        const z = at ? snap(at.z) : 1.5;
        if (!at) while (list.some((e) => Math.abs(e.x - x) < 0.3 && Math.abs(e.z - z) < 0.3)) x += 0.5;
        const draft: EntityDef = { id: idNew, type, x, z, rot: 0, params: type === 'panel' ? { machine: machine ?? 'motor-starter-plc' } : { ...defaultParams(type) }, io: {} };
        const io: Record<string, string> = {};
        const tmp = [...list];
        for (const s of SPECS[type].signals) {
          io[s.name] = nextAddress(tmp, s.dir === 'input' ? 'I' : 'Q', pd);
          tmp.push({ ...draft, io: { ...io } });
        }
        draft.io = io;
        setSelected(idNew);
        return [...list, draft];
      });
    },
    [machines, panelDef],
  );

  const remove = useCallback((rid: string) => {
    setEntities((list) => list.filter((e) => e.id !== rid || e.locked));
    setSelected((s) => (s === rid ? null : s));
  }, []);

  // --- 3D view lifecycle ---
  const cb = useRef<ViewCallbacks>({ onSelect() {}, onMove() {}, onPress() {}, onRelease() {}, onOpenPanel() {} });
  cb.current = {
    onSelect: setSelected,
    onMove: (mid, x, z) => setEntities((list) => list.map((e) => (e.id === mid ? { ...e, x, z } : e))),
    onPress: (bid) => {
      rt.core.factory.press(bid);
      rt.refresh();
    },
    onRelease: (bid) => rt.core.factory.release(bid),
    onOpenPanel: () => setDrawer(true),
  };
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const frameRef = useRef(rt.frame);
  frameRef.current = rt.frame;
  useEffect(() => {
    if (!host.current) return;
    try {
      const v = new CellView3D(
        host.current,
        {
          onSelect: (x) => cb.current.onSelect(x),
          onMove: (a, x, z) => cb.current.onMove(a, x, z),
          onPress: (x) => cb.current.onPress(x),
          onRelease: (x) => cb.current.onRelease(x),
          onOpenPanel: (x) => cb.current.onOpenPanel(x),
        },
        () => frameRef.current(),
      );
      view.current = v;
      v.setEntities(entitiesRef.current);
      v.frameAll(entitiesRef.current);
      (window as unknown as { __cellView?: CellView3D }).__cellView = v;
      return () => {
        v.dispose();
        view.current = null;
      };
    } catch {
      setWebgl(false);
      return undefined;
    }
  }, []);
  useEffect(() => view.current?.setEntities(entities), [entities]);
  useEffect(() => view.current?.setSelected(selected), [selected, entities]);
  useEffect(() => view.current?.setEditable(!rt.running), [rt.running]);

  // --- drag & drop from the palette ---
  const onDrop = (ev: React.DragEvent) => {
    ev.preventDefault();
    const data = ev.dataTransfer.getData(DND_MIME);
    if (!data.startsWith(DND_PREFIX) || !editable) return;
    const [type, machine] = data.slice(DND_PREFIX.length).split('@');
    const p = view.current?.screenToFloor(ev.clientX, ev.clientY);
    if (p) addEntity(type as EntityType, p, machine);
  };

  // --- keyboard ---
  const onKey = (ev: React.KeyboardEvent) => {
    const target = ev.target as HTMLElement;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || !editable || !selected) return;
    const e = entities.find((x) => x.id === selected);
    if (!e || e.locked) return;
    if (ev.key === 'r' || ev.key === 'R') update({ ...e, rot: ((e.rot + 90) % 360) as EntityDef['rot'] });
    else if (ev.key === 'Delete' || ev.key === 'Backspace') remove(e.id);
    else if (ev.key.startsWith('Arrow')) {
      const d = 0.25;
      update({ ...e, x: e.x + (ev.key === 'ArrowRight' ? d : ev.key === 'ArrowLeft' ? -d : 0), z: e.z + (ev.key === 'ArrowDown' ? d : ev.key === 'ArrowUp' ? -d : 0) });
      ev.preventDefault();
    }
  };

  const run = () => {
    if (errors.length) {
      setNotice(t('cell.errors.blocking'));
      return;
    }
    setNotice(null);
    setResult(null);
    rt.start(source);
  };

  const check = () => {
    if (!scenario) return;
    setBusy(true);
    setTimeout(() => {
      const r = checkScenario(scenario, entities, machines, source);
      setResult(r);
      actions.recordOrder(scenario.id, r.passed);
      setBusy(false);
    }, 30);
  };

  const selEntity = entities.find((e) => e.id === selected);
  const f = rt.core.factory;
  const hasPanel = !!panelEntity;

  if (!webgl) return <main className="page"><p className="alert bad">{t('cell.nowebgl')}</p></main>;

  return (
    <main className="page wide cell" onKeyDown={onKey}>
      <p className="crumb"><Link to="/cells">{t('nav.cells')}</Link> › {scenario ? scenario.number : t('cell.free')}</p>
      {scenario && (
        <section className="order">
          <div className="order-head">
            <div>
              <span className="num small">{scenario.number}</span>
              <h1>{loc(scenario.title)}</h1>
              <p><strong>{t('wo.complaint')} :</strong> {loc(scenario.complaint)}</p>
              {scenario.context && <p className="muted">{loc(scenario.context)}</p>}
            </div>
            {progress.orders[scenario.id]?.passed && <span className="stamp">✓ {t('wo.status.passed')}</span>}
          </div>
          <div className="order-cols">
            <div>
              <h3>{t('wo.objectives')}</h3>
              <ul className="objectives-list" data-testid="objectives">
                {scenario.objectives.map((o, i) => {
                  const r = result?.objectives[i];
                  return (
                    <li key={i} className={r ? (r.pass ? 'pass' : 'fail') : ''}>
                      <span className="badge" aria-hidden>{r ? (r.pass ? '✓' : '✗') : '○'}</span>
                      <span>{loc(o.label)}{r && !r.pass && r.detail && <small className="detail"> — {r.detail}</small>}</span>
                    </li>
                  );
                })}
              </ul>
              <button className="primary" onClick={check} disabled={busy} data-testid="check">{t('wo.check')}</button>
              {busy && <p className="muted small">{t('cell.checking')}</p>}
              {result && <p className={`alert ${result.passed ? 'ok' : 'bad'}`} role="status">{result.passed ? t('wo.passed') : t('wo.notyet')}</p>}
            </div>
            {scenario.hints.length > 0 && (
              <div className="hints">
                <h3>{t('wo.hints')}</h3>
                <ol>{scenario.hints.slice(0, hints).map((h, i) => <li key={i}>{loc(h)}</li>)}</ol>
                {hints < scenario.hints.length && <button className="small" onClick={() => setHints(hints + 1)} data-testid="hint">{t('wo.showhint')}</button>}
              </div>
            )}
          </div>
        </section>
      )}
      {!scenario && <h1>{t('cell.free')}</h1>}

      <div className="cell-toolbar">
        {!rt.running ? (
          <button className="primary" onClick={run} data-testid="cell-run">▶ {t('cell.run')}</button>
        ) : (
          <button onClick={rt.stop} data-testid="cell-stop">⏹ {t('cell.stop')}</button>
        )}
        <button onClick={rt.reset} data-testid="cell-reset">↺ {t('cell.reset')}</button>
        <button onClick={() => setDrawer(true)} disabled={!hasPanel} data-testid="cell-open-panel">⚡ {t('cell.openpanel')}</button>
        <span className="muted small" data-testid="cell-stats">{t('cell.items', { spawned: f.spawned, lost: f.lost })}</span>
        <span className="spacer" />
        <button
          className="small"
          onClick={() => download(`controlslab-cell-${id}.json`, JSON.stringify({ app: 'controlslab', kind: 'cell', v: 1, scenario: id, entities, program: source }, null, 2), 'application/json')}
        >
          {t('cell.export')}
        </button>
        <button
          className="small"
          onClick={async () => {
            const file = await pickFile('.json,application/json');
            if (!file) return;
            try {
              const parsed = CellFile.parse(JSON.parse(file.text));
              setEntities(parsed.entities as EntityDef[]);
              actions.saveProgram(progKey(id), parsed.program);
              setNotice(t('data.ok'));
            } catch (e) {
              setNotice(`Fichier invalide : ${(e as Error).message.slice(0, 120)}`);
            }
          }}
        >
          {t('cell.import')}
        </button>
        {scenario && <button className="small ghost" disabled={rt.running} onClick={() => setEntities(structuredClone(defaults))}>{t('cell.layout.reset')}</button>}
      </div>
      {notice && <p className="alert" role="status">{notice}</p>}

      <div className="cell-grid">
        <aside className="palette panel" aria-label={t('cell.palette')}>
          <h3>{t('cell.palette')}</h3>
          <p className="muted small">{t('cell.palette.hint')}</p>
          <ul>
            {PALETTE.map((type) => (
              <li key={type}>
                <div
                  className="pal-item"
                  draggable={editable}
                  data-testid={`pal-${type}`}
                  onDragStart={(ev) => ev.dataTransfer.setData(DND_MIME, DND_PREFIX + type)}
                >
                  <span>{loc(SPECS[type].label)}</span>
                  <button className="small" disabled={!editable} onClick={() => addEntity(type)} data-testid={`add-${type}`}>{t('cell.add')}</button>
                </div>
              </li>
            ))}
            {panelMachines.map((m) => (
              <li key={m.id}>
                <div
                  className="pal-item panel-item"
                  draggable={editable && !hasPanel}
                  data-testid={`pal-panel-${m.id}`}
                  title={hasPanel ? t('cell.panel.only1') : undefined}
                  onDragStart={(ev) => ev.dataTransfer.setData(DND_MIME, `${DND_PREFIX}panel@${m.id}`)}
                >
                  <span>⚡ {loc(m.title)}</span>
                  <button className="small" disabled={!editable || hasPanel} onClick={() => addEntity('panel', undefined, m.id)}>{t('cell.add')}</button>
                </div>
              </li>
            ))}
          </ul>
          <p className="muted small">{t('cell.help')}</p>
        </aside>

        <div
          className="cell-canvas"
          ref={host}
          tabIndex={0}
          data-testid="cell-canvas"
          onDragOver={(ev) => {
            if (editable) ev.preventDefault();
          }}
          onDrop={onDrop}
          aria-label="Scène 3D"
        />

        <div className="cell-side">
          <Inspector
            entity={selEntity}
            entities={entities}
            issues={issues}
            panelDef={panelDef}
            panels={panelMachines}
            readOnly={!editable}
            onChange={update}
            onDelete={remove}
            onOpenPanel={() => setDrawer(true)}
          />
          <section className="panel">
            <h3>{t('cell.issues')}</h3>
            {issues.filter((i) => i.level === 'error' || i.code === 'overlap').length === 0 ? (
              <p className="ok small">{t('cell.issues.ok')}</p>
            ) : (
              <ul className="issues">
                {issues.filter((i) => i.level === 'error' || i.code === 'overlap').map((i, k) => <li key={k} className={i.level}>{issueText(i, lang)}</li>)}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="plc-block">
        <div className="plc-toolbar">
          <h3>{t('plc.title')} — Structured Text</h3>
          <div className="row wrap">
            <button
              className="small"
              data-testid="insert-decl"
              onClick={() => {
                const m = mergeDeclarations(source, generateDeclarations(entities, panelDef));
                actions.saveProgram(progKey(id), m.source);
                setNotice(m.added ? t('cell.decl.done', { n: m.added }) : t('cell.decl.none'));
              }}
            >
              {t('cell.decl')}
            </button>
            <button
              className="small"
              onClick={async () => {
                const file = await pickFile('.st,.txt,text/plain');
                if (!file) return;
                const r = checkStSource(file.text);
                if (r.ok || confirm(`${'message' in r ? r.message : ''}\n\nImporter quand même?`)) actions.saveProgram(progKey(id), file.text);
              }}
            >
              {t('plc.import')}
            </button>
            <button className="small" onClick={() => download(`${id}.st`, source)}>{t('plc.export')}</button>
            <button className="small" onClick={() => actions.saveProgram(progKey(id), scenario?.plc.starter ?? FREE_STARTER)}>{t('plc.starter')}</button>
          </div>
        </div>
        <StEditor
          value={source}
          onChange={(v) => actions.saveProgram(progKey(id), v)}
          errors={rt.plc.errors.filter((e) => e.pos).map((e) => ({ line: e.pos!.line, message: e.message }))}
        />
        <PlcStatusPanel
          status={rt.plc.status}
          errors={rt.plc.errors}
          loaded={rt.plc.loaded}
          ioPoints={rt.plc.ioPoints}
          onLoad={run}
          onStop={rt.stop}
          onReset={rt.reset}
          onJump={() => undefined}
        />
      </section>

      {drawer && hasPanel && (
        <div className="drawer" role="dialog" aria-modal="true" aria-label={t('cell.panel.title')} data-testid="panel-drawer">
          <div className="drawer-inner">
            <div className="drawer-head">
              <h2>{t('cell.panel.title')} — {loc(panelDef?.title)}</h2>
              <button onClick={() => setDrawer(false)} data-testid="close-panel">✕ {t('cell.closepanel')}</button>
            </div>
            {rt.core.machine && <PanelWorkbench machine={rt.core.machine} rev={rt.rev} refresh={rt.refresh} />}
          </div>
        </div>
      )}
    </main>
  );
}
