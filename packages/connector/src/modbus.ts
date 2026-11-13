// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Minimal Modbus TCP server protocol (MBAP framing + the PDU functions a trainer needs).
 * Pure functions over four data tables, so it is easy to test without sockets.
 *
 *   01 Read Coils            02 Read Discrete Inputs
 *   03 Read Holding Regs     04 Read Input Regs
 *   05 Write Single Coil     06 Write Single Register
 *   15 Write Multiple Coils  16 Write Multiple Registers
 */

export const TABLE_SIZE = 2048;

export const Exc = { ILLEGAL_FUNCTION: 1, ILLEGAL_ADDRESS: 2, ILLEGAL_VALUE: 3 } as const;

export class ModbusTables {
  readonly coils = new Uint8Array(TABLE_SIZE);
  readonly discreteInputs = new Uint8Array(TABLE_SIZE);
  readonly holding = new Uint16Array(TABLE_SIZE);
  readonly inputRegs = new Uint16Array(TABLE_SIZE);
  /** Called after a master wrote coils/registers (addresses touched). */
  onWrite?: (kind: 'coils' | 'holding', start: number, count: number) => void;

  /** Handle one request PDU (function code + data); returns the response PDU. */
  handle(pdu: Uint8Array): Uint8Array {
    if (pdu.length < 1) return exception(0, Exc.ILLEGAL_FUNCTION);
    const fn = pdu[0]!;
    const v = new DataView(pdu.buffer, pdu.byteOffset, pdu.byteLength);
    try {
      switch (fn) {
        case 0x01:
        case 0x02: {
          const [addr, qty] = this.rangeAt(v, 1, 2000);
          const src = fn === 0x01 ? this.coils : this.discreteInputs;
          const bytes = Math.ceil(qty / 8);
          const out = new Uint8Array(2 + bytes);
          out[0] = fn;
          out[1] = bytes;
          for (let i = 0; i < qty; i++) if (src[addr + i]) out[2 + (i >> 3)]! |= 1 << (i & 7);
          return out;
        }
        case 0x03:
        case 0x04: {
          const [addr, qty] = this.rangeAt(v, 1, 125);
          const src = fn === 0x03 ? this.holding : this.inputRegs;
          const out = new Uint8Array(2 + qty * 2);
          out[0] = fn;
          out[1] = qty * 2;
          const ov = new DataView(out.buffer);
          for (let i = 0; i < qty; i++) ov.setUint16(2 + i * 2, src[addr + i]!);
          return out;
        }
        case 0x05: {
          if (pdu.length < 5) throw new ModbusError(Exc.ILLEGAL_VALUE);
          const addr = v.getUint16(1);
          const val = v.getUint16(3);
          if (addr >= TABLE_SIZE) throw new ModbusError(Exc.ILLEGAL_ADDRESS);
          if (val !== 0xff00 && val !== 0x0000) throw new ModbusError(Exc.ILLEGAL_VALUE);
          this.coils[addr] = val ? 1 : 0;
          this.onWrite?.('coils', addr, 1);
          return pdu.slice(0, 5);
        }
        case 0x06: {
          if (pdu.length < 5) throw new ModbusError(Exc.ILLEGAL_VALUE);
          const addr = v.getUint16(1);
          if (addr >= TABLE_SIZE) throw new ModbusError(Exc.ILLEGAL_ADDRESS);
          this.holding[addr] = v.getUint16(3);
          this.onWrite?.('holding', addr, 1);
          return pdu.slice(0, 5);
        }
        case 0x0f: {
          if (pdu.length < 6) throw new ModbusError(Exc.ILLEGAL_VALUE);
          const [addr, qty] = this.rangeAt(v, 1, 1968);
          const byteCount = pdu[5]!;
          if (byteCount !== Math.ceil(qty / 8) || pdu.length < 6 + byteCount) throw new ModbusError(Exc.ILLEGAL_VALUE);
          for (let i = 0; i < qty; i++) this.coils[addr + i] = (pdu[6 + (i >> 3)]! >> (i & 7)) & 1;
          this.onWrite?.('coils', addr, qty);
          return pdu.slice(0, 5);
        }
        case 0x10: {
          if (pdu.length < 6) throw new ModbusError(Exc.ILLEGAL_VALUE);
          const [addr, qty] = this.rangeAt(v, 1, 123);
          const byteCount = pdu[5]!;
          if (byteCount !== qty * 2 || pdu.length < 6 + byteCount) throw new ModbusError(Exc.ILLEGAL_VALUE);
          for (let i = 0; i < qty; i++) this.holding[addr + i] = v.getUint16(6 + i * 2);
          this.onWrite?.('holding', addr, qty);
          return pdu.slice(0, 5);
        }
        default:
          return exception(fn, Exc.ILLEGAL_FUNCTION);
      }
    } catch (e) {
      if (e instanceof ModbusError) return exception(fn, e.code);
      throw e;
    }
  }

  /** Read (start, quantity) at `off`, validating quantity ≤ max and the table bounds. */
  private rangeAt(v: DataView, off: number, max: number): [number, number] {
    if (v.byteLength < off + 4) throw new ModbusError(Exc.ILLEGAL_VALUE);
    const addr = v.getUint16(off);
    const qty = v.getUint16(off + 2);
    if (qty < 1 || qty > max) throw new ModbusError(Exc.ILLEGAL_VALUE);
    if (addr + qty > TABLE_SIZE) throw new ModbusError(Exc.ILLEGAL_ADDRESS);
    return [addr, qty];
  }
}

class ModbusError extends Error {
  constructor(readonly code: number) {
    super(`modbus exception ${code}`);
  }
}

export function exception(fn: number, code: number): Uint8Array {
  return Uint8Array.of(fn | 0x80, code);
}

// ---------- MBAP framing ----------
export interface Frame {
  txId: number;
  unit: number;
  pdu: Uint8Array;
}

/** Pull as many complete frames as possible out of `buf`; returns the frames and the unconsumed rest. */
export function parseFrames(buf: Uint8Array): { frames: Frame[]; rest: Uint8Array; invalid: boolean } {
  const frames: Frame[] = [];
  let pos = 0;
  while (buf.length - pos >= 7) {
    const v = new DataView(buf.buffer, buf.byteOffset + pos, buf.byteLength - pos);
    const proto = v.getUint16(2);
    const len = v.getUint16(4); // unit id + PDU
    if (proto !== 0 || len < 2 || len > 254) return { frames, rest: buf.slice(pos), invalid: true };
    if (buf.length - pos < 6 + len) break;
    frames.push({ txId: v.getUint16(0), unit: v.getUint8(6), pdu: buf.slice(pos + 7, pos + 6 + len) });
    pos += 6 + len;
  }
  return { frames, rest: buf.slice(pos), invalid: false };
}

export function encodeFrame(txId: number, unit: number, pdu: Uint8Array): Uint8Array {
  const out = new Uint8Array(7 + pdu.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, txId);
  v.setUint16(2, 0);
  v.setUint16(4, pdu.length + 1);
  out[6] = unit;
  out.set(pdu, 7);
  return out;
}
