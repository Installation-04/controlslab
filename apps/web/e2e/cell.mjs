// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of the 3D cell (needs WebGL: software rendering is enabled below).
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright'));
}

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));

let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);
const assert = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  ok(msg);
};
const text = (sel) => page.locator(sel).first().innerText();
const entityCount = () => page.evaluate(() => window.__cellCore.factory.entities.length);

const SOLUTION = `PROGRAM Main
VAR
    Marche AT %IX0.0 : BOOL;
    Arret AT %IX0.1 : BOOL;
    Surcharge AT %IX0.2 : BOOL;
    AU_OK AT %IX0.3 : BOOL;
    RetourM AT %IX0.4 : BOOL;
    BobineM AT %QX0.0 : BOOL;
    VoyantMarche AT %QX0.1 : BOOL;
END_VAR
BobineM := (Marche OR BobineM) AND Arret AND NOT Surcharge AND AU_OK;
VoyantMarche := RetourM;
END_PROGRAM`;

try {
  // 1. Free cell renders in 3D
  await page.goto(`${BASE}#/cells/free`);
  await page.waitForSelector('[data-testid="cell-canvas"] canvas', { timeout: 20000 });
  await page.waitForFunction(() => window.__cellCore?.factory?.entities?.length === 4);
  ok('free cell renders (WebGL canvas, 4 starter entities)');

  // 2. Drag a sensor from the palette into the scene
  const canvas = page.getByTestId('cell-canvas');
  await page.getByTestId('pal-photo').dragTo(canvas, { targetPosition: { x: 520, y: 360 } });
  await page.waitForFunction(() => window.__cellCore.factory.entities.length === 5);
  assert((await text('[data-testid="inspector"]')).includes('PH1'), 'drag & drop adds a photoelectric sensor and selects it');
  assert((await page.getByTestId('io-detect').inputValue()) === '%IX1.0', 'I/O mapping auto-assigns the first free field input (%IX1.0)');

  // 3. Edit the mapping; conflicts are flagged
  await page.getByTestId('pal-prox').dragTo(canvas, { targetPosition: { x: 620, y: 380 } });
  await page.waitForFunction(() => window.__cellCore.factory.entities.length === 6);
  assert((await page.getByTestId('io-detect').inputValue()) === '%IX1.1', 'second sensor gets the next address (%IX1.1)');
  await page.getByTestId('io-detect').fill('%IX1.0');
  await page.waitForSelector('.issues li.error');
  assert((await text('.issues')).includes('déjà utilisée'), 'duplicate input address is reported');
  await page.getByTestId('io-detect').fill('%IX0.0');
  assert((await text('.issues')).includes('panneau'), 'address reserved by the panel wiring is reported');
  await page.getByTestId('cell-run').click();
  assert((await text('[data-testid="cell-canvas"] ~ * , main')).length > 0 && (await page.locator('.alert').filter({ hasText: 'Corrigez' }).count()) === 1, 'simulation refuses to start while the scene has errors');

  // 4. Rotate and delete
  await page.getByTestId('rotate').click();
  assert((await text('[data-testid="inspector"]')).includes('90°'), 'rotate turns the selected item');
  await page.getByTestId('delete').click();
  await page.getByTestId('pal-photo').click({ trial: true }).catch(() => {});
  await page.waitForFunction(() => window.__cellCore.factory.entities.length === 5);
  ok('delete removes the selected item');
  // remove the other sensor too
  await page.getByTestId('cell-reset').click();

  // 5. Scenario: write the seal-in, run, operate the panel inside the 3D scene
  await page.goto(`${BASE}#/cells/sc-01-convoyeur`);
  await page.waitForSelector('[data-testid="cell-canvas"] canvas');
  await page.waitForFunction(() => window.__cellCore?.factory?.entities?.length === 4);
  await page.locator('[data-testid="st-editor"] .cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(SOLUTION);
  await page.getByTestId('cell-run').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="plc-mode"]')?.textContent === 'marche', null, { timeout: 15000 });
  ok('scenario program loads in the Web Worker; PLC in RUN');

  await page.getByTestId('cell-open-panel').click();
  await page.waitForSelector('[data-testid="panel-drawer"] svg.schematic');
  ok('panel opens inside the scene (full interactive schematic)');
  const drawerStart = page.locator('[data-testid="panel-drawer"] [data-testid="btn-start"]');
  await drawerStart.dispatchEvent('pointerdown');
  await page.waitForTimeout(200);
  await drawerStart.dispatchEvent('pointerup');
  await page.waitForFunction(() => window.__cellCore.factory.belt.CV1 > 0.9, null, { timeout: 15000 });
  ok('START on the panel → PLC → contactor → motor → conveyor belt runs');
  await page.getByTestId('close-panel').click();

  await page.waitForFunction(() => Object.values(window.__cellCore.factory.bins)[0].count >= 1, null, { timeout: 40000 });
  assert((await text('[data-testid="cell-stats"]')).includes('Boîtes'), 'boxes travel on the belt and reach the collection bin');
  const lost = await page.evaluate(() => window.__cellCore.factory.lost);
  assert(lost === 0, 'no box dropped on the floor');

  // 6. Stop, then the scenario checker runs every scripted test
  await page.getByTestId('cell-stop').click();
  await page.getByTestId('check').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="objectives"] li.pass').length === 3, null, { timeout: 60000 });
  ok('scenario checker: all 3 objectives pass for the model solution');

  // 7. Layout persists
  await page.goto(`${BASE}#/cells/free`);
  await page.waitForSelector('[data-testid="cell-canvas"] canvas');
  const before = await entityCount();
  await page.getByTestId('add-stacklight').click();
  await page.waitForFunction((n) => window.__cellCore.factory.entities.length === n + 1, before);
  await page.reload();
  await page.waitForFunction((n) => window.__cellCore?.factory?.entities?.length === n + 1, before);
  ok('layout persists across reloads');

  // 8. Declarations are generated from the I/O mapping
  await page.getByTestId('insert-decl').click();
  await page.waitForSelector('.alert');
  assert((await text('[data-testid="st-editor"]')).includes('SL1_green'), 'ST declarations generated from the I/O mapping');

  assert(problems.length === 0, `no console errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
  console.log('\nAll 3D cell e2e checks passed.');
} catch (e) {
  console.error(String(e));
  if (problems.length) console.error(problems.join('\n'));
  await page.screenshot({ path: 'e2e-failure-cell.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
