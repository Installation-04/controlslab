// SPDX-License-Identifier: AGPL-3.0-only
/** Machine definition (authored as YAML in /content/machines). */

/** Text in one or more locales: plain string = French. */
export type Localized = string | { fr: string; en?: string };

export type Point = [number, number];
export type Rotation = 0 | 90 | 180 | 270;

export interface PartPlacement {
  at: Point;
  rot?: Rotation;
}

export interface ComponentDef {
  id: string;
  type: string;
  /** Designation shown on the schematic, e.g. "M", "OL", "PB1". Defaults to id. */
  tag?: string;
  label?: Localized;
  /** Placement of each drawn part (most types have a single part "main"). */
  parts: Record<string, PartPlacement>;
  params?: Record<string, number | string | boolean>;
}

export interface WireDef {
  id: string;
  /** Wire number, as printed on the schematic and on the wire marker. */
  label?: string;
  from: string; // "COMPONENT:TERMINAL"
  to: string;
  /** Optional intermediate points for drawing. Default: orthogonal L route. */
  via?: Point[];
  /** Junction dots (taps) drawn on the schematic. */
  junctions?: Point[];
}

export interface FaultDef {
  id: string;
  /** Component or wire id. */
  target: string;
  kind: string;
  label: Localized;
  /** Correct diagnosis text (for the checker / debrief). */
  diagnosis?: Localized;
}

export interface LotoDef {
  /** Energy-isolating devices to lock out (component ids, type disconnect3). */
  isolators: string[];
  /** Points known to be live with the isolator open (used for live-dead-live). */
  knownLive: Array<[string, string]>;
  /** Points that must read zero energy (all phase-phase and phase-ground). */
  verifyPoints: Array<[string, string]>;
  /** Push-button used for the try-start step. */
  tryStart?: string;
}

export interface PlcIoDef {
  address: string;
  /** Component id of the plc_input / plc_output wired to this address. */
  component: string;
  label: Localized;
}

export interface MachineDef {
  id: string;
  version: number;
  title: Localized;
  description?: Localized;
  mode: 'hardwired' | 'plc';
  viewBox: [number, number];
  components: ComponentDef[];
  wires: WireDef[];
  loto: LotoDef;
  faults: FaultDef[];
  plc?: { io: PlcIoDef[]; starterProgram?: string };
  notes?: Array<{ text: Localized; at: Point; size?: number }>;
}

export type MeterMode = 'VAC' | 'VDC' | 'OHM' | 'CONT' | 'AAC';

export interface MeterReading {
  mode: MeterMode;
  a: string;
  b: string;
  /** Numeric value (V or Ω). Infinity = over-range ("OL"). NaN = invalid. */
  value: number;
  display: string;
  unit: string;
  beep?: boolean;
  /** Set when the measurement itself was unsafe/invalid. */
  warning?: 'ohms_on_live';
}

export type SimEvent =
  | { t: number; type: 'press' | 'release' | 'estop_reset'; component: string }
  | { t: number; type: 'disconnect'; component: string; on: boolean; underLoad: boolean }
  | { t: number; type: 'lock_applied' | 'lock_removed'; component: string; owner: string }
  | { t: number; type: 'notify' | 'stored_energy_checked' | 'work_done' }
  | { t: number; type: 'measure'; reading: MeterReading; energized: boolean }
  | { t: number; type: 'replace'; target: string; hadFault: boolean; lotoOk: boolean }
  | { t: number; type: 'ol_reset'; component: string; ok: boolean }
  | { t: number; type: 'ol_trip'; component: string }
  | { t: number; type: 'fuse_blown'; component: string }
  | { t: number; type: 'fault_injected' | 'fault_cleared'; fault: string }
  | { t: number; type: 'diagnosis'; fault: string; correct: boolean }
  | { t: number; type: 'violation'; code: ViolationCode; detail?: string };

export type ViolationCode =
  | 'ohms_on_live'
  | 'work_without_loto'
  | 'disconnect_under_load'
  | 'lock_removed_before_restore';

/** SimEvent without its timestamp (distributes over the union). */
export type SimEventInput = SimEvent extends infer E ? (E extends SimEvent ? Omit<E, 't'> : never) : never;
