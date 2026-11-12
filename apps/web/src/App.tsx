// SPDX-License-Identifier: AGPL-3.0-only
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { setLang, useT } from './i18n';
import { CheckpointPage } from './routes/Checkpoint';
import { DataPage } from './routes/Data';
import { Home } from './routes/Home';
import { LessonPage, LessonsList } from './routes/Lessons';
import { OrderPage, OrdersList } from './routes/Orders';
import { RecordPage } from './routes/Record';
import { SandboxPage } from './routes/Sandbox';

export function App() {
  const { t, lang } = useT();
  return (
    <HashRouter>
      <a className="skip" href="#main">Aller au contenu</a>
      <header className="topbar no-print">
        <NavLink to="/" className="brand" end>
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="6" fill="#0f2a43" /><path d="M6 20h6v-8h8v8h6" fill="none" stroke="#ffb000" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" /></svg>
          {t('app.name')}
        </NavLink>
        <nav aria-label="Principal">
          <NavLink to="/lessons">{t('nav.lessons')}</NavLink>
          <NavLink to="/orders">{t('nav.workorders')}</NavLink>
          <NavLink to="/checkpoint">{t('nav.checkpoint')}</NavLink>
          <NavLink to="/lab">{t('nav.sandbox')}</NavLink>
          <NavLink to="/record">{t('nav.record')}</NavLink>
          <NavLink to="/data">{t('nav.data')}</NavLink>
        </nav>
        <div className="lang" role="group" aria-label={t('common.language')}>
          <button className={lang === 'fr' ? 'sel' : ''} onClick={() => setLang('fr')} lang="fr">FR</button>
          <button className={lang === 'en' ? 'sel' : ''} onClick={() => setLang('en')} lang="en">EN</button>
        </div>
      </header>
      <div id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lessons" element={<LessonsList />} />
          <Route path="/lessons/:id" element={<LessonPage />} />
          <Route path="/orders" element={<OrdersList />} />
          <Route path="/orders/:id" element={<OrderPage />} />
          <Route path="/checkpoint" element={<CheckpointPage />} />
          <Route path="/lab" element={<SandboxPage />} />
          <Route path="/record" element={<RecordPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </div>
      <footer className="foot no-print">{t('footer')}</footer>
    </HashRouter>
  );
}
