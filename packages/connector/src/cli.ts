#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_ORIGINS, startConnector } from './server';

const HELP = `ControlsLab connector — expose les E/S de la machine virtuelle en Modbus TCP.

Usage: node controlslab-connector.mjs [options]

  --modbus-port <n>     port Modbus TCP (défaut 1502; 502 exige les droits administrateur)
  --modbus-host <addr>  adresse d'écoute Modbus (défaut 127.0.0.1; 0.0.0.0 pour un automate sur le réseau)
  --ws-port <n>         port WebSocket pour le navigateur (défaut 8765)
  --allow-origin <o>    origine de la page ControlsLab autorisée (répétable; ex. http://10.0.0.5:12000, ou *)
  -h, --help            cette aide

Cartographie (l'automate externe est le MAÎTRE Modbus) :
  %IXb.p (capteurs → automate)  = entrée discrète  n° 8×b + p   (lecture : fonction 02)
  %QXb.p (automate → actionneur) = bobine           n° 8×b + p   (lecture 01, écriture 05/15)
Adresses de base 0, ID d'unité ignoré. Les registres (03/04/06/16) existent mais ne sont pas utilisés.
`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === name && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
}

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}

const num = (v: string | undefined, d: number) => (v === undefined ? d : Number(v));
const extra = args('--allow-origin');
const c = await startConnector({
  modbusHost: arg('--modbus-host') ?? '127.0.0.1',
  modbusPort: num(arg('--modbus-port'), 1502),
  wsPort: num(arg('--ws-port'), 8765),
  allowOrigins: [...DEFAULT_ORIGINS, ...extra],
  log: (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`),
}).catch((e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `Port déjà utilisé : ${e.message}` : e.code === 'EACCES' ? 'Droits insuffisants pour ce port (essayez un port ≥ 1024).' : String(e));
  process.exit(1);
});
console.log(`ControlsLab connector prêt.
  Modbus TCP : ${arg('--modbus-host') ?? '127.0.0.1'}:${c.modbusPort}
  Navigateur : ws://127.0.0.1:${c.wsPort}   (origines autorisées : ${[...DEFAULT_ORIGINS, ...extra].join(', ')})
Ctrl+C pour arrêter.`);
process.on('SIGINT', () => void c.close().then(() => process.exit(0)));
