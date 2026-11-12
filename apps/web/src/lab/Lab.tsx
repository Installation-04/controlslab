// SPDX-License-Identifier: AGPL-3.0-only
import type { Machine, MachineDef, MeterMode, MeterReading } from '@controlslab/sim';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { actions, useProgress } from '../store/progress';
import { checkStSource, download, pickFile } from '../store/transfer';
import { DiagnosisPanel, FaultsPanel, LotoPanel, MeterPanel, PlcStatusPanel, RepairPanel, StationPanel } from './Panels';
import { Schematic } from './Schematic';
import { StEditor } from './StEditor';
import { useLab, type LabApi } from './useLab';

export interface LabProps {
  def: MachineDef;
  /** Fault ids injected when the machine is created. */
  faults?: string[];
  /** Allow the instructor panel (inject faults). */
  instructor?: boolean;
  /** Storage key for the learner's ST program (PLC machines). */
  programKey?: string;
  starter?: string;
  /** Quiet diagnosis feedback (checkpoint). */
  quietDiagnosis?: boolean;
  showDiagnosis?: boolean;
  /** Content rendered above the panels (objectives, complaint…). */
  top?: (lab: LabApi) => ReactNode;
  /** Content rendered below the schematic. */
  bottom?: (lab: LabApi) => ReactNode;
}

export function Lab(props: LabProps) {
  const { t } = useT();
  const { def } = props;
  const faultsKey = (props.faults ?? []).join(',');
  const setup = useCallback(
    (m: Machine) => {
      for (const f of props.faults ?? []) m.injectFault(f);
    },
    [faultsKey],
  );
  const lab = useLab(def, setup);
  const [probes, setProbes] = useState<{ red?: string; black?: string }>({});
  const [mode, setMode] = useState<MeterMode>('VAC');
  const [reading, setReading] = useState<MeterReading | null>(null);
  const [count, setCount] = useState(0);
  const [instructor, setInstructor] = useState(false);
  const [violation, setViolation] = useState(false);

  // Reset the UI state when the machine is recreated.
  const machine = lab?.machine;
  useEffect(() => {
    setProbes({});
    setReading(null);
    setCount(0);
    setViolation(false);
  }, [machine]);

  const doMeasure = useCallback(
    (p: { red?: string; black?: string }, m: MeterMode) => {
      if (!lab || !p.red || !p.black) return;
      setReading(lab.machine.measure(p.red, p.black, m));
      setCount((c) => c + 1);
      lab.refresh();
    },
    [lab],
  );

  const onProbe = useCallback(
    (ref: string) => {
      setProbes((p) => {
        if (!p.red || (p.red && p.black)) return { red: ref };
        if (p.red === ref) return p;
        return { ...p, black: ref };
      });
    },
    [],
  );

  if (!lab) return <p className="muted">{t('lab.load')}</p>;
  const m = lab.machine;
  const isPlc = def.mode === 'plc';

  const act = <A extends unknown[]>(f: (...a: A) => unknown) => (...a: A) => {
    f(...a);
    lab.refresh();
  };

  return (
    <div className="lab">
      {props.top?.(lab)}
      <div className="lab-grid">
        <div className="lab-main">
          <div className="legend" aria-label={t('lab.legend')}>
            <span><i className="sw w600" /> {t('lab.power')}</span>
            <span><i className="sw w120" /> {t('lab.control')}</span>
            <span><i className="sw w0" /> 0 V</span>
          </div>
          <Schematic
            machine={m}
            rev={lab.rev}
            probes={probes}
            onProbe={onProbe}
            onPress={act((id: string) => m.press(id))}
            onRelease={act((id: string) => m.release(id))}
            onToggleDisconnect={act((id: string) => {
              const on = m.state<{ on: boolean }>(id).on;
              m.setDisconnect(id, !on);
            })}
            onResetOverload={act((id: string) => m.resetOverload(id))}
          />
          {props.bottom?.(lab)}
          {isPlc && <PlcEditorBlock lab={lab} programKey={props.programKey ?? 'sandbox'} starter={props.starter ?? def.plc?.starterProgram ?? ''} />}
        </div>
        <aside className="lab-side">
          <StationPanel
            machine={m}
            rev={lab.rev}
            api={{
              press: act((id) => m.press(id)),
              release: act((id) => m.release(id)),
              resetEStop: act((id) => m.resetEStop(id)),
              resetOverload: act((id) => m.resetOverload(id)),
            }}
          />
          <MeterPanel
            machine={m}
            probes={probes}
            mode={mode}
            setMode={(x) => setMode(x)}
            reading={reading}
            count={count}
            onMeasure={() => doMeasure(probes, mode)}
            onClear={() => {
              setProbes({});
              setReading(null);
            }}
          />
          <LotoPanel
            machine={m}
            rev={lab.rev}
            api={{
              ack: act((x) => m.acknowledge(x)),
              disconnect: act((on: boolean) => m.setDisconnect(m.def.loto.isolators[0]!, on)),
              lock: act(() => m.applyLock(m.def.loto.isolators[0]!)),
              unlock: act(() => m.removeLock(m.def.loto.isolators[0]!)),
            }}
          />
          {props.showDiagnosis !== false && <DiagnosisPanel machine={m} quiet={props.quietDiagnosis} onSubmit={(id) => { const ok = m.recordDiagnosis(id); lab.refresh(); return ok; }} />}
          <RepairPanel
            machine={m}
            rev={lab.rev}
            violation={violation}
            onReplace={(id) => {
              m.replace(id);
              setViolation(m.violations().includes('work_without_loto'));
              lab.refresh();
            }}
          />
          {props.instructor && (
            <>
              <label className="check">
                <input type="checkbox" checked={instructor} onChange={(e) => setInstructor(e.target.checked)} /> {t('wo.instructor')}
              </label>
              {instructor && <FaultsPanel machine={m} rev={lab.rev} onChange={lab.refresh} />}
            </>
          )}
          <button className="ghost" onClick={lab.restart} data-testid="lab-restart">{t('wo.reset')}</button>
        </aside>
      </div>
    </div>
  );
}

