// SPDX-License-Identifier: AGPL-3.0-only
import type { PlcErrorInfo, PlcStatus } from '@controlslab/plc-engine';
import type { IoPoint } from '@controlslab/plc-engine';
import { LOTO_STEPS, type Machine, type MeterMode, type MeterReading } from '@controlslab/sim';
import { useState } from 'react';
import { useT } from '../i18n';
import type { StringKey } from '../strings';
import type { ExternalPlc } from '../plc/external';
import { ExternalPanel, PlcSourceSwitch } from '../plc/ExternalPanel';

const short = (ref?: string) => (ref ? ref.replace(':', ' · ') : '—');

// ---------------- Multimeter ----------------
const MODES: Array<{ id: MeterMode; label: string }> = [
  { id: 'VAC', label: 'V~' },
  { id: 'AAC', label: 'A~' },
  { id: 'VDC', label: 'V⎓' },
  { id: 'OHM', label: 'Ω' },
  { id: 'CONT', label: '•)))' },
];

export function MeterPanel(props: {
  machine: Machine;
  probes: { red?: string; black?: string };
  mode: MeterMode;
  setMode(m: MeterMode): void;
  reading: MeterReading | null;
  onMeasure(): void;
  onClear(): void;
  count: number;
  clampWire?: string;
}) {
  const { t, lang } = useT();
  const { reading, probes } = props;
  const clamp = props.mode === 'AAC';
  const ready = clamp ? !!props.clampWire : !!probes.red && !!probes.black;
  const warn = reading?.warning === 'ohms_on_live';
  return (
    <section className="panel meter" aria-label={t('meter.title')}>
      <h3>{t('meter.title')}</h3>
      <div className={`lcd ${warn ? 'warn' : ''}`} data-testid="meter-display" aria-live="polite">
        <span className="digits">{reading ? reading.display : '----'}</span>
        <span className="unit">{reading ? (reading.mode === 'OHM' || reading.mode === 'CONT' ? 'Ω' : reading.unit) : ''}</span>
        {reading?.beep && <span className="beep" aria-label="bip">♪</span>}
      </div>
      <div className="dial" role="radiogroup" aria-label="Fonction">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={props.mode === m.id} className={props.mode === m.id ? 'sel' : ''} onClick={() => props.setMode(m.id)} data-testid={`mode-${m.id}`}>
            {m.label}
          </button>
        ))}
      </div>
      {clamp ? (
        <dl className="probes">
          <dt><span className="dot clamp" />{lang === 'fr' ? 'Pince autour du fil' : 'Clamp on wire'}</dt>
          <dd data-testid="clamp-wire">{props.clampWire ?? '—'}</dd>
        </dl>
      ) : (
        <dl className="probes">
          <dt><span className="dot red" />{t('meter.red')}</dt>
          <dd data-testid="probe-red">{short(probes.red)}</dd>
          <dt><span className="dot black" />{t('meter.black')}</dt>
          <dd data-testid="probe-black">{short(probes.black)}</dd>
        </dl>
      )}
      <div className="row">
        <button className="primary" disabled={!ready} onClick={props.onMeasure} data-testid="measure">{t('meter.measure')}</button>
        <button onClick={props.onClear}>{t('meter.clear')}</button>
      </div>
      {warn && <p className="alert bad">{t('meter.ohmslive')}</p>}
      <p className="muted small">{!ready ? (clamp ? (lang === 'fr' ? 'Cliquez un fil du schéma pour y placer la pince (mesure sous tension, sans contact).' : 'Click a wire on the schematic to clamp it (live measurement, no contact).') : t('meter.hint')) : t('meter.log', { n: props.count })}</p>
    </section>
  );
}

