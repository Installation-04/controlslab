// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Work-order checker and checkpoint scoring. Pure functions over the
 * machine's event log + state, so results are reproducible.
 */
import { Machine, type MachineDef, type SimEvent } from '@controlslab/sim';
import { CellRunner, type EntityDef } from '@controlslab/factory';
import { CoSim } from './cosim';
import type { Checkpoint, Localized, Objective, PlcTest, Scenario, WorkOrder } from './schema';

export interface ObjectiveResult {
  label: Localized;
  pass: boolean;
  detail?: string;
}

export interface CheckResult {
  objectives: ObjectiveResult[];
  passed: boolean;
}

export interface CheckInput {
  order: WorkOrder;
  machine: Machine;
  /** Fresh definition, used to run PLC tests on a clean machine. */
  def: MachineDef;
  /** The learner's ST program (plc work orders). */
  plcSource?: string;
}

export interface PlcTestResult {
  pass: boolean;
  failures: string[];
  loadError?: string;
}

/** Run a scripted PLC test on a clean, fault-free machine. */
export function runPlcTest(def: MachineDef, source: string, test: PlcTest): PlcTestResult {
  const machine = new Machine(def);
  const sim = new CoSim(machine);
  const load = sim.load(source);
  if (!load.ok) return { pass: false, failures: [], loadError: load.errors[0]?.message };
  const failures: string[] = [];
  sim.run(100);
  for (const [i, step] of test.steps.entries()) {
    if ('press' in step) machine.press(step.press);
    else if ('release' in step) machine.release(step.release);
    else if ('wait' in step) sim.run(step.wait);
    else if ('inject' in step) machine.injectFault(step.inject);
    else if ('expect' in step) {
      const st = machine.state<Record<string, unknown>>(step.expect.component);
      if (st[step.expect.key] !== step.expect.equals) {
        failures.push(msg(step.msg) ?? `étape ${i + 1}: ${step.expect.component}.${step.expect.key} = ${String(st[step.expect.key])} (attendu ${String(step.expect.equals)})`);
      }
    } else if ('expectOutput' in step) {
      const v = Boolean(sim.plc.getOutput(step.expectOutput));
      if (v !== step.equals) failures.push(msg(step.msg) ?? `étape ${i + 1}: ${step.expectOutput} = ${v} (attendu ${step.equals})`);
    }
    // let the machine settle between steps
    sim.run(20);
  }
  return { pass: failures.length === 0, failures };
}

const msg = (l?: Localized) => (l === undefined ? undefined : typeof l === 'string' ? l : l.fr);

const measures = (events: SimEvent[]) =>
  events.flatMap((e) => (e.type === 'measure' ? [e.reading] : []));

export function checkObjective(o: Objective, input: CheckInput): ObjectiveResult {
  const { machine, order } = input;
  const label = o.label;
  const ok = (pass: boolean, detail?: string): ObjectiveResult => ({ label, pass, detail });
  switch (o.type) {
    case 'faults_cleared':
      return ok(machine.activeFaults().length === 0);
    case 'no_violation': {
      const v = machine.violations();
      return ok(o.code ? !v.includes(o.code) : v.length === 0, v.join(', ') || undefined);
    }
    case 'loto_step':
      return ok(machine.loto().steps[o.step] === 'done');
    case 'measured': {
      const [a, b] = o.points;
      const hit = measures(machine.events).some(
        (r) =>
          r.mode === o.mode &&
          !r.warning &&
          ((r.a === a && r.b === b) || (o.symmetric && r.a === b && r.b === a)) &&
          (o.min === undefined || r.value >= o.min) &&
          (o.max === undefined || r.value <= o.max),
      );
      return ok(hit);
    }
    case 'diagnosis':
      return ok(machine.events.some((e) => e.type === 'diagnosis' && e.correct));
    case 'state':
      return ok(machine.state<Record<string, unknown>>(o.component)[o.key] === o.equals);
    case 'lamp_lit':
      return ok(machine.state<{ lit: boolean }>(o.component).lit === true);
    case 'replaced':
      return ok(machine.events.some((e) => e.type === 'replace' && e.target === o.target && e.hadFault));
    case 'plc_test': {
      const test = order.plc?.tests.find((t) => t.id === o.test);
      if (!test) return ok(false, `test inconnu: ${o.test}`);
      if (input.plcSource === undefined) return ok(false, 'aucun programme');
      const r = runPlcTest(input.def, input.plcSource, test);
      return ok(r.pass, r.loadError ?? r.failures.join(' | '));
    }
  }
}

export function checkWorkOrder(input: CheckInput): CheckResult {
  const objectives = input.order.objectives.map((o) => checkObjective(o, input));
  return { objectives, passed: objectives.every((o) => o.pass) };
}

// ---------- Checkpoint scoring ----------
export interface ScoreLine {
  key: 'diagnosis' | 'loto' | 'efficiency' | 'restore';
  points: number;
  max: number;
  notes: string[];
}
export interface Score {
  lines: ScoreLine[];
  total: number;
  max: number;
  percent: number;
  passed: boolean;
}

