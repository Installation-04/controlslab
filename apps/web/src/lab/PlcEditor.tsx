// SPDX-License-Identifier: AGPL-3.0-only
/** Program editor shared by work orders and the 3D cell: Structured Text or Ladder, with import/export. */
import { parseLd, type Read } from '@controlslab/ladder';
import type { PlcStatus } from '@controlslab/plc-engine';
import type { ReactNode } from 'react';
import { LadderEditor } from '../ladder/LadderEditor';
import { useT } from '../i18n';
import { langsOf, type PlcProgram } from '../store/plc';
import { checkStSource, download, pickFile } from '../store/transfer';
import { StEditor, type EditorError } from './StEditor';

/** Live variable reader built from the PLC status snapshot. */
export function readerFrom(status: PlcStatus | null, program: string): Read | undefined {
  if (!status || status.mode === 'empty') return undefined;
  const vars = status.vars as Record<string, boolean | number | string | undefined>;
  return (name) => vars[`${program}.${name}`] ?? vars[name];
}

export function PlcEditor({ prog, errors, status, extraTools, readOnly }: {
  prog: PlcProgram;
  errors: EditorError[];
  status: PlcStatus | null;
  extraTools?: ReactNode;
  readOnly?: boolean;
}) {
  const { t, lang } = useT();
  const fr = lang === 'fr';
  const langs = langsOf(prog.starters);
  const running = status?.mode === 'running';

  return (
    <div className="plc-editor">
      <div className="plc-toolbar">
        <div className="row wrap">
          {langs.length > 1 && (
            <div className="seg" role="radiogroup" aria-label={fr ? 'Langage' : 'Language'}>
              {langs.map((l) => (
                <button key={l} role="radio" aria-checked={prog.lang === l} className={prog.lang === l ? 'sel' : ''} onClick={() => prog.setLang(l)} data-testid={`lang-${l}`}>
                  {l === 'st' ? 'ST' : fr ? 'Ladder' : 'Ladder'}
                </button>
              ))}
            </div>
          )}
          <h3 style={{ margin: 0 }}>{t('plc.title')} — {prog.lang === 'st' ? 'Structured Text' : 'Ladder (LD)'}</h3>
        </div>
        <div className="row wrap">
          {extraTools}
          <button
            className="small"
            onClick={async () => {
              if (prog.lang === 'ld') {
                const f = await pickFile('.json,application/json');
                if (!f) return;
                const r = parseLd(f.text);
                if (r.ok) prog.setLd(r.program);
                else alert(`${fr ? 'Fichier Ladder invalide' : 'Invalid ladder file'} : ${r.message}`);
              } else {
                const f = await pickFile('.st,.txt,text/plain');
                if (!f) return;
                const r = checkStSource(f.text);
                if (r.ok || confirm(`${'message' in r ? r.message : ''}\n\n${fr ? 'Importer quand même?' : 'Import anyway?'}`)) prog.setSt(f.text);
              }
            }}
          >
            {prog.lang === 'ld' ? (fr ? 'Importer .ld.json' : 'Import .ld.json') : t('plc.import')}
          </button>
          <button
            className="small"
            data-testid="plc-export"
            onClick={() => (prog.lang === 'ld' ? download(`${prog.key}.ld.json`, JSON.stringify(prog.ld, null, 2), 'application/json') : download(`${prog.key}.st`, prog.st))}
          >
            {prog.lang === 'ld' ? (fr ? 'Exporter .ld.json' : 'Export .ld.json') : t('plc.export')}
          </button>
          {prog.lang === 'ld' && <button className="small" onClick={() => download(`${prog.key}.st`, prog.source)}>{fr ? 'Exporter le ST généré' : 'Export generated ST'}</button>}
          <button className="small" onClick={() => prog.resetToStarter()}>{t('plc.starter')}</button>
        </div>
      </div>
      {prog.lang === 'st' ? (
        <StEditor value={prog.st} onChange={prog.setSt} errors={errors} readOnly={readOnly} />
      ) : (
        <LadderEditor program={prog.ld} onChange={prog.setLd} read={running ? readerFrom(status, prog.ld.name) : undefined} readOnly={readOnly} />
      )}
    </div>
  );
}
