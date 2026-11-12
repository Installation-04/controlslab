// SPDX-License-Identifier: AGPL-3.0-only
/** Export / import: full backup (JSON), ST programs (.st), community content (YAML). */
import { PlcRuntime } from '@controlslab/plc-engine';
import { z } from 'zod';
import { Progress } from './progress';

export const BACKUP_APP = 'controlslab';

const Backup = z.object({
  app: z.literal(BACKUP_APP),
  kind: z.literal('backup'),
  v: z.literal(1),
  exportedAt: z.string(),
  progress: Progress,
});
export type Backup = z.infer<typeof Backup>;

export function makeBackup(progress: Progress, now = new Date()): Backup {
  return { app: BACKUP_APP, kind: 'backup', v: 1, exportedAt: now.toISOString(), progress };
}

export const backupFileName = (now = new Date()) => `controlslab-backup-${now.toISOString().slice(0, 10).replace(/-/g, '')}.json`;

export class ImportError extends Error {}

/** Parse + validate a backup file's text. Never throws anything but ImportError. */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('Fichier JSON invalide');
  }
  const r = Backup.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new ImportError(`Sauvegarde invalide: ${i.path.join('.') || '(racine)'} — ${i.message}`);
  }
  return r.data;
}

/** One-line summary shown before the user confirms an import. */
export function describeBackup(b: Backup): { lessons: number; orders: number; checkpoints: number; programs: number; date: string } {
  const p = b.progress;
  return {
    lessons: Object.values(p.lessons).filter((l) => l.done).length,
    orders: Object.values(p.orders).filter((o) => o.passed).length,
    checkpoints: Object.values(p.checkpoints).reduce((n, l) => n + l.length, 0),
    programs: Object.keys(p.programs).length,
    date: b.exportedAt.slice(0, 10),
  };
}

/** Validate an imported .st file by parsing it with the real compiler, before it reaches the editor. */
export function checkStSource(text: string): { ok: true } | { ok: false; message: string } {
  if (text.length > 200_000) return { ok: false, message: 'Fichier trop volumineux' };
  const r = new PlcRuntime().load(text);
  return r.ok ? { ok: true } : { ok: false, message: r.errors[0]?.message ?? 'Erreur' };
}

export function download(name: string, text: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const pickFile = (accept: string): Promise<{ name: string; text: string } | null> =>
  new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
