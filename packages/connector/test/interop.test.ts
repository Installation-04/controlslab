import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startConnector, type Connector } from '../src';

// Independent Modbus client implementation (not written by us) used as a conformance check.
const ModbusRTU = createRequire(import.meta.url)('modbus-serial') as new () => {
  connectTCP(host: string, opts: { port: number }): Promise<void>;
  setID(id: number): void;
  readCoils(addr: number, n: number): Promise<{ data: boolean[] }>;
  readDiscreteInputs(addr: number, n: number): Promise<{ data: boolean[] }>;
  writeCoil(addr: number, v: boolean): Promise<unknown>;
  writeCoils(addr: number, v: boolean[]): Promise<unknown>;
  readHoldingRegisters(addr: number, n: number): Promise<{ data: number[] }>;
  writeRegister(addr: number, v: number): Promise<unknown>;
  writeRegisters(addr: number, v: number[]): Promise<unknown>;
  readInputRegisters(addr: number, n: number): Promise<{ data: number[] }>;
  close(cb: () => void): void;
};

let conn: Connector | undefined;
afterEach(async () => {
  await conn?.close();
  conn = undefined;
});

describe('interoperability with a third-party Modbus TCP client', () => {
  it('reads inputs, writes coils and registers like a real PLC master would', async () => {
    conn = await startConnector({ modbusPort: 0, wsPort: 0 });
    const ws = new WebSocket(`ws://127.0.0.1:${conn.wsPort}`);
    const out: Array<Record<string, boolean>> = [];
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.type === 'outputs' && !m.full) out.push(m.values);
    });
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'inputs', values: { '%IX0.0': true, '%IX0.3': true, '%IX1.1': true } }));
    await new Promise((r) => setTimeout(r, 50));

    const c = new ModbusRTU();
    await c.connectTCP('127.0.0.1', { port: conn.modbusPort });
    c.setID(1);
    // (the client library pads bit reads to whole bytes)
    expect((await c.readDiscreteInputs(0, 10)).data.slice(0, 10)).toEqual([true, false, false, true, false, false, false, false, false, true]);
    await c.writeCoil(0, true);
    await c.writeCoils(8, [true, false, true]);
    expect((await c.readCoils(0, 11)).data.slice(0, 11)).toEqual([true, false, false, false, false, false, false, false, true, false, true]);
    await new Promise((r) => setTimeout(r, 50));
    expect(Object.assign({}, ...out)).toEqual({ '%QX0.0': true, '%QX1.0': true, '%QX1.2': true });
    await c.writeRegister(4, 1234);
    await c.writeRegisters(10, [1, 2, 3]);
    expect((await c.readHoldingRegisters(4, 1)).data).toEqual([1234]);
    expect((await c.readHoldingRegisters(10, 3)).data).toEqual([1, 2, 3]);
    expect((await c.readInputRegisters(0, 2)).data).toEqual([0, 0]);
    await expect(c.readCoils(5000, 1)).rejects.toThrow();
    await new Promise<void>((r) => c.close(r));
    ws.close();
  });
});
