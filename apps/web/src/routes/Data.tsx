// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { importContent, removeContent, useRegistry, userContentKeys } from '../content';
import { useT } from '../i18n';
import { actions, getProgress } from '../store/progress';
import { backupFileName, describeBackup, download, makeBackup, parseBackup, pickFile, type Backup } from '../store/transfer';

export function DataPage() {
  const { t } = useT();
  const reg = useRegistry();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const userKeys = userContentKeys();
  const say = (ok: boolean, text: string) => setMsg({ ok, text });

  return (
    <main className="page">
      <h1>{t('data.title')}</h1>
      {msg && <p className={`alert ${msg.ok ? 'ok' : 'bad'}`} role="status" data-testid="data-msg">{msg.text}</p>}

      <section className="panel">
        <h2>{t('data.backup')}</h2>
        <p className="muted">{t('data.backup.help')}</p>
        <div className="row wrap">
          <button className="primary" onClick={() => download(backupFileName(), JSON.stringify(makeBackup(getProgress()), null, 2), 'application/json')} data-testid="export-backup">{t('data.export')}</button>
          <button
            onClick={async () => {
              const f = await pickFile('.json,application/json');
              if (!f) return;
              try {
                setPending(parseBackup(f.text));
                setMsg(null);
              } catch (e) {
                say(false, (e as Error).message);
              }
            }}
          >
            {t('data.import')}
          </button>
        </div>
        {pending && (() => {
          const d = describeBackup(pending);
          return (
            <div className="alert">
              <p>{d.date} · {d.lessons} leçon(s), {d.orders} bon(s) de travail, {d.checkpoints} essai(s), {d.programs} programme(s)</p>
              <div className="row wrap">
                <button onClick={() => { actions.importProgress(pending.progress, 'merge'); setPending(null); say(true, t('data.ok')); }}>{t('data.import.merge')}</button>
                <button onClick={() => { if (confirm(t('data.reset.confirm'))) { actions.importProgress(pending.progress, 'replace'); setPending(null); say(true, t('data.ok')); } }}>{t('data.import.replace')}</button>
                <button className="ghost" onClick={() => setPending(null)}>{t('common.close')}</button>
              </div>
            </div>
          );
        })()}
      </section>

      <section className="panel">
        <h2>{t('data.content')}</h2>
        <p className="muted">{t('data.content.help')}</p>
        <button
          onClick={async () => {
            const f = await pickFile('.yaml,.yml,text/yaml');
            if (!f) return;
            try {
              const r = importContent(f.text, f.name);
              say(true, `${t('data.ok')} (${r.kind}: ${r.id})`);
            } catch (e) {
              say(false, (e as Error).message);
            }
          }}
          data-testid="import-content"
        >
          {t('data.content.import')}
        </button>
        {userKeys.length > 0 && (
          <ul className="faultlist">
            {userKeys.map((k) => (
              <li key={k}><span><code>{k}</code></span><button className="small" onClick={() => removeContent(k)}>{t('data.content.remove')}</button></li>
            ))}
          </ul>
        )}
        {reg.errors.length > 0 && <ul className="alert bad">{reg.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      </section>

      <section className="panel danger">
        <button className="ghost bad" onClick={() => { if (confirm(t('data.reset.confirm'))) { actions.reset(); say(true, t('data.ok')); } }}>{t('data.reset')}</button>
      </section>
    </main>
  );
}
