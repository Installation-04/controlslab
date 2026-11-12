// SPDX-License-Identifier: AGPL-3.0-only
import type { Machine, MachineDef } from '@controlslab/sim';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { actions, useProgress } from '../store/progress';
import { checkStSource, download, pickFile } from '../store/transfer';
import { PanelWorkbench } from './PanelWorkbench';
import { DiagnosisPanel, FaultsPanel, PlcStatusPanel } from './Panels';
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
  const [instructor, setInstructor] = useState(false);

  if (!lab) return <p className="muted">{t('lab.load')}</p>;
  const m = lab.machine;
  const isPlc = def.mode === 'plc';

  return (
    <div className="lab">
      {props.top?.(lab)}
      <PanelWorkbench
        machine={m}
        rev={lab.rev}
        refresh={lab.refresh}
        mainExtra={
          <>
            {props.bottom?.(lab)}
            {isPlc && <PlcEditorBlock lab={lab} programKey={props.programKey ?? 'sandbox'} starter={props.starter ?? def.plc?.starterProgram ?? ''} />}
          </>
        }
        sideMiddle={
          props.showDiagnosis !== false ? (
            <DiagnosisPanel machine={m} quiet={props.quietDiagnosis} onSubmit={(id) => { const ok = m.recordDiagnosis(id); lab.refresh(); return ok; }} />
          ) : null
        }
        sideEnd={
          <>
            {props.instructor && (
              <>
                <label className="check">
                  <input type="checkbox" checked={instructor} onChange={(e) => setInstructor(e.target.checked)} /> {t('wo.instructor')}
                </label>
                {instructor && <FaultsPanel machine={m} rev={lab.rev} onChange={lab.refresh} />}
              </>
            )}
            <button className="ghost" onClick={lab.restart} data-testid="lab-restart">{t('wo.reset')}</button>
          </>
        }
      />
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
