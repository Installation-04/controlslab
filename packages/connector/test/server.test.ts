import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { encodeFrame, originAllowed, startConnector, type Connector } from '../src';

type Msg = { type: string; values?: Record<string, boolean>; full?: boolean; count?: number; v?: number; modbus?: { port: number } };
let conn: Connector | undefined;
afterEach(async () => {
  await conn?.close();
  conn = undefined;
});

const start = (extra: Parameters<typeof startConnector>[0] = {}) =>
  startConnector({ modbusPort: 0, wsPort: 0, ...extra }).then((c) => (conn = c));

const wsOpen = (c: Connector, origin?: string) =>
  new Promise<{ ws: WebSocket; messages: Msg[] }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${c.wsPort}`, origin ? { headers: { Origin: origin } } : undefined);
    const messages: Msg[] = [];
    ws.on('message', (d) => messages.push(JSON.parse(String(d))));
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });

const tcpOpen = (c: Connector) =>
  new Promise<Socket>((resolve) => {
    const s = connect(c.modbusPort, '127.0.0.1', () => resolve(s));
  });

let tx = 0;
const tcpCall = (s: Socket, pdu: number[]) =>
  new Promise<Uint8Array>((resolve) => {
    s.once('data', (d) => resolve(new Uint8Array(d)));
    s.write(encodeFrame(++tx, 1, Uint8Array.from(pdu)));
  });

const waitFor = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('connector end to end (real sockets)', () => {
  it('browser inputs are readable by the Modbus master; master coil writes reach the browser', async () => {
    const c = await start();
    const { ws, messages } = await wsOpen(c);
    ws.send(JSON.stringify({ type: 'hello', app: 'controlslab', v: 1 }));
    await waitFor(() => messages.some((m) => m.type === 'welcome'));
    expect(messages.find((m) => m.type === 'welcome')).toMatchObject({ v: 1, modbus: { port: c.modbusPort } });

    ws.send(JSON.stringify({ type: 'inputs', values: { '%IX0.0': true, '%IX0.2': true } }));
    await waitFor(() => c.bridge.tables.discreteInputs[2] === 1);

    const m = await tcpOpen(c);
    const di = await tcpCall(m, [0x02, 0, 0, 0, 8]);
    expect(di.slice(0, 6)).toEqual(Uint8Array.of(0, tx, 0, 0, 0, 4));
    expect([...di.slice(7)]).toEqual([0x02, 1, 0b00000101]);

    await tcpCall(m, [0x05, 0, 0, 0xff, 0]);
    await waitFor(() => messages.some((x) => x.type === 'outputs' && x.values?.['%QX0.0'] === true));
    const rb = await tcpCall(m, [0x01, 0, 0, 0, 1]);
    expect([...rb.slice(7)]).toEqual([0x01, 1, 1]);

    m.destroy();
    ws.close();
  });

  it('reports the number of connected masters', async () => {
    const c = await start();
    const { messages } = await wsOpen(c);
    const m = await tcpOpen(c);
    await waitFor(() => messages.some((x) => x.type === 'masters' && x.count === 1));
    expect(c.masters()).toBe(1);
    m.destroy();
    await waitFor(() => messages.some((x) => x.type === 'masters' && x.count === 0));
  });

  it('a new browser gets the current outputs; losing the browser de-energizes everything', async () => {
    const c = await start();
    const first = await wsOpen(c);
    const m = await tcpOpen(c);
    await tcpCall(m, [0x05, 0, 3, 0xff, 0]);
    first.ws.close();
    await waitFor(() => c.bridge.tables.coils[3] === 0);
    // inputs are cleared as well
    expect(c.bridge.tables.discreteInputs.every((v) => v === 0)).toBe(true);
    await tcpCall(m, [0x05, 0, 4, 0xff, 0]);
    const second = await wsOpen(c);
    second.ws.send(JSON.stringify({ type: 'hello' }));
    await waitFor(() => second.messages.some((x) => x.type === 'outputs' && x.full));
    expect(second.messages.find((x) => x.type === 'outputs' && x.full)!.values).toEqual({ '%QX0.4': true });
    m.destroy();
    second.ws.close();
  });

  it('ignores malformed WebSocket messages; drops a TCP connection that sends garbage', async () => {
    const c = await start();
    const { ws } = await wsOpen(c);
    ws.send('not json');
    ws.send(JSON.stringify({ type: 'inputs', values: 5 }));
    ws.send(JSON.stringify({ type: 'unknown' }));
    ws.send(JSON.stringify({ type: 'inputs', values: { '%IX0.0': true, bad: true } }));
    await waitFor(() => c.bridge.tables.discreteInputs[0] === 1);
    const m = await tcpOpen(c);
    const closed = new Promise<void>((r) => m.once('close', () => r()));
    m.write(Buffer.from([0, 1, 0xde, 0xad, 0, 2, 1, 1]));
    await closed;
    ws.close();
  });

  it('enforces the WebSocket origin allow-list', async () => {
    const c = await start({ allowOrigins: ['http://localhost:*', 'http://10.0.0.5:12000'] });
    const ok = await wsOpen(c, 'http://localhost:5173');
    ok.ws.close();
    const lan = await wsOpen(c, 'http://10.0.0.5:12000');
    lan.ws.close();
    await expect(wsOpen(c, 'https://evil.example')).rejects.toThrow(/403/);
    await expect(wsOpen(c, 'http://10.0.0.5:9999')).rejects.toThrow(/403/);
  });

  it('origin matching helper', () => {
    expect(originAllowed(undefined, [])).toBe(true);
    expect(originAllowed('http://localhost:5173', ['http://localhost:*'])).toBe(true);
    expect(originAllowed('http://localhost.evil.com', ['http://localhost:*'])).toBe(false);
    expect(originAllowed('https://anything', ['*'])).toBe(true);
    expect(originAllowed('http://a.b', ['http://a.b'])).toBe(true);
    expect(originAllowed('http://a.b.c', ['http://a.b'])).toBe(false);
  });
});
