// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of the external-PLC path: browser <-> ws <-> connector <-> Modbus TCP master.
// The "external PLC" here is a Node script with an independent Modbus client implementing the seal-in logic.
// Needs: npm run connector:build, and a running preview of the web app.
import { execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire(`${execSync('npm root -g').toString().trim()}/`)('playwright'));
}
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const ModbusRTU = createRequire(repo)('modbus-serial');

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173/';
const MB_PORT = 15021;
const WS_PORT = 18766;

const connector = spawn(process.execPath, [`${repo}dist-connector/controlslab-connector.mjs`, '--modbus-port', String(MB_PORT), '--ws-port', String(WS_PORT)], { stdio: 'pipe' });
let connectorLog = '';
connector.stdout.on('data', (d) => (connectorLog += d));
connector.stderr.on('data', (d) => (connectorLog += d));
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/WebSocket/.test(m.text()) && problems.push(`console: ${m.text()}`));

let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);
const assert = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  ok(msg);
};
let poll;
const master = new ModbusRTU();

try {
  await page.goto(`${BASE}#/orders/wo-005-programme-st`);
  await page.waitForSelector('[data-testid="plc-external"]');
  await page.getByTestId('plc-external').click();
  await page.waitForSelector('[data-testid="external-panel"]');
  ok('external PLC option is available next to the virtual PLC');

  // 1. A wrong URL gives an actionable error
  await page.getByTestId('ext-url').fill('ws://127.0.0.1:1');
  await page.getByTestId('ext-connect').click();
  await page.waitForSelector('[data-testid="ext-error"]');
  assert((await page.getByTestId('ext-error').innerText()).includes('allow-origin'), 'unreachable connector shows how to fix it (incl. --allow-origin hint)');

  // 2. Connect to the real connector
  await page.getByTestId('ext-url').fill(`ws://127.0.0.1:${WS_PORT}`);
  await page.getByTestId('ext-connect').click();
  await page.waitForSelector('[data-testid="ext-info"]');
  assert((await page.getByTestId('ext-info').innerText()).includes(String(MB_PORT)), 'connected: Modbus endpoint shown');

  // 3. The "external PLC": a Modbus master running the seal-in
  await master.connectTCP('127.0.0.1', { port: MB_PORT });
  master.setID(1);
  let coil = false;
  poll = setInterval(async () => {
    try {
      const di = (await master.readDiscreteInputs(0, 8)).data;
      const [start, stopNC, ovl, auOk] = [di[0], di[1], di[2], di[3]];
      const next = (start || coil) && stopNC && !ovl && auOk;
      if (next !== coil) {
        coil = next;
        await master.writeCoil(0, coil);
      }
    } catch {
      /* connection closing */
    }
  }, 40);
  await page.waitForFunction(() => document.querySelector('[data-testid="ext-masters"]')?.textContent === '1');
  ok('the Modbus master is counted in the UI');

  // 4. START (pushbutton in the UI) -> external PLC -> contactor -> motor
  const start = page.getByTestId('btn-start');
  await start.dispatchEvent('pointerdown');
  await page.waitForTimeout(300);
  await start.dispatchEvent('pointerup');
  await page.waitForFunction(() => /marche|démarrage/.test(document.querySelector('[data-testid="motor-state"]')?.textContent ?? ''), null, { timeout: 10000 });
  await page.waitForTimeout(1500);
  assert(coil === true, 'external PLC sealed in (coil written over Modbus)');
  assert((await page.locator('[data-testid="motor-state"]').first().innerText()).includes('marche'), 'motor runs: browser button → Modbus input → master logic → coil → contactor');

  // 5. STOP drops it out
  const stop = page.getByTestId('btn-stop');
  await stop.dispatchEvent('pointerdown');
  await page.waitForTimeout(300);
  await stop.dispatchEvent('pointerup');
  await page.waitForTimeout(500);
  assert(coil === false, 'STOP: external PLC releases the coil');

  // 6. Coil still ON + browser leaves => outputs are de-energized on the connector
  const start2 = page.getByTestId('btn-start');
  await start2.dispatchEvent('pointerdown');
  await page.waitForTimeout(300);
  await start2.dispatchEvent('pointerup');
  await page.waitForTimeout(600);
  assert(coil === true, 'restarted');
  await page.getByTestId('ext-disconnect').click();
  await page.waitForTimeout(500);
  const coils = (await master.readCoils(0, 8)).data;
  assert(coils[0] === false, 'leaving the browser connection de-energizes every output (fail-safe)');

  assert(problems.length === 0, `no console errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
  console.log('\nAll Modbus e2e checks passed.');
} catch (e) {
  console.error(String(e));
  console.error(connectorLog.split('\n').slice(-8).join('\n'));
  if (problems.length) console.error(problems.join('\n'));
  await page.screenshot({ path: 'e2e-failure-modbus.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  clearInterval(poll);
  await new Promise((r) => master.close(r)).catch(() => {});
  await browser.close();
  connector.kill();
}