function PlcEditorBlock({ lab, programKey, starter }: { lab: LabApi; programKey: string; starter: string }) {
  const { t } = useT();
  const progress = useProgress();
  const saved = progress.programs[programKey];
  const source = saved ?? starter;
  const [notice, setNotice] = useState<string | null>(null);
  const jump = useRef<(line: number) => void>(() => undefined);
  void jump;

  const errors = useMemo(
    () => lab.plc.errors.filter((e) => e.pos).map((e) => ({ line: e.pos!.line, message: e.message })),
    [lab.plc.errors],
  );

  // Auto-load the saved program once the worker is ready? No: the learner loads explicitly (like a real download).
  return (
    <div className="plc-block">
      <div className="plc-toolbar">
        <h3>{t('plc.title')} — Structured Text</h3>
        <div className="row wrap">
          <button
            className="small"
            onClick={async () => {
              const f = await pickFile('.st,.txt,text/plain');
              if (!f) return;
              const r = checkStSource(f.text);
              if (r.ok) {
                actions.saveProgram(programKey, f.text);
                setNotice(null);
              } else if (confirm(`${r.message}\n\nImporter quand même?`)) {
                actions.saveProgram(programKey, f.text);
              }
            }}
          >
            {t('plc.import')}
          </button>
          <button className="small" onClick={() => download(`${programKey}.st`, source)}>{t('plc.export')}</button>
          <button className="small" onClick={() => actions.saveProgram(programKey, starter)}>{t('plc.starter')}</button>
        </div>
      </div>
      <StEditor value={source} onChange={(v) => actions.saveProgram(programKey, v)} errors={errors} />
      {notice && <p className="alert bad">{notice}</p>}
      <PlcStatusPanel
        status={lab.plc.status}
        errors={lab.plc.errors}
        loaded={lab.plc.loaded}
        ioPoints={lab.plc.ioPoints}
        onLoad={() => lab.loadProgram(source)}
        onStop={() => lab.plcCommand('stop')}
        onReset={() => lab.plcCommand('reset')}
        onJump={() => undefined}
      />
    </div>
  );
}
