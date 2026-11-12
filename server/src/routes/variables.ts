// Variables partagées : /scripts/config.json, lu par les scripts eux-mêmes. Lecture, écriture atomique avec
// sauvegarde .bak et contrôle de version (mtime) pour ne pas écraser une modification faite ailleurs.
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';

import type { SettingsService } from '../services/settings.js';

/** Chemin absolu du fichier de variables (réglage `variables_file`), toujours dans le dossier des scripts. */
export function configPath(settings: SettingsService): string {
  const rel = (settings.get().variables_file || 'config.json').split('\\').join('/').replace(/^\/+/, '');
  const root = path.resolve(config.scriptsDir);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) return path.join(root, 'config.json');
  return abs;
}

async function readConfig(p: string): Promise<{ exists: boolean; data: unknown; raw: string; mtime: number; error: string | null }> {
  try {
    const st = await fsp.stat(p);
    const raw = await fsp.readFile(p, 'utf8');
    try {
      return { exists: true, data: JSON.parse(raw.replace(/^﻿/, '')), raw, mtime: Math.floor(st.mtimeMs), error: null };
    } catch (e) {
      return { exists: true, data: null, raw, mtime: Math.floor(st.mtimeMs), error: `JSON invalide : ${(e as Error).message}` };
    }
  } catch {
    return { exists: false, data: {}, raw: '', mtime: 0, error: null };
  }
}

export async function registerVariableRoutes(app: FastifyInstance): Promise<void> {
  const { settings } = app.services;
  app.get('/api/variables', async () => {
    const p = configPath(settings);
    const r = await readConfig(p);
    return { ...r, path: p, relative: path.relative(config.scriptsDir, p).split(path.sep).join('/'), writable: app.services.registry.dirAvailable() };
  });

  const Body = z.object({
    data: z.unknown().optional(),
    raw: z.string().optional(),
    // mtime vu par le client ; si le fichier a changé depuis, on refuse (sauf force).
    mtime: z.number().optional(),
    force: z.boolean().optional(),
  });

  app.put('/api/variables', async (req, reply) => {
    const body = Body.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Corps invalide' });
    if (!app.services.registry.dirAvailable()) return reply.code(409).send({ error: 'Dossier des scripts inaccessible' });
    let text: string;
    if (body.data.raw !== undefined) {
      try {
        JSON.parse(body.data.raw);
      } catch (e) {
        return reply.code(422).send({ error: `JSON invalide : ${(e as Error).message}` });
      }
      text = body.data.raw.endsWith('\n') ? body.data.raw : body.data.raw + '\n';
    } else if (body.data.data !== undefined) {
      text = JSON.stringify(body.data.data, null, 2) + '\n';
    } else return reply.code(400).send({ error: '`data` ou `raw` requis' });

    const p = configPath(settings);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    const current = await readConfig(p);
    if (!body.data.force && body.data.mtime !== undefined && current.exists && current.mtime !== body.data.mtime)
      return reply.code(409).send({ error: 'Le fichier a été modifié entre-temps. Rechargez avant d’enregistrer.', mtime: current.mtime });

    // Sauvegarde de la version précédente puis écriture atomique (fichier temporaire + renommage).
    if (current.exists) {
      try {
        await fsp.copyFile(p, p + '.bak');
      } catch {
        /* sauvegarde impossible : on écrit quand même */
      }
    }
    const tmp = p + '.tmp';
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, p);
    const after = await readConfig(p);
    app.log.info({ bytes: text.length }, 'config.json enregistré');
    return { ok: true, mtime: after.mtime, data: after.data };
  });

  app.get('/api/variables/backup', async (req, reply) => {
    const p = configPath(settings) + '.bak';
    if (!fs.existsSync(p)) return reply.code(404).send({ error: 'Aucune sauvegarde' });
    return reply.header('Content-Type', 'application/json; charset=utf-8').send(await fsp.readFile(p, 'utf8'));
  });
}
