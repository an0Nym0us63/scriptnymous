// Outils communs aux tests : logger muet, base en mémoire, écriture de scripts d'essai.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { openMemoryDatabase } from '../db/database.js';
import { Repo } from '../db/repo.js';
import { config } from '../config.js';
import { parseSpec } from '../core/spec.js';

export function silentLogger(): FastifyBaseLogger {
  const noop = () => {};
  const l = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, silent: noop, level: 'silent', child: () => l };
  return l as unknown as FastifyBaseLogger;
}

export function memRepo(): Repo {
  return new Repo(openMemoryDatabase());
}

/** Écrit un script Node (portable) dans le dossier des scripts et l'enregistre en base. */
export function writeScript(repo: Repo, slug: string, yaml: string, code: string): void {
  const dir = path.join(config.scriptsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'script.yaml'), yaml);
  fs.writeFileSync(path.join(dir, 'script.js'), code);
  repo.upsertScript(slug, parseSpec(yaml), Date.now(), null);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitFor(pred: () => boolean, timeoutMs = 10_000, step = 50): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor : délai dépassé');
    await sleep(step);
  }
}
