// SPDX-License-Identifier: AGPL-3.0-only
// English mode: lessons, work orders and 3D scenarios are shown in English (no French left in the translated fields).
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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.addInitScript(() => localStorage.setItem('controlslab.lang', 'en'));
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));

let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);
const assert = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  ok(msg);
};
const body = async () => (await page.locator('body').innerText()) ?? '';

await page.goto(`${BASE}#/lessons`);
await page.waitForSelector('text=Star-delta starting');
assert((await body()).includes('Star-delta starting'), 'lesson list shows English titles');

await page.goto(`${BASE}#/lessons/etoile-triangle`);
await page.waitForSelector('text=Never star AND delta together');
let t = await body();
assert(t.includes('Reduce the starting current with three contactors'), 'lesson summary in English');
assert(t.includes('Closing KM2 and KM3 at the same time'), 'lesson callout in English');
assert(!t.includes('court-circuit franc'), 'no French left in the lesson body');

await page.goto(`${BASE}#/orders/wo-012-etoile-triangle`);
await page.waitForSelector('text=The motor starts then loses speed');
t = await body();
assert(t.includes('On START it takes off'), 'work order complaint in English');
assert(t.includes('Timer relay replaced'), 'objectives in English');

await page.goto(`${BASE}#/cells/sc-05-deux-convoyeurs`);
await page.waitForSelector('text=Two conveyors in sequence');
t = await body();
assert(t.includes('Two conveyors in sequence'), '3D scenario title in English');
assert(t.includes('sequential start and stop'), '3D scenario complaint in English');

assert(problems.length === 0, `no console errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
await browser.close();
console.log('\nAll English-mode e2e checks passed.');
