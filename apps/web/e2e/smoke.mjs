// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end smoke test against a built app (npm run build && npm run e2e).
// Uses the Chromium that Playwright provides; set BASE_URL to test a deployed instance.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Playwright is a tool, not a dependency: use the project's copy if present, else the global install.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright'));
}

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
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

try {
  // 1. Home → lesson 1 (French by default)
  await page.goto(BASE);
  assert((await text('h1')).includes('Dépannage'), 'home page renders in French');
  await page.getByTestId('home-start').click();
  await page.waitForSelector('[data-testid="quiz-q-ohm-1"]');
  ok('lesson 1 opens');

  // 2. Ohm calculator: V=120, R=240 → I=0.5
  assert((await page.getByTestId('ohm-out-I').innerText()) === '0.5', "Ohm calculator computes I = 0.5 A");
  await page.getByTestId('lesson-done').click();

  // 3. Free lab: start/stop the motor on the hardwired starter
  await page.goto(`${BASE}#/lab`);
  await page.waitForSelector('svg.schematic');
  await page.getByTestId('btn-start').dispatchEvent('pointerdown');
  await page.waitForTimeout(150);
  await page.getByTestId('btn-start').dispatchEvent('pointerup');
  await page.waitForTimeout(2500);
  assert((await text('[data-testid="motor-state"]')).includes('marche'), 'motor runs after START (seal-in holds after release)');

  // 4. Multimeter: probe the control voltage
  await page.locator('[data-terminal="TB1:T"]').dispatchEvent('click');
  await page.locator('[data-terminal="TB0:T"]').dispatchEvent('click');
  await page.getByTestId('measure').click();
  const v = parseFloat((await page.getByTestId('meter-display').innerText()).split('\n')[0]);
  assert(v > 110 && v < 125, `multimeter reads control voltage (${v} V)`);

  // 5. STOP drops the motor out
  await page.getByTestId('btn-stop').dispatchEvent('pointerdown');
  await page.waitForTimeout(150);
  await page.getByTestId('btn-stop').dispatchEvent('pointerup');
  await page.waitForTimeout(5500);
  assert((await text('[data-testid="motor-state"]')).includes('arrêté'), 'motor stops after STOP');

  // 6. Instructor mode: inject the open-overload fault → START does nothing
  await page.getByText('Mode formateur').click();
  await page.getByTestId('inject-ol_open').click();
  await page.getByTestId('btn-start').dispatchEvent('pointerdown');
  await page.waitForTimeout(150);
  await page.getByTestId('btn-start').dispatchEvent('pointerup');
  await page.waitForTimeout(800);
  assert((await text('[data-testid="motor-state"]')).includes('arrêté'), 'with open overload contact the motor will not start');

  // 7. PLC work order: write the seal-in, load into the worker, pass the checker
  await page.goto(`${BASE}#/orders/wo-005-programme-st`);
  await page.waitForSelector('[data-testid="st-editor"] .cm-content');
  const program = `PROGRAM Main
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
  await page.locator('[data-testid="st-editor"] .cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(program);
  await page.getByTestId('plc-load').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="plc-mode"]')?.textContent === 'marche');
  ok('program loads in the Web Worker and the PLC goes to RUN');
  // Live co-simulation: press START in the UI, the worker drives the coil
  await page.getByTestId('btn-start').dispatchEvent('pointerdown');
  await page.waitForTimeout(200);
  await page.getByTestId('btn-start').dispatchEvent('pointerup');
  await page.waitForTimeout(2500);
  assert((await text('[data-testid="motor-state"]')).includes('marche'), 'PLC program (in worker) starts the real-time motor');
  await page.getByTestId('check').click();
  await page.waitForSelector('[data-testid="objectives"] li.pass', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="objectives"] li.pass').length === 4, null, { timeout: 20000 });
  ok('work order checker: all 4 objectives pass for the model solution');

  // 8. Syntax errors are reported with a line number
  await page.locator('[data-testid="st-editor"] .cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('PROGRAM Main\n  x := ;\nEND_PROGRAM');
  await page.getByTestId('plc-load').click();
  await page.waitForSelector('[data-testid="plc-errors"]');
  assert((await text('[data-testid="plc-errors"]')).includes('L2:'), 'syntax error reported with line number');

  // 9. Checkpoint: no hints, finish → scored result saved
  await page.goto(`${BASE}#/checkpoint`);
  await page.getByTestId('cp-begin').click();
  await page.waitForSelector('[data-testid="cp-finish"]');
  assert((await page.locator('[data-testid="hint"]').count()) === 0, 'checkpoint has no hint button');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('cp-finish').click();
  await page.waitForSelector('[data-testid="cp-result"]');
  assert((await text('[data-testid="cp-result"]')).includes('NON RÉUSSI'), 'doing nothing fails the checkpoint');

  // 10. Printable record keeps the attempt; reload persists progress
  await page.goto(`${BASE}#/record`);
  await page.getByTestId('record-name').fill('Test Technicien');
  await page.reload();
  assert((await page.getByTestId('record-name').inputValue()) === 'Test Technicien', 'progress persists across reloads (localStorage)');
  assert((await text('main')).includes('0 %'), 'record lists the checkpoint attempt');

  // 11. Backup export
  await page.goto(`${BASE}#/data`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-backup').click()]);
  assert(/^controlslab-backup-\d{8}\.json$/.test(dl.suggestedFilename()), `backup file name (${dl.suggestedFilename()})`);

  assert(problems.length === 0, `no console errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
  console.log('\nAll e2e checks passed.');
} catch (e) {
  console.error(String(e));
  if (problems.length) console.error(problems.join('\n'));
  await page.screenshot({ path: 'e2e-failure.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
