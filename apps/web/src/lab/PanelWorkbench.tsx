// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The interactive electrical panel: schematic + operator station + multimeter +
 * lockout + repair. Used by the Lab page and by the 3D cell's "open panel" drawer.
 */
import type { Machine, MeterMode, MeterReading } from '@controlslab/sim';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { LotoPanel, MeterPanel, RepairPanel, StationPanel } from './Panels';
import { Schematic } from './Schematic';

export interface PanelWorkbenchProps {
  machine: Machine;
  /** Changes whenever the machine ticked, so memoized children re-render. */
  rev: number;
  refresh(): void;
  /** Rendered between the lockout and repair panels (e.g. diagnosis). */
  sideMiddle?: ReactNode;
  sideEnd?: ReactNode;
  mainExtra?: ReactNode;
}

export function PanelWorkbench({ machine: m, rev, refresh, sideMiddle, sideEnd, mainExtra }: PanelWorkbenchProps) {
  const { t } = useT();
  const [probes, setProbes] = useState<{ red?: string; black?: string }>({});
  const [mode, setMode] = useState<MeterMode>('VAC');
  const [reading, setReading] = useState<MeterReading | null>(null);
  const [count, setCount] = useState(0);
  const [violation, setViolation] = useState(false);

  useEffect(() => {
    setProbes({});
    setReading(null);
    setCount(0);
    setViolation(false);
  }, [m]);

  const onProbe = useCallback((ref: string) => {
    setProbes((p) => {
      if (!p.red || (p.red && p.black)) return { red: ref };
      if (p.red === ref) return p;
      return { ...p, black: ref };
    });
  }, []);

  const act = <A extends unknown[]>(f: (...a: A) => unknown) => (...a: A) => {
    f(...a);
    refresh();
  };
  const iso = m.def.loto.isolators[0]!;

  return (
    <div className="lab-grid">
      <div className="lab-main">
        <div className="legend" aria-label={t('lab.legend')}>
          <span><i className="sw w600" /> {t('lab.power')}</span>
          <span><i className="sw w120" /> {t('lab.control')}</span>
          <span><i className="sw w0" /> 0 V</span>
        </div>
        <Schematic
          machine={m}
          rev={rev}
          probes={probes}
          onProbe={onProbe}
          onPress={act((id: string) => m.press(id))}
          onRelease={act((id: string) => m.release(id))}
          onToggleDisconnect={act((id: string) => m.setDisconnect(id, !m.state<{ on: boolean }>(id).on))}
          onResetOverload={act((id: string) => m.resetOverload(id))}
        />
        {mainExtra}
      </div>
      <aside className="lab-side">
        <StationPanel
          machine={m}
          rev={rev}
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
          setMode={setMode}
          reading={reading}
          count={count}
          onMeasure={() => {
            if (!probes.red || !probes.black) return;
            setReading(m.measure(probes.red, probes.black, mode));
            setCount((c) => c + 1);
            refresh();
          }}
          onClear={() => {
            setProbes({});
            setReading(null);
          }}
        />
        <LotoPanel
          machine={m}
          rev={rev}
          api={{
            ack: act((x) => m.acknowledge(x)),
            disconnect: act((on: boolean) => m.setDisconnect(iso, on)),
            lock: act(() => m.applyLock(iso)),
            unlock: act(() => m.removeLock(iso)),
          }}
        />
        {sideMiddle}
        <RepairPanel
          machine={m}
          rev={rev}
          violation={violation}
          onReplace={(id) => {
            m.replace(id);
            setViolation(m.violations().includes('work_without_loto'));
            refresh();
          }}
        />
        {sideEnd}
      </aside>
    </div>
  );
}