// ---------------- Operator station ----------------
export function StationPanel({ machine, rev, api }: { machine: Machine; rev: number; api: { press(id: string): void; release(id: string): void; resetEStop(id: string): void; resetOverload(id: string): void } }) {
  const { t, loc, lang } = useT();
  void rev;
  const def = machine.def;
  const mtr = def.components.find((c) => c.type === 'motor3');
  const ms = mtr ? machine.state<{ state: string; speed: number; dir?: string }>(mtr.id) : null;
  const ol = def.components.find((c) => c.type === 'overload');
  const olS = ol ? machine.state<{ tripped: boolean; heat: number }>(ol.id) : null;
  const es = def.components.find((c) => c.type === 'pushbutton' && c.params?.kind === 'mushroom');
  const esPressed = es ? machine.state<{ pressed: boolean }>(es.id).pressed : false;
  // Operator buttons: every pushbutton except the E-stop, stop-like (red) ones last.
  const buttons = def.components
    .filter((c) => c.type === 'pushbutton' && c.params?.kind !== 'mushroom' && c.id.startsWith('PB_') || (c.type === 'pushbutton' && c.params?.kind === 'toggle'))
    .sort((a, b) => Number(a.params?.color === 'red') - Number(b.params?.color === 'red'));
  const nameOf = (c: (typeof buttons)[number]) =>
    c.id === 'PB_START' ? t('lab.start') : c.id === 'PB_STOP' ? t('lab.stop') : (loc(c.label) || c.tag || c.id).replace(/\s*\((NO|NF|NC)\)\s*$/, '');
  const testId = (id: string) => (id === 'PB_START' ? 'btn-start' : id === 'PB_STOP' ? 'btn-stop' : `btn-${id.toLowerCase()}`);
  return (
    <section className="panel station" aria-label={t('lab.station')}>
      <h3>{t('lab.station')}</h3>
      <div className="buttons">
        {buttons.map((c) => {
          const toggle = c.params?.kind === 'toggle';
          const pressed = machine.state<{ pressed: boolean }>(c.id).pressed;
          const color = toggle ? 'toggle' : c.params?.color === 'red' ? 'red' : 'green';
          return toggle ? (
            <button key={c.id} className={`pb toggle ${pressed ? 'engaged' : ''}`} aria-pressed={pressed} onClick={() => api.press(c.id)} data-testid={testId(c.id)}>
              {nameOf(c)} : {pressed ? 'ON' : 'OFF'}
            </button>
          ) : (
            <button key={c.id} className={`pb ${color}`} onPointerDown={() => api.press(c.id)} onPointerUp={() => api.release(c.id)} onPointerLeave={() => api.release(c.id)} data-testid={testId(c.id)}>
              {nameOf(c)}
            </button>
          );
        })}
        {es && (
          <button className={`pb estop ${esPressed ? 'engaged' : ''}`} onClick={() => (esPressed ? api.resetEStop(es.id) : api.press(es.id))} data-testid="btn-estop" aria-pressed={esPressed}>
            {esPressed ? t('lab.estop.reset') : t('lab.estop')}
          </button>
        )}
      </div>
      {ms && (
        <p className="status">
          {t('lab.motor')} : <strong className={`mstate ${ms.state}`} data-testid="motor-state">{t(`lab.motor.${ms.state}` as StringKey)}</strong>
          {ms.dir === 'fwd' && <span className="dirtag" data-testid="motor-dir">{lang === 'fr' ? 'AVANT' : 'FORWARD'}</span>}
          {ms.dir === 'rev' && <span className="dirtag rev" data-testid="motor-dir">{lang === 'fr' ? 'ARRIÈRE' : 'REVERSE'}</span>}
        </p>
      )}
      {olS && (
        <p className="status">
          OL : <strong className={olS.tripped ? 'bad' : ''}>{olS.tripped ? 'TRIP' : 'OK'}</strong>
          <span className="heat" title="Échauffement thermique"><i style={{ width: `${Math.min(100, olS.heat * 100)}%` }} /></span>
          {olS.tripped && ol && <button className="small" onClick={() => api.resetOverload(ol.id)}>{t('lab.overload.reset')}</button>}
        </p>
      )}
    </section>
  );
}

