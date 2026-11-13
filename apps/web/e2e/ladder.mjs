// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of the Ladder editor (build in the UI, import a full program, run on the panel, check).
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
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));

let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);
const assert = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  ok(msg);
};
const stText = async () => (await page.getByTestId('ld-st').textContent()) ?? '';

const v = (name, address) => ({ name, type: 'BOOL', ...(address ? { address } : {}) });
const c = (id, name, k = 'NO') => ({ id, t: 'contact', v: name, k });
const PROGRAM = {
  v: 1,
  name: 'Main',
  vars: [v('Marche', '%IX0.0'), v('Arret', '%IX0.1'), v('Surcharge', '%IX0.2'), v('AU_OK', '%IX0.3'), v('RetourM', '%IX0.4'), v('BobineM', '%QX0.0'), v('VoyantMarche', '%QX0.1'), v('Demande')],
  rungs: [
    { id: 'r1', comment: 'Demande de démarrage', logic: { id: 's1', t: 'series', items: [{ id: 'p1', t: 'parallel', items: [c('a', 'Marche'), c('b', 'Demande')] }, c('c', 'Arret'), c('d', 'Surcharge', 'NC'), c('e', 'AU_OK')] }, outputs: [{ id: 'o1', t: 'coil', v: 'Demande', k: 'normal' }] },
    { id: 'r2', comment: 'Délai', logic: c('f', 'Demande'), outputs: [{ id: 'o2', t: 'timer', fb: 'TON', name: 'T1', pt: 'T#3s' }] },
    { id: 'r3', comment: 'Contacteur', logic: c('g', 'T1.Q'), outputs: [{ id: 'o3', t: 'coil', v: 'BobineM', k: 'normal' }] },
    { id: 'r4', comment: 'Avertissement', logic: { id: 'p2', t: 'parallel', items: [{ id: 's2', t: 'series', items: [c('h', 'Demande'), c('i', 'T1.Q', 'NC')] }, c('j', 'RetourM')] }, outputs: [{ id: 'o4', t: 'coil', v: 'VoyantMarche', k: 'normal' }] },
  ],
};

try {
  await page.goto(`${BASE}#/orders/wo-006-demarrage-temporise`);
  await page.waitForSelector('[data-testid="ld-editor"]', { timeout: 15000 });
  assert((await page.getByTestId('lang-ld').getAttribute('aria-checked')) === 'true', 'Ladder is the default language of the work order (ST available too)');

  // 1. Build a rung in the UI
  await page.getByTestId('ld-add-rung').click();
  await page.getByTestId('ld-add-contact').click();
  await page.getByTestId('ld-var').fill('Marche');
  await page.getByTestId('ld-add-parallel').click();
  await page.getByTestId('ld-var').fill('Demande');
  await page.getByTestId('ld-add-coil').click();
  await page.getByTestId('ld-coil-var').fill('Demande');
  await page.getByTestId('ld-add-var').click();
  const st = await stText();
  assert(st.includes('_R1 := Marche OR'), 'contact + parallel branch generate `Marche OR …` in the ST');
  assert(st.includes('Demande := _R1;'), 'coil generates the assignment');
  await page.getByTestId('ld-del-rung').click();
  assert(!(await stText()).includes('_R1 :='), 'rung can be deleted');

  // 2. Import a complete program
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Importer .ld.json').click()]);
  await chooser.setFiles({ name: 'prog.ld.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(PROGRAM)) });
  await page.waitForSelector('[data-testid="ld-rung-4"]');
  assert((await stText()).includes('T1(IN := _R2, PT := T#3s);'), 'imported ladder is transpiled (timer rung)');
  const issues = await page.getByTestId('ld-issues').count();
  assert(issues === 0, 'no validation issues on the model program');

  // 3. Run it on the panel
  await page.getByTestId('plc-load').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="plc-mode"]')?.textContent === 'marche', null, { timeout: 15000 });
  ok('ladder program runs in the Web Worker');
  await page.getByTestId('btn-start').dispatchEvent('pointerdown');
  await page.waitForTimeout(200);
  await page.getByTestId('btn-start').dispatchEvent('pointerup');
  await page.waitForTimeout(1200);
  assert((await page.locator('[data-testid="motor-state"]').first().innerText()).includes('arrêté'), 'motor still stopped during the 3 s warning delay');
  await page.waitForFunction(() => /marche|démarrage/.test(document.querySelector('[data-testid="motor-state"]')?.textContent ?? ''), null, { timeout: 10000 });
  ok('motor starts after the delay (TON in Ladder)');
  // live power flow: closed contacts drawn in the "on" colour
  const live = await page.locator('[data-testid="ld-rung-1"] line[stroke="var(--ld-on)"]').count();
  assert(live > 0, 'live power flow is drawn on the rung');

  // 4. Checker
  await page.getByTestId('check').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="objectives"] li.pass').length === 3, null, { timeout: 60000 });
  ok('work order checker: all 3 objectives pass for the Ladder program');

  // 5. Switch to ST: starter is kept separately; switching back keeps the ladder
  await page.getByTestId('lang-st').click();
  await page.waitForSelector('[data-testid="st-editor"]');
  await page.getByTestId('lang-ld').click();
  await page.waitForSelector('[data-testid="ld-rung-4"]');
  ok('switching ST ↔ Ladder keeps each program');

  assert(problems.length === 0, `no console errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
  console.log('\nAll Ladder e2e checks passed.');
} catch (e) {
  console.error(String(e));
  if (problems.length) console.error(problems.join('\n'));
  await page.screenshot({ path: 'e2e-failure-ladder.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
