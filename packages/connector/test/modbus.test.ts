import { describe, expect, it } from 'vitest';
import { Bridge, ModbusTables, TABLE_SIZE, addressToIndex, encodeFrame, exception, indexToAddress, parseFrames } from '../src';

const req = (...bytes: number[]) => Uint8Array.of(...bytes);
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];

describe('Modbus PDU handling', () => {
  it('reads coils and discrete inputs as LSB-first packed bits', () => {
    const t = new ModbusTables();
    [0, 2, 3, 9].forEach((i) => (t.coils[i] = 1));
    [1, 8].forEach((i) => (t.discreteInputs[i] = 1));
    expect([...t.handle(req(0x01, ...u16(0), ...u16(10)))]).toEqual([0x01, 2, 0b00001101, 0b00000010]);
    expect([...t.handle(req(0x02, ...u16(0), ...u16(9)))]).toEqual([0x02, 2, 0b00000010, 0b00000001]);
    expect([...t.handle(req(0x01, ...u16(8), ...u16(1)))]).toEqual([0x01, 1, 0]);
  });

  it('reads holding and input registers (big-endian)', () => {
    const t = new ModbusTables();
    t.holding[5] = 0x1234;
    t.inputRegs[0] = 0xbeef;
    t.inputRegs[1] = 7;
    expect([...t.handle(req(0x03, ...u16(5), ...u16(1)))]).toEqual([0x03, 2, 0x12, 0x34]);
    expect([...t.handle(req(0x04, ...u16(0), ...u16(2)))]).toEqual([0x04, 4, 0xbe, 0xef, 0, 7]);
  });

  it('write single coil: ON/OFF, echo, bad value, notifies the bridge', () => {
    const t = new ModbusTables();
    const seen: Array<[string, number, number]> = [];
    t.onWrite = (k, s, c) => seen.push([k, s, c]);
    expect([...t.handle(req(0x05, ...u16(3), 0xff, 0x00))]).toEqual([0x05, 0, 3, 0xff, 0x00]);
    expect(t.coils[3]).toBe(1);
    t.handle(req(0x05, ...u16(3), 0x00, 0x00));
    expect(t.coils[3]).toBe(0);
    expect([...t.handle(req(0x05, ...u16(3), 0x12, 0x34))]).toEqual([0x85, 3]);
    expect(seen).toEqual([['coils', 3, 1], ['coils', 3, 1]]);
  });

  it('write multiple coils / registers', () => {
    const t = new ModbusTables();
    expect([...t.handle(req(0x0f, ...u16(2), ...u16(10), 2, 0b01010101, 0b00000010))]).toEqual([0x0f, 0, 2, 0, 10]);
    expect([...t.coils.slice(2, 12)]).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 0, 1]);
    expect([...t.handle(req(0x10, ...u16(7), ...u16(2), 4, 0x00, 0x0a, 0x01, 0x00))]).toEqual([0x10, 0, 7, 0, 2]);
    expect([t.holding[7], t.holding[8]]).toEqual([10, 256]);
    expect([...t.handle(req(0x06, ...u16(1), 0xab, 0xcd))]).toEqual([0x06, 0, 1, 0xab, 0xcd]);
    expect(t.holding[1]).toBe(0xabcd);
  });

  it('exceptions: illegal function, address, value', () => {
    const t = new ModbusTables();
    expect([...t.handle(req(0x2b))]).toEqual([0xab, 1]);
    expect([...t.handle(req())]).toEqual([...exception(0, 1)]);
    expect([...t.handle(req(0x01, ...u16(TABLE_SIZE - 1), ...u16(2)))]).toEqual([0x81, 2]);
    expect([...t.handle(req(0x01, ...u16(0), ...u16(0)))]).toEqual([0x81, 3]);
    expect([...t.handle(req(0x01, ...u16(0), ...u16(2001)))]).toEqual([0x81, 3]);
    expect([...t.handle(req(0x03, ...u16(0), ...u16(126)))]).toEqual([0x83, 3]);
    expect([...t.handle(req(0x01, 0))]).toEqual([0x81, 3]); // truncated
    expect([...t.handle(req(0x05, ...u16(TABLE_SIZE), 0xff, 0))]).toEqual([0x85, 2]);
    expect([...t.handle(req(0x05, 0, 0))]).toEqual([0x85, 3]);
    expect([...t.handle(req(0x06, ...u16(TABLE_SIZE), 0, 1))]).toEqual([0x86, 2]);
    expect([...t.handle(req(0x0f, ...u16(0), ...u16(10), 1, 0xff))]).toEqual([0x8f, 3]); // byte count mismatch
    expect([...t.handle(req(0x10, ...u16(0), ...u16(2), 2, 0, 1))]).toEqual([0x90, 3]);
    expect([...t.handle(req(0x0f, 0))]).toEqual([0x8f, 3]);
    expect([...t.handle(req(0x10, 0))]).toEqual([0x90, 3]);
    expect([...t.handle(req(0x06, 0))]).toEqual([0x86, 3]);
  });
});

