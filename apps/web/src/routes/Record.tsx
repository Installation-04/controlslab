// SPDX-License-Identifier: AGPL-3.0-only
import { useRegistry } from '../content';
import { useT } from '../i18n';
import { actions, useProgress } from '../store/progress';

const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleDateString('fr-CA') : '—');

export function RecordPage() {
  const { t, loc } = useT();
  const reg = useRegistry();
  const p = useProgress();
  return (
    <main className="page record">
      <div className="no-print record-top">
        <h1>{t('record.title')}</h1>
        <button className="primary" onClick={() => window.print()} data-testid="print">{t('record.print')}</button>
      </div>
      <header className="print-only">
        <h1>ControlsLab — {t('record.title')}</h1>
      </header>
      <label className="field">
        <span>{t('record.name')}</span>
        <input value={p.profile.name} maxLength={80} onChange={(e) => actions.setName(e.target.value)} data-testid="record-name" placeholder="Prénom Nom" />
      </label>
      <p className="print-only strong">{p.profile.name}</p>
      <p className="muted small">{new Date().toLocaleDateString('fr-CA')} · {t('record.local')}</p>

      <h2>{t('record.lessons')}</h2>
      <table className="record-table">
        <tbody>
          {reg.lessons.map((l) => {
            const s = p.lessons[l.id];
            const q = s ? Object.values(s.quiz) : [];
            return (
              <tr key={l.id}>
                <td>{l.order}. {loc(l.title)}</td>
                <td>{s?.done ? '✓' : '—'}</td>
                <td className="muted">{q.length ? `${q.filter(Boolean).length}/${q.length} quiz` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>{t('record.orders')}</h2>
      <table className="record-table">
        <tbody>
          {reg.workorders.map((w) => {
            const s = p.orders[w.id];
            return (
              <tr key={w.id}>
                <td>{w.number} — {loc(w.title)}</td>
                <td>{s?.passed ? '✓' : '—'}</td>
                <td className="muted">{s ? `${s.attempts} · ${fmtDate(s.lastAt)}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>{t('record.checkpoints')}</h2>
      {reg.checkpoints.map((c) => {
        const list = p.checkpoints[c.id] ?? [];
        return (
          <div key={c.id}>
            <h4>{loc(c.title)}</h4>
            {list.length === 0 ? <p className="muted">{t('record.none')}</p> : (
              <table className="record-table">
                <thead><tr><th>{t('record.date')}</th><th>{t('record.score')}</th><th /></tr></thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.at}>
                      <td>{fmtDate(a.at)}</td>
                      <td><strong>{a.percent} %</strong> ({a.total}/{a.max})</td>
                      <td className={a.passed ? 'ok' : 'bad'}>{a.passed ? t('cp.pass') : t('cp.fail')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      <p className="disclaimer small">{t('record.disclaimer')}</p>
    </main>
  );
}