export function scoreCheckpoint(cp: Checkpoint, machine: Machine): Score {
  const w = cp.weights;
  const events = machine.events;
  const loto = machine.loto();
  const violations = machine.violations();

  // Diagnosis: the last recorded diagnosis must be correct.
  const diags = events.filter((e) => e.type === 'diagnosis');
  const lastDiag = diags[diags.length - 1];
  const diagnosis: ScoreLine = {
    key: 'diagnosis',
    max: w.diagnosis,
    points: lastDiag && lastDiag.type === 'diagnosis' && lastDiag.correct ? w.diagnosis : 0,
    notes: diags.length === 0 ? ['aucun diagnostic'] : diags.length > 1 ? [`${diags.length} essais`] : [],
  };

  // LOTO: everything up to verification done, no work without it, no ohms on live.
  const lotoNotes: string[] = [];
  const core = ['notify', 'shutdown', 'isolate', 'lockout', 'stored_energy', 'try_start', 'verify'] as const;
  const missing = core.filter((s) => loto.steps[s] !== 'done');
  if (missing.length) lotoNotes.push(`étapes manquantes: ${missing.join(', ')}`);
  let lotoPts = missing.length ? 0 : w.loto;
  if (violations.includes('work_without_loto')) {
    lotoPts = 0;
    lotoNotes.push('travail sans cadenassage');
  }
  const ohmsLive = violations.filter((v) => v === 'ohms_on_live').length;
  if (ohmsLive) {
    lotoPts = Math.max(0, lotoPts - 0.25 * w.loto * ohmsLive);
    lotoNotes.push(`ohmmètre sur circuit sous tension ×${ohmsLive}`);
  }
  if (violations.includes('disconnect_under_load')) {
    lotoPts = Math.max(0, lotoPts - 0.25 * w.loto);
    lotoNotes.push('sectionneur ouvert en charge');
  }
  const lotoLine: ScoreLine = { key: 'loto', max: w.loto, points: lotoPts, notes: lotoNotes };

  // Efficiency
  const nMeasures = events.filter((e) => e.type === 'measure').length;
  const wrong = events.filter((e) => e.type === 'replace' && !e.hadFault).length;
  const eff = cp.efficiency;
  const extra = Math.max(0, nMeasures - eff.freeMeasurements);
  const effNotes: string[] = [];
  if (extra) effNotes.push(`${extra} mesure(s) au-delà de ${eff.freeMeasurements}`);
  if (wrong) effNotes.push(`${wrong} pièce(s) remplacée(s) inutilement`);
  const efficiency: ScoreLine = {
    key: 'efficiency',
    max: w.efficiency,
    points: Math.max(0, w.efficiency - extra * eff.perExtraMeasurement - wrong * eff.perWrongPart),
    notes: effNotes,
  };

  // Restore: fault repaired and machine returned to service in the right order.
  const faultsGone = machine.activeFaults().length === 0;
  const restoreNotes: string[] = [];
  if (!faultsGone) restoreNotes.push('défaut non corrigé');
  if (loto.steps.restore !== 'done') restoreNotes.push('remise en service incomplète');
  const restore: ScoreLine = {
    key: 'restore',
    max: w.restore,
    points: faultsGone && loto.steps.restore === 'done' ? w.restore : 0,
    notes: restoreNotes,
  };

  const lines = [diagnosis, lotoLine, efficiency, restore];
  const max = lines.reduce((s, l) => s + l.max, 0);
  const total = Math.round(lines.reduce((s, l) => s + l.points, 0));
  const percent = max ? Math.round((total / max) * 100) : 0;
  return { lines, total, max, percent, passed: percent >= cp.passScore };
}

/** Deterministic fault draw for a checkpoint attempt. */
export function pickFault(cp: Checkpoint, seed: number): string {
  let a = seed >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return cp.pool[Math.floor(r * cp.pool.length)]!;
}

// ---------- Scenario (3D cell) checking ----------
export interface ScenarioResult extends CheckResult {
  tests: Array<{ id: string; pass: boolean; failures: string[]; loadError?: string }>;
}

/** Run every scripted test of a scenario against the learner's program, each on a fresh cell. */
export function checkScenario(scenario: Scenario, entities: EntityDef[], machines: Record<string, MachineDef>, source: string): ScenarioResult {
  const tests = scenario.plc.tests.map((t) => {
    const runner = new CellRunner({ entities: structuredClone(entities), machines, faults: scenario.faults }, source);
    const r = runner.playScript(t.steps as never);
    return { id: t.id, ...r };
  });
  const objectives: ObjectiveResult[] = scenario.objectives.map((o) => {
    const t = tests.find((x) => x.id === o.test);
    return { label: o.label, pass: !!t?.pass, detail: t ? (t.loadError ?? t.failures.join(' | ')) || undefined : `test inconnu: ${o.test}` };
  });
  return { objectives, passed: objectives.every((o) => o.pass), tests };
}
