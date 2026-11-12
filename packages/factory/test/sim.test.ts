import { describe, expect, it } from 'vitest';
import { FactorySim, generateDeclarations, nextAddress, validateCell, type EntityDef } from '../src';

const belt = (over: Partial<EntityDef> = {}): EntityDef => ({ id: 'CV1', type: 'conveyor', x: 0, z: 0, rot: 0, params: { length: 3 }, io: { run: '%QX1.0' }, ...over });
const spawner = (over: Partial<EntityDef> = {}): EntityDef => ({ id: 'SP1', type: 'spawner', x: -1.2, z: 0, rot: 0, params: { intervalMs: 1000, max: 3, pattern: 'plastic,metal' }, ...over });

function run(sim: FactorySim, ms: number, outputs: Record<string, boolean> = {}, dt = 20) {
  for (let t = 0; t < ms; t += dt) sim.step(dt, outputs);
}

describe('belts and items', () => {
  it('spawns on the interval following the pattern, up to max', () => {
    const sim = new FactorySim([spawner()]);
    run(sim, 900);
    expect(sim.items).toHaveLength(0);
    run(sim, 200);
    expect(sim.items.map((i) => i.kind)).toEqual(['plastic']);
    run(sim, 10_000);
    // items stay put (no belt): spawner waits while its spot is occupied
    expect(sim.spawned).toBe(1);
  });

  it('carries items at belt speed only while run is TRUE', () => {
    const sim = new FactorySim([belt(), spawner({ params: { intervalMs: 500, max: 1, pattern: 'plastic' } })]);
    run(sim, 600);
    const x0 = sim.items[0]!.x;
    run(sim, 1000, { '%QX1.0': false });
    expect(sim.items[0]!.x).toBeCloseTo(x0, 5);
    run(sim, 1000, { '%QX1.0': true });
    expect(sim.items[0]!.x - x0).toBeCloseTo(0.5, 1);
    expect(sim.belt.CV1).toBe(1);
  });

  it('reverse flag and speed parameter', () => {
    const sim = new FactorySim([belt({ params: { length: 3, speed: 1, reverse: true } }), spawner({ x: 0, params: { intervalMs: 500, max: 1, pattern: 'metal' } })]);
    run(sim, 600);
    const x0 = sim.items[0]!.x;
    run(sim, 500, { '%QX1.0': true });
    expect(sim.items[0]!.x - x0).toBeCloseTo(-0.5, 1);
  });

  it('is independent of the caller tick size', () => {
    const make = (dt: number) => {
      const sim = new FactorySim([belt(), spawner({ params: { intervalMs: 500, max: 3, pattern: 'plastic,metal,cardboard' } })]);
      run(sim, 6000, { '%QX1.0': true }, dt);
      return sim.items.map((i) => +i.x.toFixed(3));
    };
    expect(make(10)).toEqual(make(50));
  });

  it('items never overlap on the belt, and a jammed belt stops the dispenser', () => {
    const sim = new FactorySim([belt({ params: { length: 3 } }), spawner({ x: -1.2, params: { intervalMs: 500, max: 20, pattern: 'plastic' } })]);
    // Belt running a little, then stopped: boxes pile up behind each other at the spawn point.
    for (let t = 0; t < 30_000; t += 20) {
      sim.step(20, { '%QX1.0': t < 2000 });
      const live = sim.items.filter((i) => !i.onFloor);
      for (const a of live) for (const b of live) if (a !== b) expect(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 - 1e-6 || Math.abs(a.z - b.z) >= (a.d + b.d) / 2 - 1e-6).toBe(true);
    }
    expect(sim.spawned).toBeLessThan(6);
  });

  it('items falling off the belt end are counted as lost; bins collect and count by kind', () => {
    const entities: EntityDef[] = [belt({ params: { length: 2 } }), spawner({ x: -0.8, params: { intervalMs: 500, max: 2, pattern: 'plastic,metal' } })];
    const lost = new FactorySim(entities);
    run(lost, 8000, { '%QX1.0': true });
    expect(lost.lost).toBe(2);

    const withBin = new FactorySim([...entities, { id: 'BN1', type: 'bin', x: 1.2, z: 0, rot: 0, params: { size: 0.7 } }]);
    run(withBin, 8000, { '%QX1.0': true });
    expect(withBin.lost).toBe(0);
    expect(withBin.total('BN1')).toBe(2);
    expect(withBin.total('BN1', 'metal')).toBe(1);
    expect(withBin.total('BN1', 'plastic')).toBe(1);
    expect(withBin.total('nope')).toBe(0);
  });
});

