// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useT } from '../i18n';

type Field = 'V' | 'I' | 'R';
const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : '—');

export function OhmCalc({ preset }: { preset?: Partial<Record<Field, number>> }) {
  const { t } = useT();
  const [vals, setVals] = useState<Partial<Record<Field, string>>>({ V: preset?.V?.toString(), I: preset?.I?.toString(), R: preset?.R?.toString() });
  const [order, setOrder] = useState<Field[]>(['V', 'R']);

  const set = (f: Field, v: string) => {
    setVals((x) => ({ ...x, [f]: v }));
    setOrder((o) => [f, ...o.filter((x) => x !== f)].slice(0, 2));
  };

  // The two most recently edited fields are inputs; the third is computed.
  const [a, b] = order as [Field, Field];
  const out = (['V', 'I', 'R'] as Field[]).find((f) => f !== a && f !== b)!;
  const n = (f: Field) => Number((vals[f] ?? '').replace(',', '.'));
  const ok = (f: Field) => (vals[f] ?? '') !== '' && Number.isFinite(n(f));
  let computed = '';
  if (ok(a) && ok(b)) {
    const V = out === 'V' ? NaN : n('V');
    const I = out === 'I' ? NaN : n('I');
    const R = out === 'R' ? NaN : n('R');
    computed = fmt(out === 'V' ? I * R : out === 'I' ? V / R : V / I);
  }
  const power = ok(a) && ok(b) && computed !== '—' && computed !== '' ? (() => {
    const V = out === 'V' ? Number(computed) : n('V');
    const I = out === 'I' ? Number(computed) : n('I');
    const R = out === 'R' ? Number(computed) : n('R');
    const Vv = Number.isFinite(V) ? V : I * R;
    const Ii = Number.isFinite(I) ? I : V / R;
    return fmt(Vv * Ii);
  })() : '';
  const units: Record<Field, string> = { V: 'V', I: 'A', R: 'Ω' };

  return (
    <div className="calc" role="group" aria-label={t('calc.title')}>
      <h4>{t('calc.title')}</h4>
      <p className="muted small">{t('calc.hint')}</p>
      <div className="calc-row">
        {(['V', 'I', 'R'] as Field[]).map((f) => (
          <label key={f} className={f === out ? 'out' : ''}>
            <span>{f} ({units[f]})</span>
            {f === out ? (
              <output data-testid={`ohm-out-${f}`}>{computed || '—'}</output>
            ) : (
              <input inputMode="decimal" value={vals[f] ?? ''} onChange={(e) => set(f, e.target.value)} data-testid={`ohm-${f}`} />
            )}
          </label>
        ))}
        <label className="out"><span>P (W)</span><output data-testid="ohm-P">{power || '—'}</output></label>
      </div>
    </div>
  );
}
