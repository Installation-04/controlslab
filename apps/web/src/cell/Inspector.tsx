// SPDX-License-Identifier: AGPL-3.0-only
import { SPECS, nextAddress, resolveParams, type EntityDef, type Issue, type ParamValue } from '@controlslab/factory';
import type { MachineDef } from '@controlslab/sim';
import { useT } from '../i18n';

export function issueText(i: Issue, lang: 'fr' | 'en'): string {
  const d = i.detail ? ` (${i.detail})` : '';
  const fr: Record<Issue['code'], string> = {
    bad_address: 'adresse invalide (format %IX1.0 / %QX1.0)',
    wrong_area: 'une entrée doit être en %I…, une sortie en %Q…',
    input_conflict: 'adresse d’entrée déjà utilisée',
    panel_conflict: 'adresse réservée au câblage du panneau',
    overlap: 'chevauche un autre élément',
    duplicate_id: 'identifiant en double',
    unbound: 'signal non associé à une adresse',
    no_panel_motor: 'le panneau n’a pas de moteur',
  };
  const en: Record<Issue['code'], string> = {
    bad_address: 'invalid address (format %IX1.0 / %QX1.0)',
    wrong_area: 'an input must be %I…, an output %Q…',
    input_conflict: 'input address already used',
    panel_conflict: 'address reserved for the panel wiring',
    overlap: 'overlaps another item',
    duplicate_id: 'duplicate id',
    unbound: 'signal not mapped to an address',
    no_panel_motor: 'the panel has no motor',
  };
  return `${i.entity ?? ''} — ${(lang === 'fr' ? fr : en)[i.code]}${d}`;
}

export function Inspector(props: {
  entity: EntityDef | undefined;
  entities: EntityDef[];
  issues: Issue[];
  panelDef: MachineDef | undefined;
  panels: MachineDef[];
  readOnly: boolean;
  onChange(e: EntityDef): void;
  onDelete(id: string): void;
  onOpenPanel(): void;
}) {
  const { t, loc, lang } = useT();
  const e = props.entity;
  if (!e) return <section className="panel"><h3>{t('cell.inspector')}</h3><p className="muted small">{t('cell.inspector.none')}</p></section>;
  const spec = SPECS[e.type];
  const p = resolveParams(e);
  const lock = props.readOnly || !!e.locked;
  const set = (patch: Partial<EntityDef>) => props.onChange({ ...e, ...patch });
  const setParam = (k: string, v: ParamValue) => set({ params: { ...e.params, [k]: v } });
  const mine = props.issues.filter((i) => i.entity === e.id);

  return (
    <section className="panel inspector" data-testid="inspector">
      <h3>{t('cell.inspector')} — <code>{e.id}</code></h3>
      <p className="muted small">{loc(spec.label)}{e.locked ? ` · 🔒 ${t('cell.locked')}` : ''}</p>
      <label className="field">
        <span>{t('cell.name')}</span>
        <input value={e.name ?? ''} placeholder={e.id} disabled={lock} onChange={(ev) => set({ name: ev.target.value || undefined })} />
      </label>
      <div className="row wrap small">
        <span>{t('cell.pos')} :</span>
        <code data-testid="inspector-pos">{e.x.toFixed(2)} ; {e.z.toFixed(2)}</code>
        <span>↻ {e.rot}°</span>
      </div>

      {spec.params.length > 0 && <h4>{t('cell.params')}</h4>}
      <div className="params">
        {spec.params.map((d) => {
          const v = p[d.key]!;
          const label = loc(d.label);
          if (e.type === 'panel' && d.key === 'machine') {
            return (
              <label key={d.key} className="field">
                <span>{label}</span>
                <select value={String(v)} disabled={lock} onChange={(ev) => setParam('machine', ev.target.value)} data-testid="param-machine">
                  {props.panels.map((m) => <option key={m.id} value={m.id}>{loc(m.title)}</option>)}
                </select>
              </label>
            );
          }
          if (d.type === 'boolean')
            return (
              <label key={d.key} className="check">
                <input type="checkbox" checked={!!v} disabled={lock} onChange={(ev) => setParam(d.key, ev.target.checked)} /> {label}
              </label>
            );
          if (d.type === 'select')
            return (
              <label key={d.key} className="field">
                <span>{label}</span>
                <select value={String(v)} disabled={lock} onChange={(ev) => setParam(d.key, ev.target.value)} data-testid={`param-${d.key}`}>
                  {d.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            );
          if (d.type === 'number')
            return (
              <label key={d.key} className="field">
                <span>{label}</span>
                <input type="number" value={Number(v)} min={d.min} max={d.max} step={d.step} disabled={lock} onChange={(ev) => ev.target.value !== '' && setParam(d.key, Number(ev.target.value))} data-testid={`param-${d.key}`} />
              </label>
            );
          return (
            <label key={d.key} className="field">
              <span>{label}</span>
              <input value={String(v)} disabled={lock} onChange={(ev) => setParam(d.key, ev.target.value)} data-testid={`param-${d.key}`} />
            </label>
          );
        })}
      </div>

      {spec.signals.length > 0 ? (
        <>
          <h4>{t('cell.io')}</h4>
          <table className="iomap">
            <tbody>
              {spec.signals.map((s) => {
                const bad = mine.find((i) => i.detail?.toUpperCase().includes((e.io?.[s.name] ?? '§').toUpperCase()) && i.level === 'error');
                return (
                  <tr key={s.name}>
                    <td>
                      <span className={`dir ${s.dir}`}>{s.dir === 'input' ? t('cell.dir.input') : t('cell.dir.output')}</span> {s.name}
                    </td>
                    <td>
                      <input
                        className={bad ? 'invalid' : ''}
                        value={e.io?.[s.name] ?? ''}
                        placeholder="%IX1.0"
                        spellCheck={false}
                        disabled={lock}
                        aria-label={`${e.id}.${s.name}`}
                        data-testid={`io-${s.name}`}
                        onChange={(ev) => set({ io: { ...e.io, [s.name]: ev.target.value.toUpperCase() } })}
                      />
                      <button
                        className="small"
                        disabled={lock}
                        title={t('cell.io.auto')}
                        onClick={() => set({ io: { ...e.io, [s.name]: nextAddress(props.entities, s.dir === 'input' ? 'I' : 'Q', props.panelDef) } })}
                      >
                        ⟳
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : (
        e.type !== 'panel' && <p className="muted small">{t('cell.io.none')}</p>
      )}
      {mine.filter((i) => i.level === 'error').map((i, k) => <p key={k} className="alert bad small">{issueText(i, lang)}</p>)}

      <div className="row wrap">
        {e.type === 'panel' && <button className="primary" onClick={props.onOpenPanel} data-testid="open-panel">{t('cell.openpanel')}</button>}
        {!lock && <button onClick={() => set({ rot: ((e.rot + 90) % 360) as EntityDef['rot'] })} data-testid="rotate">{t('cell.rotate')}</button>}
        {!lock && <button className="ghost bad" onClick={() => props.onDelete(e.id)} data-testid="delete">{t('cell.delete')}</button>}
      </div>
    </section>
  );
}
