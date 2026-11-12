import { PlcRuntime } from '../src';

/** Load a program (throws on error), put PLC in RUN. */
export function run(src: string, scanMs = 10): PlcRuntime {
  const plc = new PlcRuntime({ scanMs });
  const r = plc.load(src);
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('\n'));
  plc.start();
  return plc;
}

/** Wrap statements in a PROGRAM with the given VAR block, run one scan. */
export function exec(vars: string, body: string): PlcRuntime {
  const plc = run(`PROGRAM Main\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM`);
  plc.scan();
  return plc;
}

export function loadErr(src: string) {
  const plc = new PlcRuntime();
  const r = plc.load(src);
  if (r.ok) throw new Error('expected an error');
  return r.errors[0]!;
}

export const prog = (vars: string, body: string) => `PROGRAM Main\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM`;
