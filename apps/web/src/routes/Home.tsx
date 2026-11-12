// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from 'react-router-dom';
import { useRegistry } from '../content';
import { useT } from '../i18n';
import { useProgress } from '../store/progress';

export function Home() {
  const { t, loc } = useT();
  const reg = useRegistry();
  const p = useProgress();
  const done = reg.lessons.filter((l) => p.lessons[l.id]?.done).length;
  const next = reg.lessons.find((l) => !p.lessons[l.id]?.done) ?? reg.lessons[0];
  return (
    <main className="page home">
      <section className="hero">
        <h1>{t('home.title')}</h1>
        <p className="lead">{t('home.intro')}</p>
        <div className="row wrap">
          {next && <Link className="btn primary big" to={`/lessons/${next.id}`} data-testid="home-start">{done === 0 ? t('home.start') : `${t('home.continue')} — ${loc(next.title)}`}</Link>}
          <Link className="btn big" to="/lab">{t('nav.sandbox')}</Link>
        </div>
        <p className="muted">{t('home.progress', { done, total: reg.lessons.length })}</p>
      </section>
      <section className="tiles">
        <Link to="/lessons" className="tile"><strong>{t('nav.lessons')}</strong><span>{reg.lessons.length}</span></Link>
        <Link to="/orders" className="tile"><strong>{t('nav.workorders')}</strong><span>{reg.workorders.length}</span></Link>
        <Link to="/cells" className="tile"><strong>{t('nav.cells')}</strong><span>{reg.scenarios.length + 1}</span></Link>
        <Link to="/checkpoint" className="tile"><strong>{t('nav.checkpoint')}</strong><span>{t('cp.nohints').split('.')[0]}</span></Link>
        <Link to="/record" className="tile"><strong>{t('nav.record')}</strong><span>{t('record.print')}</span></Link>
      </section>
      <p className="alert small">{t('home.safety')}</p>
    </main>
  );
}