describe('sensors', () => {
  const entities = (): EntityDef[] => [
    belt(),
    spawner({ params: { intervalMs: 500, max: 2, pattern: 'plastic,metal' } }),
    { id: 'PH1', type: 'photo', x: 0, z: -0.6, rot: 90, params: { range: 0.8 }, io: { detect: '%IX1.0' } },
    { id: 'PX1', type: 'prox', x: 0, z: -0.32, rot: 90, params: { range: 0.2 }, io: { detect: '%IX1.1' } },
  ];

  it('photo-eye sees every item crossing the beam; prox only metal', () => {
    const sim = new FactorySim(entities());
    const seen = { photo: 0, prox: 0 };
    let prev = { p: false, x: false };
    for (let t = 0; t < 12_000; t += 20) {
      sim.step(20, { '%QX1.0': true });
      const i = sim.readInputs();
      if (i['%IX1.0'] && !prev.p) seen.photo++;
      if (i['%IX1.1'] && !prev.x) seen.prox++;
      prev = { p: !!i['%IX1.0'], x: !!i['%IX1.1'] };
    }
    expect(seen).toEqual({ photo: 2, prox: 1 });
  });

  it('no detection when the belt is empty', () => {
    const sim = new FactorySim([{ id: 'PH1', type: 'photo', x: 0, z: -0.6, rot: 90, io: { detect: '%IX1.0' } }]);
    sim.step(20, {});
    expect(sim.readInputs()['%IX1.0']).toBe(false);
  });
});

describe('pusher', () => {
  const layout = (): EntityDef[] => [
    belt({ params: { length: 3 } }),
    spawner({ x: 0, params: { intervalMs: 500, max: 1, pattern: 'plastic' } }),
    { id: 'PU1', type: 'pusher', x: 0, z: -0.5, rot: 90, params: { stroke: 1, strokeMs: 500 }, io: { extend: '%QX1.1', retracted: '%IX1.2', extended: '%IX1.3' } },
    { id: 'BN1', type: 'bin', x: 0.2, z: 1.0, rot: 0, params: { size: 1 } },
  ];

  it('limit switches follow the stroke; pushing moves the box off the belt into the bin', () => {
    const sim = new FactorySim(layout());
    run(sim, 600);
    expect(sim.readInputs()['%IX1.2']).toBe(true);
    expect(sim.readInputs()['%IX1.3']).toBe(false);
    run(sim, 200, { '%QX1.1': true });
    expect(sim.readInputs()['%IX1.2']).toBe(false);
    run(sim, 1000, { '%QX1.1': true });
    expect(sim.readInputs()['%IX1.3']).toBe(true);
    expect(sim.total('BN1', 'plastic')).toBe(1);
    expect(sim.lost).toBe(0);
    run(sim, 1000, { '%QX1.1': false });
    expect(sim.readInputs()['%IX1.2']).toBe(true);
  });

  it('a short stroke only nudges the box (and it ends up lost on the floor)', () => {
    const l = layout();
    l[2] = { ...l[2]!, params: { stroke: 0.55, strokeMs: 500 } };
    const sim = new FactorySim(l);
    run(sim, 600);
    run(sim, 1500, { '%QX1.1': true });
    expect(sim.total('BN1')).toBe(0);
  });
});

describe('buttons', () => {
  const b = (params: EntityDef['params']): EntityDef => ({ id: 'BT1', type: 'button', x: 0, z: 0, rot: 0, params, io: { state: '%IX1.0' } });
  it('NO momentary', () => {
    const sim = new FactorySim([b({})]);
    expect(sim.readInputs()['%IX1.0']).toBe(false);
    sim.press('BT1');
    expect(sim.readInputs()['%IX1.0']).toBe(true);
    sim.release('BT1');
    expect(sim.readInputs()['%IX1.0']).toBe(false);
  });
  it('NC reads TRUE at rest', () => {
    const sim = new FactorySim([b({ contact: 'NC' })]);
    expect(sim.readInputs()['%IX1.0']).toBe(true);
    sim.press('BT1');
    expect(sim.readInputs()['%IX1.0']).toBe(false);
    expect(sim.isPressed('BT1')).toBe(true);
  });
  it('latching toggles and ignores release; unknown ids are ignored', () => {
    const sim = new FactorySim([b({ latching: true })]);
    sim.press('BT1');
    sim.release('BT1');
    expect(sim.readInputs()['%IX1.0']).toBe(true);
    sim.press('BT1');
    expect(sim.readInputs()['%IX1.0']).toBe(false);
    sim.press('nope');
    sim.release('nope');
  });
});

