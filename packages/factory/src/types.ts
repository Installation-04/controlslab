// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Factory-cell model. Units: metres, milliseconds. Top view: x → east, z → south.
 * Rotation 0 faces +x, 90 faces +z, 180 faces −x, 270 faces −z.
 */
export type Rot = 0 | 90 | 180 | 270;

export type EntityType =
  | 'conveyor'
  | 'spawner'
  | 'photo'
  | 'prox'
  | 'pusher'
  | 'button'
  | 'light'
  | 'stacklight'
  | 'bin'
  | 'panel';

export type ItemKind = 'plastic' | 'metal' | 'cardboard';
export const ITEM_KINDS: ItemKind[] = ['plastic', 'metal', 'cardboard'];

export type ParamValue = number | string | boolean;

export interface EntityDef {
  id: string;
  type: EntityType;
  x: number;
  z: number;
  rot: Rot;
  params?: Record<string, ParamValue>;
  /** Signal name → PLC address (e.g. "detect": "%IX1.0"). Empty/missing = unbound. */
  io?: Record<string, string>;
  /** Free label shown in the editor. */
  name?: string;
  /** Scenario-fixed entity: cannot be moved or deleted by the learner. */
  locked?: boolean;
}

export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  z: number;
  /** Footprint (m). */
  w: number;
  d: number;
  h: number;
  /** Has left the belts without reaching a bin. */
  onFloor: boolean;
}

export interface SignalDef {
  name: string;
  /** "input" = the PLC reads it (sensor → PLC); "output" = the PLC writes it (PLC → actuator). */
  dir: 'input' | 'output';
  label: { fr: string; en: string };
}

