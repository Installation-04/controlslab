// SPDX-License-Identifier: AGPL-3.0-only
// Panel wiring editor: free placement, wiring by clicking terminals, the starter challenge, run mode, persistence.
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
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addInitScript(() => {
  if (!localStorage.getItem('controlslab.lang')) localStorage.setItem('controlslab.lang', 'en');
});
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('dialog', (d) => d.accept());

let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);
const assert = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  ok(msg);
};
const term = (ref) => page.locator(`[data-terminal="${ref}"]`).last();
const wire = async (a, b) => {
  await term(a).click({ force: true });
  await term(b).click({ force: true });
};

await page.goto(`${BASE}#/builder`);
await page.waitForSelector('[data-testid="builder-overlay"]');
assert((await page.locator('body').innerText()).includes('Panel wiring editor'), 'builder page opens (English)');

// --- free placement ---
await page.getByTestId('builder-new').click();
assert((await page.locator('body').innerText()).includes('The sheet is empty'), 'new panel starts empty');
await page.getByTestId('palette-source3').click();
assert((await page.getByTestId('builder-status').textContent()).includes('3-phase supply'), 'palette arms the chosen component');
const box = await page.getByTestId('builder-overlay').boundingBox();
await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.15);
await page.waitForSelector('[data-testid="part-SRC1"]');
assert(await page.getByTestId('builder-inspector').isVisible(), 'placing a component selects it and shows the inspector');
const p0 = await page.getByTestId('bp-SRC1').boundingBox();
// grab the body (terminals sit on the top edge and take the click)
const gx = p0.x + 12;
const gy = p0.y + p0.height - 8;
await page.mouse.move(gx, gy);
await page.mouse.down();
await page.mouse.move(gx + 120, gy + 80, { steps: 6 });
await page.mouse.up();
const p1 = await page.getByTestId('bp-SRC1').boundingBox();
assert(p1.x > p0.x + 60 && p1.y > p0.y + 40, 'dragging moves the component');
await page.getByTestId('builder-delete').click();
assert((await page.locator('body').innerText()).includes('The sheet is empty'), 'delete removes the component');

// --- challenge ---
await page.getByTestId('builder-challenge').click();
await page.waitForSelector('[data-testid="builder-overlay"]');
assert(await page.getByTestId('builder-challenge-panel').isVisible(), 'challenge panel shown');
await page.getByTestId('builder-check').click();
assert((await page.getByTestId('builder-result').textContent()).includes('Not yet'), 'unwired starter fails the check');
assert((await page.getByTestId('step-start').textContent()).startsWith('✗'), 'START step fails');

const PAIRS = [
  ['PB_STOP:2', 'PB_ES:1'], ['PB_ES:2', 'J3:T'], ['J3:T', 'PB_START:1'], ['J3:T', 'M:13'],
  ['PB_START:2', 'J4:T'], ['M:14', 'J4:T'], ['J4:T', 'M:A1'], ['M:A2', 'OL:95'],
];
const before = await page.locator('[data-testid^="bw-"]').count();
for (const [a, b] of PAIRS.slice(0, 7)) await wire(a, b);
await page.getByTestId('builder-check').click();
assert((await page.getByTestId('builder-result').textContent()).includes('Not yet'), 'seven wires are not enough');
await wire(...PAIRS[7]);
assert((await page.locator('[data-testid^="bw-"]').count()) === before + 8, 'eight wires drawn by clicking terminals');
await page.getByTestId('builder-check').click();
const text = await page.getByTestId('builder-result').textContent();
assert(text.includes('Well done'), `wired starter passes: ${text}`);

// --- select + delete a wire breaks it again ---
await page.getByTestId(`bw-W${before + 8 + 0}`).count().catch(() => 0);
const last = page.locator('[data-testid^="bw-"]').last();
await last.dispatchEvent('pointerdown');
await page.getByTestId('builder-delete').click();
await page.getByTestId('builder-check').click();
assert((await page.getByTestId('builder-result').textContent()).includes('Not yet'), 'deleting a wire breaks the starter');
await wire(...PAIRS[7]);
await page.getByTestId('builder-check').click();
assert((await page.getByTestId('builder-result').textContent()).includes('Well done'), 'rewired starter passes again');

// --- run mode ---
await page.getByTestId('mode-run').click();
await page.waitForSelector('[data-testid="lab-restart"]');
await page.getByTestId('btn-start').dispatchEvent('pointerdown');
await page.waitForTimeout(400);
await page.getByTestId('btn-start').dispatchEvent('pointerup');
await page.waitForTimeout(2500);
assert(await page.getByTestId('lab-restart').isVisible(), 'run mode shows the live lab for the built panel');
await page.getByTestId('mode-edit').click();

// --- persistence ---
await page.reload();
await page.waitForSelector('[data-testid="builder-overlay"]');
assert((await page.locator('[data-testid^="bw-"]').count()) === before + 8, 'panel persists across reloads');

assert(problems.length === 0, `no console errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
await browser.close();
console.log('\nAll wiring-editor e2e checks passed.');
