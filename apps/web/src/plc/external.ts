// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Link to the ControlsLab connector (a local program that exposes the simulated I/O as a Modbus TCP
 * server). When enabled, an external PLC replaces the virtual one: machine inputs are sent to the
 * connector, and the coils written by the external PLC come back as PLC outputs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type LinkState = 'disconnected' | 'connecting' | 'connected' | 'error';
export const DEFAULT_URL = 'ws://127.0.0.1:8765';
const KEY = 'controlslab.modbus.v1';

export class ExternalLink {
  state: LinkState = 'disconnected';
  error: string | undefined;
  modbus: { host: string; port: number } | undefined;
  masters = 0;
  /** Latest PLC outputs written by the external PLC, by address. */
  readonly outputs: Record<string, boolean> = {};
  private ws: WebSocket | null = null;
  private lastSent = '';

  constructor(private readonly onChange: () => void) {}

  connect(url: string) {
    this.disconnect();
    this.state = 'connecting';
    this.error = undefined;
    this.onChange();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.fail(`URL invalide : ${(e as Error).message}`);
      return;
    }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', app: 'controlslab', v: 1 }));
    ws.onmessage = (ev) => {
      let m: { type?: string; values?: Record<string, boolean>; full?: boolean; modbus?: { host: string; port: number }; masters?: number; count?: number };
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.type === 'welcome') {
        this.state = 'connected';
        this.modbus = m.modbus;
        this.masters = m.masters ?? 0;
        this.lastSent = '';
      } else if (m.type === 'outputs' && m.values) {
        if (m.full) for (const k of Object.keys(this.outputs)) delete this.outputs[k];
        for (const [a, v] of Object.entries(m.values)) {
          if (v) this.outputs[a] = true;
          else delete this.outputs[a];
        }
      } else if (m.type === 'masters') {
        this.masters = m.count ?? 0;
      }
      this.onChange();
    };
    ws.onerror = () => {
      if (this.state !== 'connected') this.fail(`Connexion impossible à ${url}. Le connecteur est-il démarré? Si cette page n'est pas sur localhost, relancez-le avec --allow-origin ${location.origin}`);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const was = this.state;
      this.ws = null;
      for (const k of Object.keys(this.outputs)) delete this.outputs[k];
      if (was === 'connected') {
        this.state = 'disconnected';
        this.onChange();
      } else if (was === 'connecting') this.fail(`Connexion refusée par ${url}. Si cette page n'est pas sur localhost, relancez le connecteur avec --allow-origin ${location.origin}`);
    };
  }

  private fail(msg: string) {
    this.state = 'error';
    this.error = msg;
    this.ws?.close();
    this.ws = null;
    this.onChange();
  }

  disconnect() {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    for (const k of Object.keys(this.outputs)) delete this.outputs[k];
    this.modbus = undefined;
    this.masters = 0;
    this.lastSent = '';
    if (this.state !== 'disconnected') {
      this.state = 'disconnected';
      this.error = undefined;
      this.onChange();
    }
  }

  /** Send the machine's PLC inputs; only when they changed. */
  sendInputs(values: Record<string, boolean>) {
    if (this.state !== 'connected' || !this.ws) return;
    const key = JSON.stringify(values);
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.ws.send(JSON.stringify({ type: 'inputs', values }));
  }
}

export interface ExternalPlc {
  enabled: boolean;
  setEnabled(v: boolean): void;
  url: string;
  setUrl(u: string): void;
  state: LinkState;
  error: string | undefined;
  modbus: { host: string; port: number } | undefined;
  masters: number;
  connect(): void;
  disconnect(): void;
  /** True when an external PLC is selected and the connector link is up. */
  active: boolean;
  /** Imperative access for the real-time loops (stable object). */
  link: ExternalLink;
}

function load(): { enabled: boolean; url: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { enabled?: boolean; url?: string };
    return { enabled: !!raw.enabled, url: typeof raw.url === 'string' && /^wss?:\/\//.test(raw.url) ? raw.url : DEFAULT_URL };
  } catch {
    return { enabled: false, url: DEFAULT_URL };
  }
}

export function useExternalPlc(): ExternalPlc {
  const init = useMemo(load, []);
  const [enabled, setEnabledState] = useState(init.enabled);
  const [url, setUrlState] = useState(init.url);
  const [, setTick] = useState(0);
  const linkRef = useRef<ExternalLink | null>(null);
  if (!linkRef.current) linkRef.current = new ExternalLink(() => setTick((t) => t + 1));
  const link = linkRef.current;

  const save = (e: boolean, u: string) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ enabled: e, url: u }));
    } catch {
      /* ignore */
    }
  };
  useEffect(() => () => link.disconnect(), [link]);

  const setEnabled = useCallback(
    (v: boolean) => {
      setEnabledState(v);
      save(v, url);
      if (!v) link.disconnect();
    },
    [link, url],
  );
  const setUrl = useCallback(
    (u: string) => {
      setUrlState(u);
      save(enabled, u);
    },
    [enabled],
  );

  return {
    enabled,
    setEnabled,
    url,
    setUrl,
    state: link.state,
    error: link.error,
    modbus: link.modbus,
    masters: link.masters,
    connect: () => link.connect(url),
    disconnect: () => link.disconnect(),
    active: enabled && link.state === 'connected',
    link,
  };
}
