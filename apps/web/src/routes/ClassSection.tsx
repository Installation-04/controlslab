// SPDX-License-Identifier: AGPL-3.0-only
import { parseClassFile } from '@controlslab/content';
import { useState } from 'react';
import { useRegistry } from '../content';
import { useT } from '../i18n';
import { activeClass, buildMyReport, learnerActions, useLearner } from '../store/classroom';
import { useProgress } from '../store/progress';

export function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'apprenant';

/** Learner side of the classroom: join a class from a file, export a report for the instructor. */
export function ClassSection() {
  const { t } = useT();
  const reg = useRegistry();
  const progress = useProgress();
  const st = useLearner();
  const [notice, setNotice] = useState<string | null>(null);
  const cls = activeClass(st);
  const named = progress.profile.name.trim().length > 0;

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const c = parseClassFile(await file.text());
      learnerActions.join(c);
      setNotice(t('class.joined', { name: c.name }));
    } catch (e) {
      setNotice(t('class.importfail', { msg: (e as Error).message }));
    }
  };

  const exportReport = () => {
    if (!cls) return;
    const report = buildMyReport(cls, progress, reg, st.learnerId);
    download(`rapport-${cls.code}-${slug(progress.profile.name)}.json`, JSON.stringify(report, null, 2));
  };

  return (
    <section className="class-section no-print" data-testid="class-section">
      <h2>{t('class.title')}</h2>
      <p className="muted">{t('class.intro')}</p>
      <label className="ghost filebtn">
        {t('class.import')}
        <input type="file" accept=".json,application/json" hidden onChange={(e) => void onImport(e.target.files?.[0])} data-testid="class-import" />
      </label>
      {notice && <p className="alert" role="status" data-testid="class-notice">{notice}</p>}
      {st.classes.length === 0 ? (
        <p className="muted">{t('class.none')}</p>
      ) : (
        <>
          <label className="field inline">
            <span>{t('class.active')}</span>
            <select value={st.active ?? ''} onChange={(e) => learnerActions.setActive(e.target.value || null)} data-testid="class-active">
              {st.classes.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
            </select>
          </label>
          {cls && (
            <div className="panel">
              <p>
                <strong>{cls.name}</strong> · {cls.code} ·{' '}
                {t('class.assigned.count', { n: cls.assigned.workorders.length + cls.assigned.checkpoints.length + cls.assigned.scenarios.length + cls.assigned.lessons.length })}
              </p>
              {cls.note && <p className="muted">{cls.note}</p>}
              <div className="row">
                <button className="primary" onClick={exportReport} disabled={!named} data-testid="class-export">{t('class.export')}</button>
                <button className="ghost danger" onClick={() => learnerActions.leave(cls.code)}>{t('class.leave')}</button>
              </div>
              {!named && <p className="muted small">{t('class.needname')}</p>}
              <p className="muted small">{t('class.privacy')}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** "Assigned" badge shown in the lists when the active class asked for the item. */
export function AssignedBadge({ kind, id }: { kind: 'lessons' | 'workorders' | 'checkpoints' | 'scenarios'; id: string }) {
  const { t } = useT();
  const st = useLearner();
  const list = activeClass(st)?.assigned[kind] ?? [];
  return list.includes(id) ? <i className="tag assigned" data-testid={`assigned-${id}`}> {t('class.assigned')}</i> : null;
}
