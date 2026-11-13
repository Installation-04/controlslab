// SPDX-License-Identifier: AGPL-3.0-only
import { pickFault, scoreCheckpoint, type Score } from '@controlslab/content';
import type { Machine } from '@controlslab/sim';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { machineById, useRegistry } from '../content';
import { useT } from '../i18n';
import { Lab } from '../lab/Lab';
import { actions, useProgress } from '../store/progress';
import type { StringKey } from '../strings';

export function CheckpointPage() {
  const { t, loc } = useT();
  const reg = useRegistry();
  const progress = useProgress();
  const [cpId, setCpId] = useState<string | null>(null);
  const cp = reg.checkpoints.find((c) => c.id === cpId) ?? reg.checkpoints[0];
  const [run, setRun] = useState<{ fault: string; startedAt: number } | null>(null);
  const [score, setScore] = useState<{ s: Score; fault: string } | null>(null);
  if (!cp) return <main className="page"><p>Aucun point de contrôle.</p></main>;
  const def = machineById(cp.machine);
  if (!def) return <main className="page"><p>Machine introuvable : {cp.machine}</p></main>;
  const attempts = progress.checkpoints[cp.id] ?? [];

  if (score) return <Result score={score.s} fault={score.fault} defId={cp.machine} pass={cp.passScore} onAgain={() => { setScore(null); setRun(null); }} />;

  if (!run) {
    return (
      <main className="page">
        {reg.checkpoints.length > 1 && (
          <div className="seg" role="radiogroup" aria-label={t('nav.checkpoint')} style={{ marginBottom: 12, flexWrap: 'wrap' }}>
            {reg.checkpoints.map((c) => (
              <button key={c.id} role="radio" aria-checked={c.id === cp.id} className={c.id === cp.id ? 'sel' : ''} onClick={() => setCpId(c.id)} data-testid={`cp-pick-${c.id}`}>
                {loc(c.title).replace(/^Point de contrôle \d+ — /, '')}
              </button>
            ))}
          </div>
        )}
        <h1>{loc(cp.title)}</h1>
        <Markdown md={loc(cp.intro)} />
        <p className="alert">{t('cp.nohints')}</p>
        {cp.timeLimitMinutes && <p className="muted">⏱ {cp.timeLimitMinutes} min</p>}
        {attempts.length > 0 && <p className="muted">{t('record.checkpoints')} : {attempts.map((a) => `${a.percent} %`).join(', ')}</p>}
        <button className="primary big" onClick={() => setRun({ fault: pickFault(cp, (Date.now() ^ (Math.random() * 2 ** 31)) >>> 0), startedAt: Date.now() })} data-testid="cp-begin">{t('cp.begin')}</button>
      </main>
    );
  }

  return (
    <main className="page wide">
      <Lab
        key={run.startedAt}
        def={def}
        faults={[run.fault]}
        quietDiagnosis
        top={(lab) => (
          <section className="order cp-bar">
            <div>
              <h1>{loc(cp.title)}</h1>
              <Timer startedAt={run.startedAt} limitMin={cp.timeLimitMinutes} />
            </div>
            <button
              className="primary"
              data-testid="cp-finish"
              onClick={() => {
                if (!confirm(t('cp.confirm'))) return;
                finish(lab.machine, cp, run.fault, setScore);
              }}
            >
              {t('cp.finish')}
            </button>
          </section>
        )}
      />
      <p className="muted small"><Link to="/">{t('common.back')}</Link></p>
    </main>
  );
}

function finish(machine: Machine, cp: NonNullable<ReturnType<typeof useRegistry>['checkpoints'][0]>, fault: string, setScore: (s: { s: Score; fault: string }) => void) {
  const s = scoreCheckpoint(cp, machine);
  actions.recordCheckpoint(cp.id, { at: Date.now(), fault, total: s.total, max: s.max, percent: s.percent, passed: s.passed, lines: s.lines });
  setScore({ s, fault });
}

function Timer({ startedAt, limitMin }: { startedAt: number; limitMin?: number }) {
  const { t } = useT();
  const [now, setNow] = useState(Date.now());
  const ref = useRef<number>();
  useEffect(() => {
    ref.current = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(ref.current);
  }, []);
  const sec = Math.floor((now - startedAt) / 1000);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  const over = limitMin !== undefined && sec > limitMin * 60;
  return <p className={over ? 'bad' : 'muted'}>{t('cp.time')} : <strong>{mm}:{ss}</strong>{limitMin ? ` / ${limitMin}:00` : ''}</p>;
}

function Result({ score, fault, defId, pass, onAgain }: { score: Score; fault: string; defId: string; pass: number; onAgain(): void }) {
  const { t, loc } = useT();
  const faultLabel = loc(machineById(defId)?.faults.find((f) => f.id === fault)?.label) || fault;
  return (
    <main className="page">
      <h1>{t('cp.result')}</h1>
      <div className={`scorecard ${score.passed ? 'pass' : 'fail'}`} data-testid="cp-result">
        <div className="big-score">{score.percent} %</div>
        <div className="verdict">{score.passed ? t('cp.pass') : t('cp.fail')} <small>(≥ {pass} %)</small></div>
      </div>
      <table className="score-table">
        <tbody>
          {score.lines.map((l) => (
            <tr key={l.key}>
              <th>{t(`cp.line.${l.key}` as StringKey)}</th>
              <td>{l.points} / {l.max}</td>
              <td className="muted">{l.notes.join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{t('cp.fault', { fault: faultLabel })}</p>
      <div className="lesson-actions">
        <button className="primary" onClick={onAgain}>{t('cp.again')}</button>
        <Link className="btn" to="/record">{t('nav.record')}</Link>
      </div>
    </main>
  );
}