export interface ParamDef {
  key: string;
  label: { fr: string; en: string };
  type: 'number' | 'boolean' | 'select' | 'text';
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface EntitySpec {
  label: { fr: string; en: string };
  /** Footprint on the floor (m), before rotation. */
  size: (p: Record<string, ParamValue>) => [number, number];
  signals: SignalDef[];
  params: ParamDef[];
}

const L = (fr: string, en: string) => ({ fr, en });
const num = (key: string, fr: string, en: string, def: number, min: number, max: number, step: number): ParamDef => ({
  key, label: L(fr, en), type: 'number', default: def, min, max, step,
});

export const SPECS: Record<EntityType, EntitySpec> = {
  conveyor: {
    label: L('Convoyeur', 'Conveyor'),
    size: (p) => [Number(p.length ?? 2), 0.5],
    signals: [{ name: 'run', dir: 'output', label: L('Marche (sortie)', 'Run (output)') }],
    params: [
      num('length', 'Longueur (m)', 'Length (m)', 2, 0.5, 6, 0.5),
      num('speed', 'Vitesse (m/s)', 'Speed (m/s)', 0.5, 0.1, 1.5, 0.1),
      { key: 'drive', label: L('Entraînement', 'Drive'), type: 'select', default: 'direct', options: ['direct', 'panel'] },
      { key: 'reverse', label: L('Sens inverse', 'Reverse'), type: 'boolean', default: false },
    ],
  },
  spawner: {
    label: L('Distributeur de boîtes', 'Box dispenser'),
    size: () => [0.5, 0.5],
    signals: [],
    params: [
      num('intervalMs', 'Intervalle (ms)', 'Interval (ms)', 3000, 500, 20000, 500),
      num('max', 'Nombre maximal', 'Max boxes', 10, 1, 100, 1),
      { key: 'pattern', label: L('Séquence', 'Sequence'), type: 'text', default: 'plastic,metal' },
    ],
  },
  photo: {
    label: L('Détecteur photoélectrique', 'Photoelectric sensor'),
    size: () => [0.12, 0.12],
    signals: [{ name: 'detect', dir: 'input', label: L('Détection (entrée)', 'Detect (input)') }],
    params: [num('range', 'Portée (m)', 'Range (m)', 0.7, 0.1, 2, 0.1)],
  },
  prox: {
    label: L('Détecteur inductif (métal)', 'Inductive sensor (metal)'),
    size: () => [0.1, 0.1],
    signals: [{ name: 'detect', dir: 'input', label: L('Détection (entrée)', 'Detect (input)') }],
    params: [num('range', 'Portée (m)', 'Range (m)', 0.12, 0.02, 0.4, 0.01)],
  },
  pusher: {
    label: L('Vérin pousseur', 'Pusher cylinder'),
    size: () => [0.3, 0.3],
    signals: [
      { name: 'extend', dir: 'output', label: L('Sortir (sortie)', 'Extend (output)') },
      { name: 'retracted', dir: 'input', label: L('Fin de course rentré (entrée)', 'Retracted limit (input)') },
      { name: 'extended', dir: 'input', label: L('Fin de course sorti (entrée)', 'Extended limit (input)') },
    ],
    params: [
      num('stroke', 'Course (m)', 'Stroke (m)', 0.6, 0.2, 1.2, 0.1),
      num('strokeMs', 'Durée de la course (ms)', 'Stroke time (ms)', 500, 100, 3000, 100),
    ],
  },
  button: {
    label: L('Bouton-poussoir', 'Pushbutton'),
    size: () => [0.2, 0.2],
    signals: [{ name: 'state', dir: 'input', label: L('État (entrée)', 'State (input)') }],
    params: [
      { key: 'contact', label: L('Contact', 'Contact'), type: 'select', default: 'NO', options: ['NO', 'NC'] },
      { key: 'latching', label: L('À accrochage', 'Latching'), type: 'boolean', default: false },
      { key: 'color', label: L('Couleur', 'Colour'), type: 'select', default: 'green', options: ['green', 'red', 'black'] },
    ],
  },
  light: {
    label: L('Voyant', 'Pilot light'),
    size: () => [0.15, 0.15],
    signals: [{ name: 'on', dir: 'output', label: L('Allumé (sortie)', 'On (output)') }],
    params: [{ key: 'color', label: L('Couleur', 'Colour'), type: 'select', default: 'green', options: ['green', 'amber', 'red', 'white'] }],
  },
  stacklight: {
    label: L('Colonne lumineuse', 'Stack light'),
    size: () => [0.2, 0.2],
    signals: [
      { name: 'green', dir: 'output', label: L('Vert (sortie)', 'Green (output)') },
      { name: 'amber', dir: 'output', label: L('Ambre (sortie)', 'Amber (output)') },
      { name: 'red', dir: 'output', label: L('Rouge (sortie)', 'Red (output)') },
    ],
    params: [],
  },
  bin: {
    label: L('Bac de réception', 'Collection bin'),
    size: (p) => [Number(p.size ?? 0.7), Number(p.size ?? 0.7)],
    signals: [],
    params: [num('size', 'Côté (m)', 'Side (m)', 0.7, 0.4, 1.5, 0.1)],
  },
  panel: {
    label: L('Panneau électrique', 'Electrical panel'),
    size: () => [0.8, 0.35],
    signals: [],
    params: [{ key: 'machine', label: L('Panneau', 'Panel'), type: 'text', default: 'motor-starter-plc' }],
  },
};

export function defaultParams(type: EntityType): Record<string, ParamValue> {
  return Object.fromEntries(SPECS[type].params.map((p) => [p.key, p.default]));
}

export const resolveParams = (e: EntityDef): Record<string, ParamValue> => ({ ...defaultParams(e.type), ...e.params });

export const dirOf = (rot: Rot): [number, number] => [[1, 0], [0, 1], [-1, 0], [0, -1]][rot / 90] as [number, number];

export function newId(type: EntityType, existing: Iterable<string>): string {
  const used = new Set(existing);
  const prefix = { conveyor: 'CV', spawner: 'SP', photo: 'PH', prox: 'PX', pusher: 'PU', button: 'BT', light: 'LT', stacklight: 'SL', bin: 'BN', panel: 'PN' }[type];
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}
