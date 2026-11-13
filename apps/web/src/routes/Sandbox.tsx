// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useRegistry } from '../content';
import { useT } from '../i18n';
import { Lab } from '../lab/Lab';

export function SandboxPage() {
  const { t, loc } = useT();
  const reg = useRegistry();
  const [id, setId] = useState(reg.machines.find((m) => m.id === 'motor-starter-3w')?.id ?? reg.machines[0]?.id ?? '');
  const def = reg.machines.find((m) => m.id === id);
  return (
    <main className="page wide">
      <h1>{t('nav.sandbox')}</h1>
      <label className="field inline">
        <span>{t('lab.machine')}</span>
        <select value={id} onChange={(e) => setId(e.target.value)} data-testid="machine-select">
          {reg.machines.map((m) => <option key={m.id} value={m.id}>{loc(m.title)}</option>)}
        </select>
      </label>
      {def && <Lab key={def.id} def={def} instructor programKey={`sandbox-${def.id}`} />}
    </main>
  );
}
