// Remises à zéro : historique des lancements (et journaux), notifications, file d'attente, données d'une mini-app.
// Les runs en cours ou en file ne sont jamais touchés ; les fichiers de données d'une app ne le sont que sur demande.
import fsp from 'node:fs/promises';
import type { Repo } from '../db/repo.js';
import type { AppDbManager } from '../core/appdb.js';
import { appFilesDir } from '../core/appdb.js';
import type { AppSpec } from '../core/spec.js';
import { bus } from '../core/events.js';

/** Statuts considérés comme des échecs dans les statistiques du tableau de bord. */
export const FAILED_STATUSES = ['failed', 'timeout', 'lost', 'killed'];

/** Interprète le filtre de statut d'une purge : « failed » couvre tous les échecs, sinon liste explicite (a,b,c). */
export function parseStatusFilter(status: string | undefined): string[] | undefined {
  if (!status) return undefined;
  if (status === 'failed') return FAILED_STATUSES;
  return status.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Supprime des runs terminés et leurs journaux. */
export async function purgeRuns(repo: Repo, opts: { slug?: string; statuses?: string[] } = {}): Promise<{ removed: number }> {
  let removed = 0;
  for (const r of repo.finishedRuns(opts)) {
    if (r.log_path) await fsp.rm(r.log_path, { force: true }).catch(() => {});
    repo.deleteRun(r.id);
    removed++;
  }
  if (removed) bus.emit('runs:purged', { slug: opts.slug ?? null, removed });
  return { removed };
}

/** Vide les tables d'une mini-app (toutes, ou celles nommées) et, sur demande, son dossier de fichiers. */
export async function resetAppData(
  appdb: AppDbManager,
  slug: string,
  app: AppSpec | undefined,
  opts: { tables?: string[]; files?: boolean } = {},
): Promise<{ tables: Record<string, number>; files: boolean }> {
  if (!app) throw new Error('Ce script ne déclare pas de mini-app');
  const names = opts.tables?.length ? opts.tables : Object.keys(app.tables);
  const unknown = names.filter((n) => !app.tables[n]);
  if (unknown.length) throw new Error(`Table(s) inconnue(s) : ${unknown.join(', ')}`);
  appdb.ensure(slug, app);
  const tables: Record<string, number> = {};
  for (const n of names) {
    tables[n] = appdb.deleteWhere(slug, app, n, {});
    bus.emit('app:changed', { slug, table: n });
  }
  if (opts.files) {
    await fsp.rm(appFilesDir(slug), { recursive: true, force: true });
    await fsp.mkdir(appFilesDir(slug), { recursive: true });
  }
  return { tables, files: !!opts.files };
}

export interface GlobalResetOptions {
  runs?: boolean;
  failedOnly?: boolean;
  notifications?: boolean;
  queue?: boolean;
}

/** Remise à zéro globale, pièce par pièce selon les options. */
export async function resetGlobal(repo: Repo, opts: GlobalResetOptions): Promise<{ runs: number; notifications: number; queue: number }> {
  const out = { runs: 0, notifications: 0, queue: 0 };
  if (opts.runs) out.runs = (await purgeRuns(repo, { statuses: opts.failedOnly ? FAILED_STATUSES : undefined })).removed;
  if (opts.notifications) out.notifications = repo.clearNotifications();
  if (opts.queue) {
    out.queue = repo.clearQueueAll();
    if (out.queue) bus.emit('queue:changed', { slug: '*' });
  }
  return out;
}
