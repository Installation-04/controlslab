// SPDX-License-Identifier: AGPL-3.0-only
import type { Machine, MachineDef } from '@controlslab/sim';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { usePlcProgram, type Starters } from '../store/plc';
import { PanelWorkbench } from './PanelWorkbench';
import { DiagnosisPanel, FaultsPanel, PlcStatusPanel } from './Panels';
import { PlcEditor } from './PlcEditor';
import { useLab, type LabApi } from './useLab';

export interface LabProps {
  def: MachineDef;
  /** Fault ids injected when the machine is created. */
  faults?: string[];
  /** Allow the instructor panel (inject faults). */
  instructor?: boolean;
  /** Storage key for the learner's ST program (PLC machines). */
  programKey?: string;
  /** Program starters (Structured Text, optional Ladder). */
  starters?: Starters;
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
            {isPlc && <PlcEditorBlock lab={lab} programKey={props.programKey ?? 'sandbox'} starters={props.starters ?? { st: def.plc?.starterProgram ?? '' }} />}
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

function PlcEditorBlock({ lab, programKey, starters }: { lab: LabApi; programKey: string; starters: Starters }) {
  const prog = usePlcProgram(programKey, starters);
  const errors = useMemo(
    () => lab.plc.errors.filter((e) => e.pos).map((e) => ({ line: e.pos!.line, message: e.message })),
    [lab.plc.errors],
  );
  // The learner loads the program explicitly (like downloading to a real PLC).
  return (
    <div className="plc-block">
      <PlcEditor prog={prog} errors={errors} status={lab.plc.status} />
      <PlcStatusPanel
        status={lab.plc.status}
        errors={lab.plc.errors}
        loaded={lab.plc.loaded}
        ioPoints={lab.plc.ioPoints}
        onLoad={() => lab.loadProgram(prog.source)}
        onStop={() => lab.plcCommand('stop')}
        onReset={() => lab.plcCommand('reset')}
        onJump={() => undefined}
        external={lab.external}
        extInputs={lab.machine.getPlcInputs()}
      />
    </div>
  );
}
