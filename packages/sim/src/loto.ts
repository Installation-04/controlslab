// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Lockout / tagout procedure tracker. Pure function of the machine
 * definition and its event log, so it is trivially testable and the UI,
 * checker and scoring all agree on the same result.
 *
 * Steps (typical Québec / CSA Z460 practice):
 *  1 notify          aviser les personnes touchées
 *  2 shutdown        arrêt normal avec les commandes (pas sous charge au sectionneur)
 *  3 isolate         ouvrir le(s) dispositif(s) d'isolement
 *  4 lockout         cadenas personnel + étiquette
 *  5 stored_energy   dissiper / vérifier l'énergie résiduelle (moteur arrêté…)
 *  6 try_start       tentative de démarrage
 *  7 verify          vérification d'absence de tension : vivant – mort – vivant
 *  8 restore         remise en service (travail terminé, cadenas retirés, réarmement)
 */
import type { MachineDef, SimEvent } from './types';

export const LOTO_STEPS = [
  'notify', 'shutdown', 'isolate', 'lockout', 'stored_energy', 'try_start', 'verify', 'restore',
] as const;
export type LotoStepId = (typeof LOTO_STEPS)[number];

export type StepStatus = 'pending' | 'done' | 'failed';

export interface LotoStatus {
  steps: Record<LotoStepId, StepStatus>;
  /** Index of the next step to perform, or null if complete. */
  current: LotoStepId | null;
  /** Zero-energy state verified and still locked out: work may proceed. */
  workAllowed: boolean;
  /** Energy found during verification (a dead reading that was not dead). */
  hazardFound: boolean;
  /** Verify sub-progress, for the UI. */
  verify: { liveBefore: boolean; points: Array<{ a: string; b: string; ok: boolean }>; liveAfter: boolean };
}

const LIVE_V = 50;
const DEAD_V = 5;

const samePair = (a: string, b: string, p: [string, string]) => (a === p[0] && b === p[1]) || (a === p[1] && b === p[0]);

export function computeLoto(def: MachineDef, events: SimEvent[]): LotoStatus {
  const iso = def.loto.isolators;
  const steps = Object.fromEntries(LOTO_STEPS.map((s) => [s, 'pending'])) as Record<LotoStepId, StepStatus>;
  const off = new Set<string>();
  const locked = new Set<string>();
  let liveBefore = false;
  let liveAfter = false;
  let hazardFound = false;
  let workDone = false;
  let pointsOk = def.loto.verifyPoints.map(() => false);

  const isDone = (s: LotoStepId) => steps[s] !== 'pending';
  const resetFrom = (s: LotoStepId) => {
    for (const x of LOTO_STEPS.slice(LOTO_STEPS.indexOf(s))) steps[x] = 'pending';
    if (LOTO_STEPS.indexOf(s) <= LOTO_STEPS.indexOf('verify')) {
      liveBefore = liveAfter = hazardFound = false;
      pointsOk = pointsOk.map(() => false);
    }
    if (LOTO_STEPS.indexOf(s) <= LOTO_STEPS.indexOf('restore')) workDone = false;
  };

  for (const e of events) {
    switch (e.type) {
      case 'notify':
        if (!isDone('notify')) steps.notify = 'done';
        break;
      case 'disconnect':
        if (!iso.includes(e.component)) break;
        if (!e.on) {
          off.add(e.component);
          if (isDone('notify') && !isDone('isolate') && iso.every((i) => off.has(i))) {
            steps.shutdown = e.underLoad ? 'failed' : 'done';
            steps.isolate = 'done';
          }
        } else {
          off.delete(e.component);
          if (isDone('verify') && workDone && locked.size === 0 && isDone('lockout')) {
            steps.restore = 'done';
          } else if (isDone('isolate')) {
            // Re-energized before the procedure was completed: start over.
            resetFrom('shutdown');
          }
        }
        break;
      case 'lock_applied':
        if (!iso.includes(e.component)) break;
        locked.add(e.component);
        if (isDone('isolate') && !isDone('lockout') && iso.every((i) => locked.has(i))) steps.lockout = 'done';
        break;
      case 'lock_removed':
        locked.delete(e.component);
        if (isDone('lockout') && !workDone) resetFrom('lockout');
        break;
      case 'stored_energy_checked':
        if (isDone('lockout') && !isDone('stored_energy')) steps.stored_energy = 'done';
        break;
      case 'press':
        if (e.component === def.loto.tryStart && isDone('stored_energy') && !isDone('try_start')) {
          steps.try_start = 'done';
        }
        break;
      case 'measure': {
        if (!isDone('try_start') || isDone('verify')) break;
        const r = e.reading;
        if (r.mode !== 'VAC') break;
        const known = def.loto.knownLive.some((p) => samePair(r.a, r.b, p));
        const allDead = pointsOk.every(Boolean);
        if (known && r.value > LIVE_V) {
          if (!liveBefore) liveBefore = true;
          else if (allDead) {
            liveAfter = true;
            steps.verify = 'done';
          }
          break;
        }
        if (!liveBefore) break;
        def.loto.verifyPoints.forEach((p, i) => {
          if (samePair(r.a, r.b, p)) {
            if (r.value < DEAD_V) pointsOk[i] = true;
            else {
              hazardFound = true;
              pointsOk[i] = false;
            }
          }
        });
        break;
      }
      case 'work_done':
        if (isDone('verify')) workDone = true;
        break;
    }
  }

  const current = LOTO_STEPS.find((s) => steps[s] === 'pending') ?? null;
  const workAllowed =
    isDone('verify') && !workDone && iso.every((i) => locked.has(i) && off.has(i)) && !hazardFound;
  return {
    steps,
    current,
    workAllowed,
    hazardFound,
    verify: {
      liveBefore,
      liveAfter,
      points: def.loto.verifyPoints.map((p, i) => ({ a: p[0], b: p[1], ok: pointsOk[i]! })),
    },
  };
}