describe('belt driven by an external motor', () => {
  it('uses the supplied factor instead of the PLC output', () => {
    const sim = new FactorySim([belt({ params: { length: 3, drive: 'panel' } }), spawner({ params: { intervalMs: 500, max: 1, pattern: 'plastic' } })]);
    run(sim, 600);
    const x0 = sim.items[0]!.x;
    run(sim, 1000, { '%QX1.0': true });
    expect(sim.items[0]!.x).toBeCloseTo(x0, 5);
    sim.setExternalDrive('CV1', 0.5);
    run(sim, 1000);
    expect(sim.items[0]!.x - x0).toBeCloseTo(0.25, 1);
  });
});

describe('validation and helpers', () => {
  const panel = {
    id: 'p', version: 1, title: 'p', mode: 'plc', viewBox: [1, 1], wires: [], faults: [], loto: { isolators: [], knownLive: [], verifyPoints: [] },
    components: [
      { id: 'I0', type: 'plc_input', parts: {}, params: { address: '%IX0.0' } },
      { id: 'Q0', type: 'plc_output', parts: {}, params: { address: '%QX0.0' } },
    ],
  } as never;

  it('flags bad addresses, wrong area, conflicts, duplicates and overlaps', () => {
    const issues = validateCell(
      [
        { id: 'PH1', type: 'photo', x: 0, z: 0, rot: 0, io: { detect: 'nope' } },
        { id: 'PH2', type: 'photo', x: 0, z: 0, rot: 0, io: { detect: '%QX1.0' } },
        { id: 'PH3', type: 'photo', x: 0, z: 0, rot: 0, io: { detect: '%IX0.0' } },
        { id: 'PH4', type: 'photo', x: 0, z: 0, rot: 0, io: { detect: '%IX1.5' } },
        { id: 'PH5', type: 'photo', x: 0, z: 0, rot: 0, io: { detect: '%ix1.5' } },
        { id: 'PH5', type: 'photo', x: 0, z: 0, rot: 0 },
        { id: 'BN1', type: 'bin', x: 0, z: 0, rot: 0 },
        { id: 'BN2', type: 'bin', x: 0.2, z: 0, rot: 90 },
      ],
      panel,
    );
    const codes = issues.map((i) => i.code);
    for (const c of ['bad_address', 'wrong_area', 'panel_conflict', 'input_conflict', 'duplicate_id', 'unbound', 'overlap']) expect(codes).toContain(c);
  });

  it('accepts a clean layout (belts may chain; unbound outputs are only warnings)', () => {
    const issues = validateCell([belt({ io: { run: '%QX1.0' } }), belt({ id: 'CV2', x: 3 })]);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('suggests free addresses starting at byte 1 and skipping panel/used ones', () => {
    expect(nextAddress([], 'I', panel)).toBe('%IX1.0');
    expect(nextAddress([{ id: 'a', type: 'photo', x: 0, z: 0, rot: 0, io: { detect: '%IX1.0' } }], 'I')).toBe('%IX1.1');
    const full = Array.from({ length: 70 }, (_, i) => ({ id: `s${i}`, type: 'photo' as const, x: 0, z: 0, rot: 0 as const, io: { detect: `%QX${Math.floor(i / 8) + 1}.${i % 8}` } }));
    expect(nextAddress(full, 'Q')).toBe('%QX8.0');
  });

  it('generates ST declarations for panel and field I/O', () => {
    const st = generateDeclarations([{ id: 'PH1', type: 'photo', x: 0, z: 0, rot: 0, io: { detect: '%IX1.0' } }, { id: 'CV1', type: 'conveyor', x: 0, z: 0, rot: 0, io: { run: '%QX1.0' } }], panel);
    expect(st).toContain('PH1_detect');
    expect(st).toContain('AT %IX1.0');
    expect(st).toContain('Panneau_I0');
    expect(st).toContain('CV1_run');
    expect(st.startsWith('VAR')).toBe(true);
    expect(st.endsWith('END_VAR')).toBe(true);
  });
});
