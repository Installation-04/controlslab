// SPDX-License-Identifier: AGPL-3.0-only
import { checkWorkOrder, type CheckResult, type WorkOrder } from '@controlslab/content';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { machineById, useRegistry } from '../content';
import { useT } from '../i18n';
import { Lab } from '../lab/Lab';
import { getPlcSource, type Starters } from '../store/plc';
import { actions, useProgress } from '../store/progress';

/** Program starters (ST and optional Ladder) declared by a work order. */
export function startersOf(order: WorkOrder): Starters {
  const p = order.plc;
  return { st: p?.starter ?? '', ld: p?.ldStarter as Starters['ld'], languages: p?.languages, defaultLang: p?.defaultLang };
}

export function OrdersList() {
  const { t, loc } = useT();
  const reg = useRegistry();
  const progress = useProgress();
  return (
    <main className="page">
      <h1>{t('wo.list')}</h1>
      <ul className="cards">
        {reg.workorders.map((w) => {
          const st = progress.orders[w.id];
          return (
            <li key={w.id} className={`card ${st?.passed ? 'done' : ''}`}>
              <Link to={`/orders/${w.id}`}>
                <span className="num small">{w.number}</span>
                <span className="body">
                  <strong>{loc(w.title)}</strong>
                  <span className="muted">{loc(w.complaint)}</span>
                  <span className="meta">
                    <b className={`prio ${w.priority}`}>{w.priority}</b> · {st?.passed ? <b className="ok">✓ {t('wo.status.passed')}</b> : t('wo.status.todo')}
                    {reg.local.has(`workorder:${w.id}`) && <i className="tag"> {t('common.local')}</i>}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

export function OrderPage() {
  const { id } = useParams();
  const { t, loc } = useT();
  const reg = useRegistry();
  const order = reg.workorders.find((w) => w.id === id);
  const def = order ? machineById(order.machine) : undefined;
  if (!order || !def) return <main className="page"><p>Bon de travail introuvable. <Link to="/orders">{t('common.back')}</Link></p></main>;
  return (
    <main className="page wide">
      <p className="crumb"><Link to="/orders">{t('nav.workorders')}</Link> › {order.number}</p>
      <Lab
        key={order.id}
        def={def}
        faults={order.faults}
        instructor
        programKey={order.id}
        starters={startersOf(order)}
        showDiagnosis={order.requiresDiagnosis}
        top={(lab) => <OrderHeader order={order} getMachine={() => lab.machine} refresh={lab.refresh} />}
      />
      <span hidden>{loc(order.title)}</span>
    </main>
  );
}

function OrderHeader({ order, getMachine, refresh }: { order: WorkOrder; getMachine(): import('@controlslab/sim').Machine; refresh(): void }) {
  const { t, loc } = useT();
  const progress = useProgress();
  const [result, setResult] = useState<CheckResult | null>(null);
  const [hints, setHints] = useState(0);
  const [busy, setBusy] = useState(false);
  const passed = progress.orders[order.id]?.passed;

  const check = () => {
    setBusy(true);
    // Let the "busy" state paint before the (synchronous) PLC test run.
    setTimeout(() => {
      const machine = getMachine();
      const def = machineById(order.machine)!;
      const r = checkWorkOrder({ order, machine, def, plcSource: order.plc ? getPlcSource(order.id, startersOf(order)) : undefined });
      setResult(r);
      actions.recordOrder(order.id, r.passed);
      setBusy(false);
      refresh();
    }, 30);
  };

  return (
    <section className="order">
      <div className="order-head">
        <div>
          <span className="num small">{order.number}</span>
          <h1>{loc(order.title)}</h1>
          <p><strong>{t('wo.complaint')} :</strong> {loc(order.complaint)}</p>
          {order.context && <p className="muted">{loc(order.context)}</p>}
        </div>
        {passed && <span className="stamp">✓ {t('wo.status.passed')}</span>}
      </div>
      <div className="order-cols">
        <div>
          <h3>{t('wo.objectives')}</h3>
          <ul className="objectives-list" data-testid="objectives">
            {order.objectives.map((o, i) => {
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
          {result && <p className={`alert ${result.passed ? 'ok' : 'bad'}`} role="status">{result.passed ? t('wo.passed') : t('wo.notyet')}</p>}
        </div>
        {order.hints.length > 0 && (
          <div className="hints">
            <h3>{t('wo.hints')}</h3>
            <ol>{order.hints.slice(0, hints).map((h, i) => <li key={i}>{loc(h)}</li>)}</ol>
            {hints < order.hints.length && <button className="small" onClick={() => setHints(hints + 1)} data-testid="hint">{t('wo.showhint')}</button>}
          </div>
        )}
      </div>
    </section>
  );
}