describe('MBAP framing', () => {
  it('round-trips a frame; handles partial and coalesced frames', () => {
    const f1 = encodeFrame(1, 7, req(0x01, 0, 0, 0, 8));
    const f2 = encodeFrame(2, 7, req(0x02, 0, 0, 0, 1));
    expect([...f1.slice(0, 7)]).toEqual([0, 1, 0, 0, 0, 6, 7]);
    const both = Uint8Array.of(...f1, ...f2);
    const a = parseFrames(both.slice(0, f1.length + 4));
    expect(a.frames).toHaveLength(1);
    expect(a.frames[0]).toMatchObject({ txId: 1, unit: 7 });
    expect(a.rest.length).toBe(4);
    const b = parseFrames(Uint8Array.of(...a.rest, ...both.slice(f1.length + 4)));
    expect(b.frames).toHaveLength(1);
    expect(b.frames[0]!.txId).toBe(2);
    expect(b.rest.length).toBe(0);
    expect(parseFrames(new Uint8Array(3))).toMatchObject({ frames: [], invalid: false });
  });

  it('flags a bad protocol id or absurd length as invalid', () => {
    expect(parseFrames(Uint8Array.of(0, 1, 0, 5, 0, 6, 1, 1, 0, 0, 0, 1)).invalid).toBe(true);
    expect(parseFrames(Uint8Array.of(0, 1, 0, 0, 0xff, 0xff, 1)).invalid).toBe(true);
    expect(parseFrames(Uint8Array.of(0, 1, 0, 0, 0, 1, 1)).invalid).toBe(true);
  });
});

describe('Bridge address mapping', () => {
  it('maps %IX/%QX bit addresses to indexes and back', () => {
    expect(addressToIndex('%IX0.0')).toEqual({ area: 'I', index: 0 });
    expect(addressToIndex('%qx1.3')).toEqual({ area: 'Q', index: 11 });
    expect(addressToIndex('%IX255.7')).toEqual({ area: 'I', index: 2047 });
    expect(addressToIndex('%IX256.0')).toBeNull();
    expect(addressToIndex('%IW0')).toBeNull();
    expect(addressToIndex('nope')).toBeNull();
    expect(indexToAddress('Q', 11)).toBe('%QX1.3');
  });

  it('inputs go to discrete inputs; bad ones are reported', () => {
    const b = new Bridge();
    expect(b.setInputs({ '%IX0.1': true, '%IX1.0': true, '%QX0.0': true, '%IX0.2': 'yes', nope: true })).toEqual(['%QX0.0', '%IX0.2', 'nope']);
    expect([b.tables.discreteInputs[1], b.tables.discreteInputs[8], b.tables.discreteInputs[0]]).toEqual([1, 1, 0]);
    b.setInputs({ '%IX0.1': false });
    expect(b.tables.discreteInputs[1]).toBe(0);
  });

  it('coil writes produce output changes once; snapshot and clear', () => {
    const b = new Bridge();
    const events: Array<Record<string, boolean>> = [];
    b.onOutputs = (c) => events.push(c);
    b.tables.handle(req(0x05, ...u16(0), 0xff, 0));
    b.tables.handle(req(0x05, ...u16(0), 0xff, 0)); // same value: no event
    b.tables.handle(req(0x0f, ...u16(8), ...u16(2), 1, 0b11));
    expect(events).toEqual([{ '%QX0.0': true }, { '%QX1.0': true, '%QX1.1': true }]);
    expect(b.outputsSnapshot()).toEqual({ '%QX0.0': true, '%QX1.0': true, '%QX1.1': true });
    expect(b.clearOutputs()).toEqual({ '%QX0.0': false, '%QX1.0': false, '%QX1.1': false });
    expect(b.outputsSnapshot()).toEqual({});
    b.tables.handle(req(0x10, ...u16(0), ...u16(1), 2, 0, 5)); // register writes are not outputs
    expect(events).toHaveLength(2);
  });
});
