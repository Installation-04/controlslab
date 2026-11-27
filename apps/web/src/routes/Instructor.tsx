// SPDX-License-Identifier: AGPL-3.0-only
import { checkScenario, newClassCode, newClassFile, parseReport, summarizeClass, verifyOrderProgram, type ClassFile, type LearnerRow, type ReportFile } from '@controlslab/content';
import type { EntityDef } from '@controlslab/factory';
import { useMemo, useState } from 'react';
import { machineById, useRegistry } from '../content';
import { useT } from '../i18n';
import type { StringKey } from '../strings';
import { instructorActions, useInstructor } from '../store/classroom';
import { download } from './ClassSection';

type Kind = keyof ClassFile['assigned'];
const KINDS: Kind[] = ['lessons', 'workorders', 'checkpoints', 'scenarios'];
const fmt = (ms: number) => new Date(ms).toLocaleDateString('fr-CA');

interface Verdict {
  passed: boolean;
  lines: string[];
}

export function InstructorPage() {
  const { t, loc, lang } = useT();
  const reg = useRegistry();
  const st = useInstructor();
  const cls = st.classes.find((c) => c.code === st.current);
  const reports = cls ? (st.reports[cls.code] ?? []) : [];
  const summary = useMemo(() => (cls ? summarizeClass(cls, reports) : null), [cls, reports]);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [shown, setShown] = useState<string | null>(null);

  const items: Record<Kind, Array<{ id: string; label: string }>> = {
    lessons: reg.lessons.map((l) => ({ id: l.id, label: `${l.order}. ${loc(l.title)}` })),
    workorders: reg.workorders.map((w) => ({ id: w.id, label: `${w.number} — ${loc(w.title)}` })),
    checkpoints: reg.checkpoints.map((c) => ({ id: c.id, label: loc(c.title) })),
    scenarios: reg.scenarios.map((s) => ({ id: s.id, label: `${s.number} — ${loc(s.title)}` })),
  };
  const labelOf = (kind: Kind, id: string) => items[kind].find((i) => i.id === id)?.label ?? id;

  const update = (patch: Partial<ClassFile>) => cls && instructorActions.saveClass({ ...cls, ...patch });
  const toggle = (kind: Kind, id: string) => {
    if (!cls) return;
    const cur = cls.assigned[kind];
    update({ assigned: { ...cls.assigned, [kind]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } });
  };

  const onReports = async (files: FileList | null) => {
    if (!files || !cls) return;
    let added = 0;
    const errors: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const r = parseReport(await f.text());
        added += instructorActions.addReports(cls.code, [r]);
      } catch (e) {
        errors.push(`${f.name} : ${(e as Error).message}`);
      }
    }
    setNotice([t('ins.imported', { n: added }), ...errors].join(' · '));
  };

  const replay = (report: ReportFile, key: string) => {
    const prog = report.programs[key]!;
    const [kind, id] = key.split(':') as ['order' | 'scenario', string];
    let verdict: Verdict;
    if (kind === 'order') {
      const order = reg.workorders.find((w) => w.id === id);
      const def = order && machineById(order.machine);
      if (!order || !def) verdict = { passed: false, lines: [id] };
      else {
        const v = verifyOrderProgram(order, def, prog.source, lang);
        verdict = { passed: v.passed, lines: v.tests.map((x) => `${x.pass ? '✓' : '✗'} ${x.id}${x.loadError ? ` — ${x.loadError}` : x.failures.length ? ` — ${x.failures.join(' | ')}` : ''}`) };
      }
    } else {
      const sc = reg.scenarios.find((s) => s.id === id);
      if (!sc) verdict = { passed: false, lines: [id] };
      else {
        const machines = Object.fromEntries(reg.machines.map((m) => [m.id, m]));
        const r = checkScenario(sc, sc.entities as EntityDef[], machines, prog.source, lang);
        verdict = { passed: r.passed, lines: r.tests.map((x) => `${x.pass ? '✓' : '✗'} ${x.id}${x.loadError ? ` — ${x.loadError}` : x.failures.length ? ` — ${x.failures.join(' | ')}` : ''}`) };
      }
    }
    setVerdicts((v) => ({ ...v, [`${report.learner.id}:${key}`]: verdict }));
  };

  const row: LearnerRow | undefined = summary?.rows.find((r) => r.id === detail);
  const rowReport = row && reports.filter((r) => r.learner.id === row.id).sort((a, b) => b.createdAt - a.createdAt)[0];
  const cols = cls ? [...cls.assigned.workorders, ...cls.assigned.scenarios] : [];

  return (
    <main className="page wide instructor">
      <h1>{t('ins.title')}</h1>
      <p className="muted">{t('ins.intro')}</p>

      <section className="panel no-print">
        <h3>{t('ins.newclass')}</h3>
        <div className="row">
          <label className="field inline">
            <span>{t('ins.classname')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-testid="ins-name" />
          </label>
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={() => {
              instructorActions.saveClass(newClassFile({ name, code: newClassCode() }));
              setName('');
              setDetail(null);
            }}
            data-testid="ins-create"
          >
            {t('ins.create')}
          </button>
        </div>
        {st.classes.length > 0 && (
          <label className="field inline">
            <span>{t('class.active')}</span>
            <select value={st.current ?? ''} onChange={(e) => instructorActions.select(e.target.value || null)} data-testid="ins-select">
              {st.classes.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
            </select>
          </label>
        )}
      </section>

      {!cls && <p className="muted">{t('ins.empty')}</p>}

      {cls && (
        <>
          <section className="panel no-print" data-testid="ins-class">
            <h3>{cls.name} — <code data-testid="ins-code">{cls.code}</code></h3>
            <label className="field">
              <span>{t('ins.note')}</span>
              <textarea value={cls.note ?? ''} rows={2} maxLength={2000} onChange={(e) => update({ note: e.target.value || undefined })} />
            </label>
            <h4>{t('ins.assign')}</h4>
            <div className="assign-grid">
              {KINDS.map((kind) => (
                <fieldset key={kind}>
                  <legend>{t(`ins.assign.${kind}` as StringKey)}</legend>
                  {items[kind].map((i) => (
                    <label key={i.id} className="check">
                      <input type="checkbox" checked={cls.assigned[kind].includes(i.id)} onChange={() => toggle(kind, i.id)} data-testid={`assign-${i.id}`} /> {i.label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <div className="row">
              <button className="primary" onClick={() => download(`classe-${cls.code}.json`, JSON.stringify(cls, null, 2))} data-testid="ins-export">{t('ins.exportclass')}</button>
              <button className="ghost danger" onClick={() => window.confirm(t('ins.confirmdelete')) && instructorActions.deleteClass(cls.code)}>{t('ins.delete')}</button>
            </div>
          </section>

          <section className="panel" data-testid="ins-reports">
            <h3>{t('ins.reports')}</h3>
            <div className="row no-print">
              <label className="ghost filebtn">
                {t('ins.importreports')}
                <input type="file" accept=".json,application/json" multiple hidden onChange={(e) => void onReports(e.target.files)} data-testid="ins-import" />
              </label>
              {reports.length > 0 && <button className="ghost danger" onClick={() => instructorActions.clearReports(cls.code)}>{t('ins.clearreports')}</button>}
            </div>
            {notice && <p className="alert" role="status" data-testid="ins-notice">{notice}</p>}
            <p className="muted small">{t('ins.declared')}</p>
            {!summary || summary.rows.length === 0 ? (
              <p className="muted">{t('ins.noreports')}</p>
            ) : (
              <>
                <p data-testid="ins-finished"><strong>{t('ins.finished', { n: summary.finished, total: summary.rows.length })}</strong></p>
                <div className="table-wrap">
                  <table className="record-table class-table" data-testid="ins-table">
                    <thead>
                      <tr>
                        <th>{t('ins.col.learner')}</th>
                        <th>{t('ins.col.progress')}</th>
                        {cols.map((id) => <th key={id} title={labelOf(id.startsWith('sc-') ? 'scenarios' : 'workorders', id)}>{id.replace(/^(wo|sc)-(\d+).*/, '$1-$2')}</th>)}
                        {cls.assigned.checkpoints.map((id) => <th key={id}>{id.split('-')[0]}</th>)}
                        <th>{t('ins.col.lessons')}</th>
                        <th>{t('ins.col.safety')}</th>
                        <th>{t('ins.col.measures')}</th>
                        <th>{t('ins.col.date')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {summary.rows.map((r) => (
                        <tr key={r.id} data-testid={`ins-row-${r.name}`}>
                          <td>{r.name}{r.foreignClass && <i className="tag bad" title={t('ins.foreign')}> ⚠</i>}</td>
                          <td><strong>{r.assignedDone}/{r.assignedTotal}</strong></td>
                          {cols.map((id) => (
                            <td key={id} className={`st-${r.orders[id]}`} title={t(`ins.status.${r.orders[id]}` as StringKey)}>{r.orders[id] === 'passed' ? '✓' : r.orders[id] === 'attempted' ? '…' : '—'}</td>
                          ))}
                          {cls.assigned.checkpoints.map((id) => <td key={id}>{r.checkpointBest[id] === null ? '—' : `${r.checkpointBest[id]} %`}</td>)}
                          <td>{r.lessonsDone}/{cls.assigned.lessons.length}</td>
                          <td className={r.violations ? 'bad' : ''}>{r.violations}</td>
                          <td>{r.measures}</td>
                          <td>{fmt(r.reportAt)}</td>
                          <td className="no-print"><button className="ghost" onClick={() => setDetail(detail === r.id ? null : r.id)} data-testid={`ins-detail-${r.name}`}>{t('ins.detail')}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          {row && rowReport && (
            <section className="panel" data-testid="ins-learner">
              <h3>{row.name}</h3>
              <h4>{t('ins.violations')}</h4>
              {row.violations === 0 ? (
                <p className="muted">{t('ins.noviolation')}</p>
              ) : (
                <ul>
                  {Object.entries(row.violationsByCode).map(([code, n]) => <li key={code}>{t(`viol.${code}` as StringKey)} — {n}</li>)}
                </ul>
              )}
              <h4>{t('ins.programs')}</h4>
              {Object.keys(rowReport.programs).length === 0 ? (
                <p className="muted">{t('ins.noprograms')}</p>
              ) : (
                Object.entries(rowReport.programs).map(([key, prog]) => {
                  const v = verdicts[`${rowReport.learner.id}:${key}`];
                  const [kind, id] = key.split(':') as ['order' | 'scenario', string];
                  return (
                    <div key={key} className="program-card" data-testid={`ins-prog-${key}`}>
                      <p>
                        <strong>{labelOf(kind === 'order' ? 'workorders' : 'scenarios', id)}</strong> ({prog.lang.toUpperCase()}){' '}
                        <button className="ghost" onClick={() => replay(rowReport, key)} data-testid={`ins-replay-${key}`}>{t('ins.replay')}</button>{' '}
                        <button className="ghost" onClick={() => setShown(shown === key ? null : key)}>{t('ins.showcode')}</button>
                        {v && <b className={v.passed ? 'ok' : 'bad'} data-testid={`ins-verdict-${key}`}> {v.passed ? t('ins.replay.pass') : t('ins.replay.fail')}</b>}
                      </p>
                      {v && <ul className="small">{v.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
                      {shown === key && <pre className="code-view">{prog.source}</pre>}
                    </div>
                  );
                })
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
