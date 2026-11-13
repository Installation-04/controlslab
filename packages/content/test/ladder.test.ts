import { describe, expect, it } from 'vitest';
import { coil, contact, parallel, rung, series, toST, uid, type LdProgram } from '@controlslab/ladder';
import { checkWorkOrder } from '../src';
import { defById, woById } from './helpers';

const vars: LdProgram['vars'] = [
  { name: 'Marche', type: 'BOOL', address: '%IX0.0' },
  { name: 'Arret', type: 'BOOL', address: '%IX0.1' },
  { name: 'Surcharge', type: 'BOOL', address: '%IX0.2' },
  { name: 'AU_OK', type: 'BOOL', address: '%IX0.3' },
  { name: 'RetourM', type: 'BOOL', address: '%IX0.4' },
  { name: 'BobineM', type: 'BOOL', address: '%QX0.0' },
  { name: 'VoyantMarche', type: 'BOOL', address: '%QX0.1' },
];

const sealInLd = (): LdProgram => ({
  v: 1, name: 'Main', vars,
  rungs: [
    rung(series(parallel(contact('Marche'), contact('BobineM')), contact('Arret'), contact('Surcharge', 'NC'), contact('AU_OK')), [coil('BobineM')], 'Auto-maintien'),
    rung(contact('RetourM'), [coil('VoyantMarche')], 'Voyant'),
  ],
});

const timedLd = (): LdProgram => ({
  v: 1, name: 'Main', vars: [...vars, { name: 'Demande', type: 'BOOL' }],
  rungs: [
    rung(series(parallel(contact('Marche'), contact('Demande')), contact('Arret'), contact('Surcharge', 'NC'), contact('AU_OK')), [coil('Demande')], 'Demande de démarrage'),
    rung(contact('Demande'), [{ id: uid('o'), t: 'timer', fb: 'TON', name: 'T1', pt: 'T#3s' }], 'Délai de 3 s'),
    rung(contact('T1.Q'), [coil('BobineM')], 'Contacteur'),
    rung(parallel(series(contact('Demande'), contact('T1.Q', 'NC')), contact('RetourM')), [coil('VoyantMarche')], 'Avertissement'),
  ],
});

const check = (id: string, source: string) => {
  const order = woById(id);
  return checkWorkOrder({ order, machine: undefined as never, def: defById(order.machine), plcSource: source });
};
const fails = (r: ReturnType<typeof check>) => r.objectives.filter((o) => !o.pass).map((o) => o.detail);

describe('Ladder programs pass the same scripted PLC tests as ST', () => {
  it('wo-005 seal-in written in Ladder', () => {
    expect(fails(check('wo-005-programme-st', toST(sealInLd())))).toEqual([]);
  });

  it('wo-006 timed start with warning lamp — in Ladder', () => {
    const r = check('wo-006-demarrage-temporise', toST(timedLd()));
    expect(fails(r)).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it('wo-006 starter does nothing; a plain seal-in (no delay) fails the delay test with a precise message', () => {
    expect(check('wo-006-demarrage-temporise', woById('wo-006-demarrage-temporise').plc!.starter!).passed).toBe(false);
    const r = check('wo-006-demarrage-temporise', toST(sealInLd()));
    expect(r.passed).toBe(false);
    expect(r.objectives[0]!.detail).toMatch(/avant la fin des 3 secondes|voyant/);
  });

  it('wo-006 without cancelling the request on STOP is caught', () => {
    const bad = timedLd();
    // Latch the request without the STOP contact: STOP only drops the coil path later.
    bad.rungs[0] = rung(series(parallel(contact('Marche'), contact('Demande')), contact('Surcharge', 'NC'), contact('AU_OK')), [coil('Demande')]);
    const r = check('wo-006-demarrage-temporise', toST(bad));
    expect(r.objectives.find((o) => o.label === 'ARRÊT pendant le délai annule le démarrage' || String((o.label as { fr?: string }).fr ?? o.label).includes('annule'))!.pass).toBe(false);
  });
});

describe('ladder starters in content', () => {
  it('every starter declares the same addresses as its ST starter', async () => {
    const { workorders, scenarios } = await import('./helpers');
    const all = [...workorders().map((w) => w.data.plc), ...scenarios().map((s) => s.data.plc)].filter(Boolean);
    for (const plc of all) {
      if (!plc!.ldStarter) continue;
      const addrs = new Set([...String(plc!.starter).matchAll(/%[IQ]X\d+\.\d+/g)].map((m) => m[0]));
      const ld = new Set(plc!.ldStarter.vars.map((v) => v.address).filter(Boolean));
      for (const a of addrs) expect(ld.has(a), `missing ${a}`).toBe(true);
    }
  });
});
