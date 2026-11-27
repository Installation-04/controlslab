// SPDX-License-Identifier: AGPL-3.0-only
// Classroom without a server: the instructor makes a class file, learners join and export reports, the instructor
// imports them, sees the table and replays the submitted programs.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright'));
}

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch();
const problems = [];
let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);
const assert = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  ok(msg);
};
const newPage = async (seed) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 }, acceptDownloads: true });
  await ctx.addInitScript((s) => {
    localStorage.setItem('controlslab.lang', 'en');
    if (s && !localStorage.getItem('controlslab.progress.v1')) localStorage.setItem('controlslab.progress.v1', JSON.stringify(s));
  }, seed);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('dialog', (d) => d.accept());
  return page;
};
const download = async (page, testId) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
  return { name: dl.suggestedFilename(), buffer: readFileSync(await dl.path()) };
};

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
const STARTER_WRONG = SOLUTION.replace('BobineM := (Marche OR BobineM)', 'BobineM := (Marche)');
const progress = (name, passed005, program) => ({
  v: 1,
  profile: { name },
  lessons: { 'loi-ohm': { done: true, quiz: { q1: true } } },
  orders: {
    'wo-005-programme-st': { passed: passed005, attempts: 2, lastAt: 1700000000000, violations: {}, measures: 0 },
    'wo-010-surcharge': { passed: true, attempts: 1, lastAt: 1700000001000, violations: { ohms_on_live: 2 }, measures: 6 },
  },
  checkpoints: passed005 ? { 'cp1-demarreur': [{ at: 5, fault: 'ol_open', total: 90, max: 100, percent: 90, passed: true, lines: [] }] } : {},
  programs: { 'wo-005-programme-st': program },
});

// ---- instructor: create the class ----
const ins = await newPage();
await ins.goto(`${BASE}#/instructor`);
await ins.getByTestId('ins-name').fill('Electromechanics 2');
await ins.getByTestId('ins-create').click();
await ins.waitForSelector('[data-testid="ins-class"]');
const code = (await ins.getByTestId('ins-code').textContent()).trim();
assert(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), `class code generated (${code})`);
for (const id of ['wo-005-programme-st', 'wo-010-surcharge', 'cp1-demarreur', 'loi-ohm']) await ins.getByTestId(`assign-${id}`).check();
const classFile = await download(ins, 'ins-export');
const parsed = JSON.parse(classFile.buffer.toString());
assert(parsed.kind === 'class' && parsed.code === code && parsed.assigned.workorders.length === 2, 'class file exported with the assigned work');

// ---- learners ----
const learner = async (name, passed005, program) => {
  const page = await newPage(progress(name, passed005, program));
  await page.goto(`${BASE}#/record`);
  assert((await page.getByTestId('class-export').count()) === 0, `${name}: no export before joining a class`);
  await page.getByTestId('class-import').setInputFiles({ name: classFile.name, mimeType: 'application/json', buffer: classFile.buffer });
  await page.waitForSelector('[data-testid="class-export"]');
  assert((await page.getByTestId('class-notice').textContent()).includes('Electromechanics 2'), `${name}: joined the class`);
  await page.goto(`${BASE}#/orders`);
  assert(await page.getByTestId('assigned-wo-005-programme-st').isVisible(), `${name}: assigned badge in the work order list`);
  assert((await page.getByTestId('assigned-wo-007-banc-eclairage').count()) === 0, `${name}: unassigned work has no badge`);
  await page.goto(`${BASE}#/record`);
  const report = await download(page, 'class-export');
  const r = JSON.parse(report.buffer.toString());
  assert(r.kind === 'report' && r.classCode === code && r.learner.name === name, `${name}: report exported`);
  assert(r.programs['order:wo-005-programme-st']?.source.includes('BobineM'), `${name}: assigned PLC program included`);
  assert(!JSON.stringify(r).includes('cell-layout'), `${name}: nothing else leaks into the report`);
  return report;
};
const alex = await learner('Alex Tremblay', true, SOLUTION);
const bea = await learner('Béa Gagnon', false, STARTER_WRONG);

// ---- instructor: import reports ----
await ins.getByTestId('ins-import').setInputFiles([
  { name: alex.name, mimeType: 'application/json', buffer: alex.buffer },
  { name: bea.name, mimeType: 'application/json', buffer: bea.buffer },
  { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":') },
]);
await ins.waitForSelector('[data-testid="ins-table"]');
const notice = await ins.getByTestId('ins-notice').textContent();
assert(notice.includes('2 report(s) added') && notice.includes('broken.json'), 'two reports added, the broken file is reported');
assert((await ins.getByTestId('ins-finished').textContent()).includes('1 / 2'), 'one learner out of two finished the assigned work');
const alexRow = await ins.getByTestId('ins-row-Alex Tremblay').textContent();
const beaRow = await ins.getByTestId('ins-row-Béa Gagnon').textContent();
assert(alexRow.includes('3/3') && alexRow.includes('90 %'), 'Alex: 3/3 assigned items, checkpoint 90 %');
assert(beaRow.includes('1/3'), 'Béa: 1/3 assigned items');
const cells = await ins.getByTestId('ins-row-Alex Tremblay').locator('td').allTextContents();
assert(cells.includes('2') && cells.includes('6'), 'safety violations (2) and measures (6) are totalled');

// ---- replay submitted programs ----
await ins.getByTestId('ins-detail-Alex Tremblay').click();
await ins.waitForSelector('[data-testid="ins-learner"]');
assert((await ins.getByTestId('ins-learner').textContent()).includes('Ohmmeter on a live circuit'), 'safety violation shown by name');
await ins.getByTestId('ins-replay-order:wo-005-programme-st').click();
await ins.waitForSelector('[data-testid="ins-verdict-order:wo-005-programme-st"]');
assert((await ins.getByTestId('ins-verdict-order:wo-005-programme-st').textContent()).includes('Passes'), "Alex's program passes the replay");
await ins.getByTestId('ins-detail-Béa Gagnon').click();
await ins.getByTestId('ins-replay-order:wo-005-programme-st').click();
await ins.waitForSelector('[data-testid="ins-verdict-order:wo-005-programme-st"]');
assert((await ins.getByTestId('ins-verdict-order:wo-005-programme-st').textContent()).includes('Fails'), "Béa's wrong program fails the replay");

// ---- persistence ----
await ins.reload();
await ins.waitForSelector('[data-testid="ins-table"]');
assert((await ins.getByTestId('ins-table').textContent()).includes('Alex Tremblay'), 'class and reports persist across reloads');

assert(problems.length === 0, `no console errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
await browser.close();
console.log('\nAll classroom e2e checks passed.');