// ---------------- LOTO ----------------
export function LotoPanel({ machine, rev, api }: { machine: Machine; rev: number; api: { ack(t: 'notify' | 'stored_energy_checked' | 'work_done'): void; disconnect(on: boolean): void; lock(): void; unlock(): void } }) {
  const { t } = useT();
  void rev;
  const st = machine.loto();
  const iso = machine.def.loto.isolators[0]!;
  const dsOn = machine.state<{ on: boolean }>(iso).on;
  const locks = machine.state<{ locks: string[] }>(iso).locks;
  const next = st.current;
  const badge = (s: string) => (s === 'done' ? '✓' : s === 'failed' ? '⚠' : '○');
  return (
    <section className="panel loto" aria-label={t('loto.title')}>
      <h3>{t('loto.title')}</h3>
      <ol className="steps">
        {LOTO_STEPS.map((s) => (
          <li key={s} className={`${st.steps[s]} ${next === s ? 'next' : ''}`} data-testid={`loto-${s}`}>
            <span className="badge" aria-hidden>{badge(st.steps[s])}</span>
            {t(`loto.${s}` as StringKey)}
          </li>
        ))}
      </ol>
      <div className="row wrap">
        <button onClick={() => api.ack('notify')} data-testid="loto-notify">{t('loto.btn.notify')}</button>
        <button onClick={() => api.disconnect(!dsOn)} data-testid="loto-disconnect">{dsOn ? t('loto.btn.open') : t('loto.btn.close')}</button>
        <button onClick={api.lock} disabled={dsOn || locks.length > 0} data-testid="loto-lock">{t('loto.btn.lock')}</button>
        <button onClick={() => api.ack('stored_energy_checked')} data-testid="loto-stored">{t('loto.btn.stored')}</button>
        <button onClick={() => api.ack('work_done')} disabled={!st.workAllowed} data-testid="loto-workdone">{t('loto.btn.done')}</button>
        <button onClick={api.unlock} disabled={locks.length === 0} data-testid="loto-unlock">{t('loto.btn.unlock')}</button>
      </div>
      {(st.steps.try_start === 'done' || st.steps.verify === 'done') && (
        <div className="verify">
          <p className="small strong">{t('loto.verify.points')}</p>
          <p className="small">
            {t('loto.verify.live', { state: st.verify.liveBefore ? (st.verify.liveAfter ? '✓ ✓' : '✓') : '○' })}
          </p>
          <ul className="points">
            {st.verify.points.map((p, i) => (
              <li key={i} className={p.ok ? 'ok' : ''}>{p.ok ? '✓' : '○'} {p.a.replace(':', ' · ')} ↔ {p.b.replace(':', ' · ')}</li>
            ))}
          </ul>
        </div>
      )}
      {st.hazardFound && <p className="alert bad">{t('loto.hazard')}</p>}
      {st.workAllowed && <p className="alert ok">{t('loto.workallowed')}</p>}
    </section>
  );
}

// ---------------- Faults / diagnosis / repair ----------------
export function FaultsPanel({ machine, rev, onChange }: { machine: Machine; rev: number; onChange(): void }) {
  const { t, loc } = useT();
  void rev;
  const active = new Set(machine.activeFaults().map((f) => f.id));
  return (
    <section className="panel faults" aria-label={t('faults.title')}>
      <h3>{t('faults.title')}</h3>
      <ul className="faultlist">
        {machine.def.faults.map((f) => (
          <li key={f.id}>
            <span>{loc(f.label)}</span>
            {active.has(f.id) ? <em className="bad">{t('faults.active')}</em> : (
              <button className="small" onClick={() => { machine.injectFault(f.id); onChange(); }} data-testid={`inject-${f.id}`}>{t('faults.inject')}</button>
            )}
          </li>
        ))}
      </ul>
      <button onClick={() => { machine.clearFaults(); onChange(); }}>{t('faults.clear')}</button>
    </section>
  );
}

export function DiagnosisPanel({ machine, onSubmit, quiet }: { machine: Machine; onSubmit(faultId: string): boolean; quiet?: boolean }) {
  const { t, loc } = useT();
  const [sel, setSel] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="panel diag" aria-label={t('diag.title')}>
      <h3>{t('diag.title')}</h3>
      <select value={sel} onChange={(e) => setSel(e.target.value)} data-testid="diag-select">
        <option value="">{t('diag.choose')}</option>
        {machine.def.faults.map((f) => <option key={f.id} value={f.id}>{loc(f.label)}</option>)}
      </select>
      <button
        disabled={!sel}
        onClick={() => {
          const ok = onSubmit(sel);
          setMsg(quiet ? t('diag.cp') : ok ? t('diag.right') : t('diag.wrong'));
        }}
        data-testid="diag-submit"
      >
        {t('diag.submit')}
      </button>
      {msg && <p className={`alert ${quiet ? '' : msg === t('diag.right') ? 'ok' : 'bad'}`}>{msg}</p>}
    </section>
  );
}

