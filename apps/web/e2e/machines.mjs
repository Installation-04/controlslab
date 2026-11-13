// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of the phase-2 machines: reversing starter, clamp meter, second checkpoint.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright'));
}

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch();
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
const press = async (id, ms = 150) => {
  const b = page.getByTestId(id);
  await b.dispatchEvent('pointerdown');
  await page.waitForTimeout(ms);
  await b.dispatchEvent('pointerup');
};

try {
  // 1. Reversing starter in the free lab
  await page.goto(`${BASE}#/lab`);
  await page.getByTestId('machine-select').selectOption('reversing-3w');
  await page.waitForSelector('svg.schematic');
  await press('btn-pb_fwd');
  await page.waitForFunction(() => document.querySelector('[data-testid="motor-dir"]')?.textContent === 'AVANT', null, { timeout: 8000 });
  ok('FORWARD: motor runs forward (direction badge)');
  await press('btn-stop');
  await page.waitForFunction(() => !document.querySelector('[data-testid="motor-dir"]'), null, { timeout: 9000 });
  await press('btn-pb_rev');
  await page.waitForFunction(() => document.querySelector('[data-testid="motor-dir"]')?.textContent === 'ARRIÈRE', null, { timeout: 8000 });
  ok('STOP then REVERSE: motor runs the other way (two phases swapped)');
  assert((await page.locator('[data-testid="part-KF-aux_nc"]').count()) === 1, 'NC interlock contacts (21-22) are drawn on the schematic');

  // 2. Clamp meter on the lighting bench
  await page.getByTestId('machine-select').selectOption('bench-lighting');
  await page.waitForSelector('[data-testid="btn-sw1"]');
  await page.getByTestId('btn-sw1').click();
  await page.getByTestId('mode-AAC').click();
  const wire = page.locator('[data-testid^="wire-"]').nth(4); // a branch wire; any live wire works
  await page.getByTestId('btn-sw3').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="wire-W11"]').dispatchEvent('click');
  await page.waitForTimeout(300);
  const reading = parseFloat((await page.getByTestId('meter-display').innerText()).split('\n')[0]);
  assert(reading > 11 && reading < 14, `clamp on the heater branch reads its current (${reading} A ≈ 12.5 A)`);
  void wire;
  assert((await page.getByTestId('clamp-wire').innerText()) === 'W11', 'clamp wire shown in the meter panel');

  // 3. Checkpoint 2
  await page.goto(`${BASE}#/checkpoint`);
  await page.getByTestId('cp-pick-cp2-inverseur').click();
  await page.getByTestId('cp-begin').click();
  await page.waitForSelector('[data-testid="btn-pb_fwd"]');
  assert((await page.locator('[data-testid="hint"]').count()) === 0, 'checkpoint 2 loads the reversing starter with no hints');

  // 4. Lessons list has the new lessons
  await page.goto(`${BASE}#/lessons`);
  const n = await page.locator('ol.cards > li').count();
  assert(n >= 8, `lesson list shows the new lessons (${n})`);

  assert(problems.length === 0, `no console errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
  console.log('\nAll machines e2e checks passed.');
} catch (e) {
  console.error(String(e));
  if (problems.length) console.error(problems.join('\n'));
  await page.screenshot({ path: 'e2e-failure-machines.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
