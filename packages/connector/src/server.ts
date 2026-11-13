// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The connector process: a Modbus TCP server (for the external PLC) and a WebSocket
 * server (for the ControlsLab page running in the user's browser).
 *
 * WebSocket protocol (JSON text frames):
 *   browser → connector   { type: "hello", app: "controlslab", v: 1 }
 *                         { type: "inputs", values: { "%IX0.0": true, … } }   (may be partial)
 *   connector → browser   { type: "welcome", v: 1, modbus: { host, port }, masters: n }
 *                         { type: "outputs", values: { "%QX0.0": true, … }, full?: true }
 *                         { type: "masters", count: n }
 */
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { Bridge } from './bridge';
import { encodeFrame, parseFrames } from './modbus';

export interface ConnectorOptions {
  /** Modbus TCP listen address / port (0 = ephemeral, for tests). */
  modbusHost?: string;
  modbusPort?: number;
  /** WebSocket listen address / port. Loopback by default: only this machine's browser can connect. */
  wsHost?: string;
  wsPort?: number;
  /** Allowed `Origin` values for the WebSocket. Wildcards: "http://localhost:*", "*". */
  allowOrigins?: string[];
  log?: (msg: string) => void;
}

export const DEFAULT_ORIGINS = ['http://localhost:*', 'http://127.0.0.1:*', 'https://localhost:*', 'https://127.0.0.1:*', 'http://[::1]:*'];

export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true; // non-browser clients (tests, scripts) send no Origin
  return allowed.some((pattern) => {
    if (pattern === '*') return true;
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return re.test(origin);
  });
}

export interface Connector {
  bridge: Bridge;
  modbusPort: number;
  wsPort: number;
  masters(): number;
  close(): Promise<void>;
}

export async function startConnector(opts: ConnectorOptions = {}): Promise<Connector> {
  const log = opts.log ?? (() => undefined);
  const bridge = new Bridge();
  const masters = new Set<Socket>();
  const browsers = new Set<WebSocket>();
  const allowed = opts.allowOrigins ?? DEFAULT_ORIGINS;

  const send = (ws: WebSocket, msg: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: unknown) => browsers.forEach((b) => send(b, msg));
  bridge.onOutputs = (changed) => broadcast({ type: 'outputs', values: changed });

  // ---- Modbus TCP ----
  const tcp: TcpServer = createTcpServer((sock) => {
    masters.add(sock);
    log(`Modbus: master connecté (${sock.remoteAddress}) — ${masters.size} connexion(s)`);
    broadcast({ type: 'masters', count: masters.size });
    sock.setNoDelay(true);
    let buf: Uint8Array = new Uint8Array(0);
    sock.on('data', (chunk) => {
      const merged = new Uint8Array(buf.length + chunk.length);
      merged.set(buf);
      merged.set(chunk, buf.length);
      const { frames, rest, invalid } = parseFrames(merged);
      buf = rest;
      for (const f of frames) sock.write(encodeFrame(f.txId, f.unit, bridge.tables.handle(f.pdu)));
      if (invalid || buf.length > 4096) sock.destroy(); // garbage or flood: drop the connection
    });
    sock.on('error', () => undefined);
    sock.on('close', () => {
      masters.delete(sock);
      log(`Modbus: master déconnecté — ${masters.size} connexion(s)`);
      broadcast({ type: 'masters', count: masters.size });
    });
  });
  await new Promise<void>((resolve, reject) => {
    tcp.once('error', reject);
    tcp.listen(opts.modbusPort ?? 1502, opts.modbusHost ?? '127.0.0.1', () => resolve());
  });
  const modbusAddr = tcp.address() as { port: number; address: string };

  // ---- WebSocket ----
  const wss = new WebSocketServer({
    host: opts.wsHost ?? '127.0.0.1',
    port: opts.wsPort ?? 8765,
    maxPayload: 64 * 1024,
    verifyClient: (info, cb) => {
      const ok = originAllowed(info.origin, allowed);
      if (!ok) log(`WebSocket: origine refusée (${info.origin}). Ajoutez --allow-origin ${info.origin} pour l'autoriser.`);
      cb(ok, 403, 'Origin not allowed');
    },
  });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve());
    wss.once('error', reject);
  });
  const wsPort = (wss.address() as { port: number }).port;

  wss.on('connection', (ws) => {
    browsers.add(ws);
    log('Navigateur connecté');
    ws.on('message', (data) => {
      let msg: { type?: string; values?: Record<string, unknown>; app?: string };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        send(ws, { type: 'welcome', v: 1, modbus: { host: opts.modbusHost ?? '127.0.0.1', port: modbusAddr.port }, masters: masters.size });
        send(ws, { type: 'outputs', values: bridge.outputsSnapshot(), full: true });
      } else if (msg.type === 'inputs' && msg.values && typeof msg.values === 'object') {
        const ignored = bridge.setInputs(msg.values);
        if (ignored.length) log(`Adresses ignorées : ${ignored.slice(0, 5).join(', ')}`);
      }
    });
    ws.on('close', () => {
      browsers.delete(ws);
      log('Navigateur déconnecté');
      // Without the simulation, outputs must not stay energized: de-energize everything.
      if (browsers.size === 0) {
        bridge.clearOutputs();
        bridge.tables.discreteInputs.fill(0);
      }
    });
    ws.on('error', () => undefined);
  });

  return {
    bridge,
    modbusPort: modbusAddr.port,
    wsPort,
    masters: () => masters.size,
    close: async () => {
      for (const b of browsers) b.terminate();
      for (const m of masters) m.destroy();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => tcp.close(() => r()));
    },
  };
}