export function RepairPanel({ machine, onReplace, violation }: { machine: Machine; rev: number; onReplace(id: string): void; violation: boolean }) {
  const { t, loc } = useT();
  const [sel, setSel] = useState('');
  const replaceable = [
    ...machine.def.components.filter((c) => !['terminal', 'source3', 'ground'].includes(c.type)).map((c) => ({ id: c.id, label: `${c.tag ?? c.id} — ${loc(c.label) || c.type}` })),
    ...machine.def.wires.filter((w) => w.label).map((w) => ({ id: w.id, label: `${w.id} — fil ${w.label} (${w.from} → ${w.to})` })),
  ];
  return (
    <section className="panel repair" aria-label={t('repair.title')}>
      <h3>{t('repair.title')}</h3>
      <select value={sel} onChange={(e) => setSel(e.target.value)} data-testid="repair-select">
        <option value="">{t('repair.choose')}</option>
        {replaceable.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <button disabled={!sel} onClick={() => onReplace(sel)} data-testid="repair-replace">{t('repair.replace')}</button>
      {violation && <p className="alert bad">{t('repair.violation')}</p>}
    </section>
  );
}

// ---------------- PLC panel ----------------
export function PlcStatusPanel({ status, errors, loaded, ioPoints, onLoad, onStop, onReset, onJump, external, extInputs }: {
  status: PlcStatus | null;
  errors: PlcErrorInfo[];
  loaded: boolean;
  ioPoints: IoPoint[];
  onLoad(): void;
  onStop(): void;
  onReset(): void;
  onJump(line: number): void;
  /** When provided, the learner may swap the virtual PLC for an external one (Modbus TCP). */
  external?: ExternalPlc;
  extInputs?: Record<string, boolean>;
}) {
  const { t } = useT();
  const mode = status?.mode ?? 'empty';
  const inputs = status ? ioPoints : [];
  const val = (addr: string) => status?.vars[addr];
  return (
    <section className="panel plcstatus" aria-label={t('plc.title')}>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>{t('plc.title')}</h3>
        {external && <PlcSourceSwitch ext={external} />}
      </div>
      {external?.enabled && <ExternalPanel ext={external} ioPoints={ioPoints} inputs={extInputs} outputs={external.link.outputs} />}
      {!external?.enabled && (<>
      <p className="status">
        {t('plc.mode')} : <strong className={`mode ${mode}`} data-testid="plc-mode">{t(`plc.mode.${mode}` as StringKey)}</strong> · {t('plc.scans')} : <span data-testid="plc-scans">{status?.scanCount ?? 0}</span>
      </p>
      <div className="row wrap">
        <button className="primary" onClick={onLoad} data-testid="plc-load">{t('plc.load')}</button>
        <button onClick={onStop} disabled={mode !== 'running'}>{t('plc.stop')}</button>
        <button onClick={onReset}>{t('plc.reset')}</button>
      </div>
      {errors.length > 0 ? (
        <div className="alert bad" data-testid="plc-errors">
          <strong>{t('plc.errors')}</strong>
          <ul>{errors.map((e, i) => (
            <li key={i}>{e.pos ? <button className="link" onClick={() => onJump(e.pos!.line)}>L{e.pos.line}:{e.pos.col}</button> : null} {e.message.replace(/^\d+:\d+ /, '')}</li>
          ))}</ul>
        </div>
      ) : loaded ? <p className="alert ok">{t('plc.ok')}</p> : null}
      {status?.fault && <p className="alert bad">{status.fault.message}</p>}
      {inputs.length > 0 && (
        <table className="io" aria-label={t('plc.io')}>
          <tbody>
            {inputs.map((p) => {
              const on = p.area === 'Q' ? status?.outputs[p.address] : (val(`${p.program ? p.program + '.' : ''}${p.name}`) as boolean | undefined);
              return (
                <tr key={p.address}>
                  <td><span className={`led ${on ? 'on' : ''}`} /></td>
                  <td><code>{p.address}</code></td>
                  <td>{p.name}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      </>)}
    </section>
  );
}
