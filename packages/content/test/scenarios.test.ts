import { describe, expect, it } from 'vitest';
import { PlcRuntime } from '@controlslab/plc-engine';
import { validateCell, type EntityDef } from '@controlslab/factory';
import { checkScenario } from '../src';
import { machineMap, scenarioById, scenarios } from './helpers';

const STARTER = (extraVars = '', extraLogic = '', stopCond = '') => `PROGRAM Main
VAR
    Marche AT %IX0.0 : BOOL;
    Arret AT %IX0.1 : BOOL;
    Surcharge AT %IX0.2 : BOOL;
    AU_OK AT %IX0.3 : BOOL;
    RetourM AT %IX0.4 : BOOL;
    BobineM AT %QX0.0 : BOOL;
    VoyantMarche AT %QX0.1 : BOOL;
${extraVars}
END_VAR
BobineM := (Marche OR BobineM) AND Arret AND NOT Surcharge AND AU_OK${stopCond};
VoyantMarche := RetourM;
${extraLogic}
END_PROGRAM`;

const SOLUTIONS: Record<string, string> = {
  'sc-01-convoyeur': STARTER(),
  'sc-02-lot-de-3': STARTER(
    `    Detecteur AT %IX1.0 : BOOL;
    Reinit AT %IX1.1 : BOOL;
    Vert AT %QX1.0 : BOOL;
    Ambre AT %QX1.1 : BOOL;
    Rouge AT %QX1.2 : BOOL;
    Compteur : CTU;
    LotPlein : BOOL;`,
    `Vert := RetourM AND NOT LotPlein;
Ambre := LotPlein;
Rouge := Surcharge;`,
    ' AND NOT LotPlein',
  ).replace('BobineM :=', `Compteur(CU := Detecteur, R := Reinit, PV := 3);\nLotPlein := Compteur.Q;\nBobineM :=`),
  'sc-03-tri-metal': STARTER(
    `    DetMetal AT %IX1.0 : BOOL;
    DevantVerin AT %IX1.1 : BOOL;
    VerinRentre AT %IX1.2 : BOOL;
    VerinSorti AT %IX1.3 : BOOL;
    Sortir AT %QX1.0 : BOOL;
    Front : R_TRIG;
    Metal : BOOL;`,
    `Front(CLK := DetMetal);
IF Front.Q THEN Metal := TRUE; END_IF;
IF Metal AND DevantVerin AND VerinRentre THEN Sortir := TRUE; END_IF;
IF Sortir AND VerinSorti THEN Sortir := FALSE; Metal := FALSE; END_IF;`,
  ),
};

const check = (id: string, source: string) => {
  const sc = scenarioById(id);
  return checkScenario(sc, sc.entities as EntityDef[], machineMap(), source);
};
const failures = (r: ReturnType<typeof check>) => r.tests.flatMap((t) => t.failures.map((f) => `${t.id}: ${f}`));

describe('scenario content', () => {
  it('has three scenarios with valid references and bindings', () => {
    expect(scenarios().length).toBeGreaterThanOrEqual(3);
    const machines = machineMap();
    for (const { file, data: sc } of scenarios()) {
      const panel = sc.entities.find((e) => e.type === 'panel');
      expect(panel, `${file}: needs a panel`).toBeDefined();
      const def = machines[String(panel!.params?.machine)];
      expect(def?.mode, `${file}: panel machine`).toBe('plc');
      const issues = validateCell(sc.entities as EntityDef[], def).filter((i) => i.level === 'error');
      expect(issues, file).toEqual([]);
      for (const o of sc.objectives) expect(sc.plc.tests.some((t) => t.id === o.test), `${file}: ${o.test}`).toBe(true);
      const ids = sc.entities.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      // The starter program compiles (it only does nothing yet).
      const r = new PlcRuntime().load(sc.plc.starter);
      expect(r.ok, `${file}: ${JSON.stringify(r.errors)}`).toBe(true);
      // Every I/O address used by the entities is declared in the starter program.
      for (const e of sc.entities) for (const a of Object.values(e.io ?? {})) expect(sc.plc.starter.toUpperCase(), `${file}: ${a}`).toContain(a.toUpperCase());
    }
  });
});

describe('scenarios — model solutions pass, the starter does not', () => {
  it.each(Object.keys(SOLUTIONS))('%s', (id) => {
    const good = check(id, SOLUTIONS[id]!);
    expect(failures(good)).toEqual([]);
    expect(good.passed).toBe(true);
    const starter = check(id, scenarioById(id).plc.starter);
    expect(starter.passed).toBe(false);
  });

  it('syntax errors are reported as load errors', () => {
    const r = check('sc-01-convoyeur', 'PROGRAM Main x := ; END_PROGRAM');
    expect(r.passed).toBe(false);
    expect(r.tests[0]!.loadError).toMatch(/attendue/);
    expect(r.objectives[0]!.detail).toMatch(/attendue/);
  });

  it('sc-01: a program that ignores the E-stop input is caught', () => {
    const noAU = SOLUTIONS['sc-01-convoyeur']!.replace(' AND AU_OK', '');
    const r = check('sc-01-convoyeur', noAU);
    expect(r.tests.find((t) => t.id === 't-urgence')!.pass).toBe(false);
  });

  it('sc-01: no seal-in means the belt only runs while START is held', () => {
    const r = check('sc-01-convoyeur', SOLUTIONS['sc-01-convoyeur']!.replace('(Marche OR BobineM)', 'Marche'));
    expect(r.tests.find((t) => t.id === 't-marche')!.failures.join()).toMatch(/auto-maintien/);
  });

  it('sc-02: never stopping fails the batch test; stopping at 1 box fails the premature test', () => {
    const never = check('sc-02-lot-de-3', SOLUTIONS['sc-02-lot-de-3']!.replace('PV := 3', 'PV := 99'));
    expect(never.tests.find((t) => t.id === 't-lot')!.pass).toBe(false);
    const early = check('sc-02-lot-de-3', SOLUTIONS['sc-02-lot-de-3']!.replace('PV := 3', 'PV := 1'));
    expect(early.tests.find((t) => t.id === 't-pas-avant')!.pass).toBe(false);
  });

  it('sc-03: pushing every box (no metal check) sends plastic to the wrong bin', () => {
    const wrong = SOLUTIONS['sc-03-tri-metal']!.replace('IF Metal AND DevantVerin', 'IF DevantVerin').replace('Sortir AND VerinSorti THEN Sortir := FALSE; Metal := FALSE;', 'Sortir AND VerinSorti THEN Sortir := FALSE;');
    const r = check('sc-03-tri-metal', wrong);
    expect(r.tests.find((t) => t.id === 't-tri')!.pass).toBe(false);
    expect(r.tests.find((t) => t.id === 't-tri')!.failures.join()).toMatch(/plastique|métal/);
  });
});
