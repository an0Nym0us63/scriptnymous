// Journaux d'exécution : lecture par tranche et purge par ancienneté / par taille.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { Repo } from '../db/repo.js';

export interface LogSlice {
  text: string;
  offset: number; // offset de fin (à repasser pour la suite)
  size: number;
}

/** Lit le journal à partir de `from` (octets), au plus `max` octets ; `tail` = les derniers `max` octets. */
export async function readLogSlice(logPath: string, from: number, max = 512 * 1024, tail = false): Promise<LogSlice> {
  let size = 0;
  try {
    size = (await fsp.stat(logPath)).size;
  } catch {
    return { text: '', offset: 0, size: 0 };
  }
  let start = Math.max(0, from);
  if (tail && size - start > max) start = size - max;
  if (start >= size) return { text: '', offset: size, size };
  const length = Math.min(max, size - start);
  const fh = await fsp.open(logPath, 'r');
  try {
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, start);
    return { text: buf.toString('utf8'), offset: start + length, size };
  } finally {
    await fh.close();
  }
}

export interface PurgeOptions {
  retentionDays: number;
  maxMb: number;
}

/** Supprime les runs (et journaux) trop anciens, puis les plus vieux tant que la taille totale dépasse le plafond. */
export async function purgeLogs(repo: Repo, opts: PurgeOptions, log: FastifyBaseLogger): Promise<{ removed: number }> {
  let removed = 0;
  const unlink = async (p: string | null) => {
    if (!p) return;
    try {
      await fsp.unlink(p);
    } catch {
      /* déjà absent */
    }
  };
  if (opts.retentionDays > 0) {
    const before = new Date(Date.now() - opts.retentionDays * 86400_000).toISOString();
    for (const r of repo.oldRuns(before)) {
      await unlink(r.log_path);
      repo.deleteRun(r.id);
      removed++;
    }
  }
  if (opts.maxMb > 0) {
    const limit = opts.maxMb * 1024 * 1024;
    const runs = repo.finishedRunsOldestFirst();
    let total = 0;
    const sizes = new Map<string, number>();
    for (const r of runs) {
      let s = 0;
      try {
        if (r.log_path) s = fs.statSync(r.log_path).size;
      } catch {
        s = 0;
      }
      sizes.set(r.id, s);
      total += s;
    }
    for (const r of runs) {
      if (total <= limit) break;
      total -= sizes.get(r.id) ?? 0;
      await unlink(r.log_path);
      repo.deleteRun(r.id);
      removed++;
    }
  }
  if (removed) log.info({ removed }, 'Purge des journaux');
  return { removed };
}
