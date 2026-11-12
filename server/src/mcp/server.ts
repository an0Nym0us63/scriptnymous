// Serveur MCP (Model Context Protocol) intégré : expose scripts, runs, journaux, planifications, variables et réglages
// à un assistant (Claude Code, Claude Desktop…). Transport Streamable HTTP sur /api/mcp, authentifié comme l'API.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Services } from '../app.js';
import { config } from '../config.js';
import { parseSpec, SpecError, validateSpec, type ScriptSpec } from '../core/spec.js';
import { nextOccurrences, ScheduleError } from '../core/schedule.js';
import { readLogSlice } from '../services/logs.js';
import { suggestFromCode, suggestFromLog } from '../core/deps-suggest.js';
import { configPath } from '../routes/variables.js';
import type { ParamValues } from '../core/params.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true as const });

function summarize(s: ReturnType<Services['repo']['listScripts']>[number], services: Services) {
  const last = services.repo.lastRun(s.slug);
  return {
    slug: s.slug,
    name: s.name,
    group: s.group,
    description: s.spec.description,
    status: s.status,
    spec_error: s.spec_error,
    enabled: s.spec.enabled,
    env_status: s.env_status,
    interpreter: s.spec.command ?? s.spec.interpreter,
    file: s.spec.file,
    params: s.spec.params.map((p) => ({ name: p.name, type: p.type, required: p.required, default: p.default, choices: p.choices, pass: p.pass })),
    concurrency: s.spec.concurrency,
    schedules: s.spec.schedules.map((x) => ({ id: x.id, cron: x.cron, enabled: x.enabled, timezone: x.timezone })),
    next_runs: services.scheduler.nextFor(s.slug),
    running: services.repo.runningRuns(s.slug).map((r) => r.id),
    last_run: last ? { id: last.id, status: last.status, finished_at: last.finished_at, exit_code: last.exit_code } : null,
  };
}

export function buildMcpServer(services: Services): McpServer {
  const { repo, registry, orchestrator, scheduler, envs, settings, notifier } = services;
  const server = new McpServer({ name: 'scriptnymous', version: '0.1.0' }, { instructions: 'ScriptNymous gère des scripts déclarés dans /scripts/<slug>/script.yaml. Utilise list_scripts puis get_script avant de modifier ; save_script réécrit le YAML et le code sur le partage. Les lancements créent des runs dont on lit le journal avec get_run_log.' });

  // ---------- scripts ----------
  server.registerTool('list_scripts', { title: 'Lister les scripts', description: 'Tous les scripts connus avec état, paramètres, planifications, dernier run.', inputSchema: { group: z.string().optional().describe('Filtrer par groupe') } }, async ({ group }) => {
    const all = repo.listScripts().filter((s) => !group || s.group === group);
    return text({ scripts_dir_available: registry.dirAvailable(), scripts: all.map((s) => summarize(s, services)) });
  });

  server.registerTool('get_script', { title: 'Détail d’un script', description: 'Déclaration complète (spec), YAML brut, code du fichier, journal d’environnement, file d’attente.', inputSchema: { slug: z.string(), include_code: z.boolean().default(true) } }, async ({ slug, include_code }) => {
    const s = repo.getScript(slug);
    if (!s) return fail(`Script inconnu : ${slug}`);
    return text({ ...summarize(s, services), spec: s.spec, yaml: registry.readYaml(slug), code: include_code ? registry.readScriptFile(slug, s.spec.file) : undefined, env_log: s.env_log, queue: repo.listQueue(slug) });
  });

  server.registerTool(
    'save_script',
    {
      title: 'Créer ou modifier un script',
      description: 'Écrit /scripts/<slug>/script.yaml (depuis `spec` objet ou `yaml` texte) et, si fourni, le fichier du script (`code`). Pour une modification partielle : get_script, modifier la spec, puis save_script avec la spec complète. Le slug est le chemin du dossier relatif à /scripts (sous-dossiers autorisés).',
      inputSchema: { slug: z.string(), spec: z.record(z.any()).optional(), yaml: z.string().optional(), code: z.string().optional() },
    },
    async ({ slug, spec, yaml, code }) => {
      try {
        let parsed: ScriptSpec;
        if (yaml !== undefined) parsed = parseSpec(yaml);
        else if (spec !== undefined) parsed = validateSpec(spec);
        else return fail('`spec` ou `yaml` requis');
        const rec = await registry.save(slug, parsed, code, yaml ?? null);
        return text({ ok: true, script: summarize(rec, services) });
      } catch (e) {
        return fail(e instanceof SpecError ? `${e.message}${e.issues.length ? '\n- ' + e.issues.join('\n- ') : ''}` : String(e));
      }
    },
  );

  server.registerTool('delete_script', { title: 'Supprimer un script', description: 'Supprime le dossier du script et sa déclaration (les runs passés sont conservés). Irréversible.', inputSchema: { slug: z.string(), confirm: z.literal(true).describe('Doit valoir true') } }, async ({ slug }) => {
    if (!repo.getScript(slug)) return fail('Script inconnu');
    if (repo.runningRuns(slug).length) return fail('Un run est en cours');
    await registry.remove(slug);
    return text({ ok: true });
  });

  server.registerTool('read_script_file', { title: 'Lire un fichier d’un script', description: 'Contenu texte d’un fichier du dossier d’un script (relatif au dossier).', inputSchema: { slug: z.string(), file: z.string() } }, async ({ slug, file }) => {
    const c = registry.readScriptFile(slug, file);
    return c === null ? fail('Fichier introuvable') : text(c);
  });

  server.registerTool('write_script_file', { title: 'Écrire un fichier d’un script', description: 'Écrit un fichier annexe dans le dossier du script (le fichier principal passe par save_script).', inputSchema: { slug: z.string(), file: z.string(), content: z.string() } }, async ({ slug, file, content }) => {
    const dir = registry.scriptDir(slug);
    const p = path.resolve(dir, file);
    if (!p.startsWith(dir + path.sep)) return fail('Chemin hors du dossier du script');
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, content, 'utf8');
    return text({ ok: true, path: path.relative(config.scriptsDir, p) });
  });

  server.registerTool('browse_scripts_dir', { title: 'Parcourir /scripts', description: 'Liste un dossier du partage des scripts (dossiers, fichiers, dossiers déjà déclarés).', inputSchema: { path: z.string().default('') } }, async ({ path: rel }) => {
    const root = path.resolve(config.scriptsDir);
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) return fail('Chemin hors du dossier des scripts');
    try {
      const entries = await fsp.readdir(abs, { withFileTypes: true });
      return text(entries.filter((e) => !e.name.startsWith('.')).map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', declared: e.isDirectory() && fs.existsSync(path.join(abs, e.name, 'script.yaml')) })));
    } catch {
      return fail('Dossier introuvable');
    }
  });

  server.registerTool('reload_scripts', { title: 'Relire le dossier des scripts', description: 'Force la relecture de /scripts.' }, async () => {
    await registry.reloadAll();
    return text({ ok: true, count: repo.listScripts().length });
  });

  // ---------- exécution ----------
  server.registerTool('run_script', { title: 'Lancer un script', description: 'Lance un script avec des paramètres ; respecte la politique de concurrence. Renvoie le run créé (ou skipped/queued/rejected).', inputSchema: { slug: z.string(), params: z.record(z.any()).default({}) } }, async ({ slug, params }) => {
    const out = await orchestrator.launch({ slug, trigger: 'api', params: params as ParamValues });
    return out.outcome === 'rejected' ? fail(`Refusé : ${out.reason}`) : text(out);
  });

  server.registerTool('stop_run', { title: 'Arrêter un run', description: 'SIGTERM puis SIGKILL après le délai de grâce.', inputSchema: { run_id: z.string() } }, async ({ run_id }) => {
    const r = orchestrator.stopRun(run_id);
    return r.ok ? text({ ok: true }) : fail(r.reason ?? 'Impossible');
  });

  server.registerTool('list_runs', { title: 'Historique des runs', description: 'Runs récents, filtrables par script, statut (running, success, failed, timeout, killed, lost, skipped) et déclencheur.', inputSchema: { slug: z.string().optional(), status: z.string().optional(), trigger: z.string().optional(), limit: z.number().int().min(1).max(200).default(20) } }, async (q) => {
    return text({ total: repo.countRuns(q), runs: repo.listRuns(q) });
  });

  server.registerTool('get_run', { title: 'Détail d’un run', description: 'Statut, code de sortie, pid, durée, paramètres (secrets masqués).', inputSchema: { run_id: z.string() } }, async ({ run_id }) => {
    const r = repo.getRun(run_id);
    return r ? text(r) : fail('Run inconnu');
  });

  server.registerTool('get_run_log', { title: 'Journal d’un run', description: 'Derniers octets du journal (par défaut 64 Ko) ou à partir d’un offset.', inputSchema: { run_id: z.string(), max_bytes: z.number().int().min(1024).max(2_000_000).default(65536), from: z.number().int().min(0).optional() } }, async ({ run_id, max_bytes, from }) => {
    const r = repo.getRun(run_id);
    if (!r) return fail('Run inconnu');
    if (!r.log_path) return text({ status: r.status, text: '' });
    const slice = await readLogSlice(r.log_path, from ?? 0, max_bytes, from === undefined);
    return text({ status: r.status, ...slice });
  });

  server.registerTool('wait_run', { title: 'Attendre la fin d’un run', description: 'Attend (au plus `timeout_seconds`, 120 par défaut) qu’un run se termine et renvoie son état final avec la fin du journal.', inputSchema: { run_id: z.string(), timeout_seconds: z.number().int().min(1).max(600).default(120) } }, async ({ run_id, timeout_seconds }) => {
    const start = Date.now();
    let r = repo.getRun(run_id);
    if (!r) return fail('Run inconnu');
    while (r && r.status === 'running' && Date.now() - start < timeout_seconds * 1000) {
      await new Promise((res) => setTimeout(res, 1000));
      r = repo.getRun(run_id);
    }
    const log = r?.log_path ? await readLogSlice(r.log_path, 0, 16384, true) : null;
    return text({ run: r, finished: r?.status !== 'running', log_tail: log?.text ?? '' });
  });

  server.registerTool('get_activity', { title: 'Activité en cours', description: 'Installations d’environnement, runs en cours, file d’attente et retries différés.' }, async () => {
    const scripts = repo.listScripts();
    return text({
      installs: scripts.filter((s) => s.env_status === 'installing' || s.env_status === 'pending').map((s) => ({ slug: s.slug, status: s.env_status, log_tail: (s.env_log ?? '').slice(-1000) })),
      running: repo.runningRuns().map((r) => ({ id: r.id, slug: r.script_slug, started_at: r.started_at })),
      queue: repo.listQueue(),
    });
  });

  // ---------- environnement ----------
  server.registerTool('rebuild_env', { title: 'Reconstruire l’environnement', description: 'Relance l’installation des dépendances (pip/npm/apt/bin) d’un script.', inputSchema: { slug: z.string() } }, async ({ slug }) => {
    const s = repo.getScript(slug);
    if (!s) return fail('Script inconnu');
    envs.ensure(s, true);
    return text({ ok: true });
  });

  server.registerTool('suggest_dependencies', { title: 'Suggérer des dépendances', description: 'Déduit les paquets pip/npm/apt d’un code et/ou d’un journal d’échec.', inputSchema: { interpreter: z.string().optional(), code: z.string().optional(), log: z.string().optional() } }, async ({ interpreter, code, log }) => {
    return text([...(log ? suggestFromLog(log) : []), ...(code ? suggestFromCode(interpreter, code) : [])]);
  });

  // ---------- planifications ----------
  server.registerTool('list_schedules', { title: 'Planifications', description: 'Toutes les planifications avec prochain passage.' }, async () => {
    const out = [];
    for (const s of repo.listScripts()) {
      const next = Object.fromEntries(scheduler.nextFor(s.slug).map((n) => [n.scheduleId, n.nextAt]));
      for (const sch of s.spec.schedules) out.push({ slug: s.slug, script: s.name, ...sch, next_at: next[sch.id!] ?? null, active: s.status === 'ok' && s.spec.enabled && sch.enabled });
    }
    return text(out);
  });

  server.registerTool('preview_schedule', { title: 'Aperçu d’une expression cron', description: 'Prochaines occurrences (fenêtre et jours exclus appliqués).', inputSchema: { cron: z.string(), timezone: z.string().optional(), window: z.string().optional(), exclude_days: z.array(z.string()).default([]), count: z.number().int().min(1).max(50).default(5) } }, async ({ cron, timezone, window, exclude_days, count }) => {
    try {
      const dates = nextOccurrences({ id: 'p', cron, timezone, window, exclude_days, enabled: true, jitter_seconds: 0, catch_up: false, params: {} }, new Date(), count, settings.get().timezone);
      return text(dates.map((d) => d.toISOString()));
    } catch (e) {
      return fail(e instanceof ScheduleError ? e.message : String(e));
    }
  });

  // ---------- variables partagées ----------
  const readVars = async (): Promise<{ data: Record<string, unknown>; path: string }> => {
    const p = configPath(settings);
    try {
      return { data: JSON.parse((await fsp.readFile(p, 'utf8')).replace(/^﻿/, '')) as Record<string, unknown>, path: p };
    } catch {
      return { data: {}, path: p };
    }
  };
  const writeVars = async (p: string, data: unknown): Promise<void> => {
    if (fs.existsSync(p)) await fsp.copyFile(p, p + '.bak');
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p + '.tmp', JSON.stringify(data, null, 2) + '\n', 'utf8');
    await fsp.rename(p + '.tmp', p);
  };
  const maskKey = (k: string) => /(pass|pwd|mdp|secret|token|api[_-]?key|apikey|_key$|_api$|auth|credential|private)/i.test(k);
  const mask = (v: unknown, k = ''): unknown => {
    if (v && typeof v === 'object') return Array.isArray(v) ? v.map((x) => mask(x)) : Object.fromEntries(Object.entries(v as object).map(([kk, vv]) => [kk, mask(vv, kk)]));
    return maskKey(k) && typeof v === 'string' && v ? '••••••' : v;
  };

  server.registerTool('get_variables', { title: 'Variables partagées', description: 'Contenu du fichier JSON partagé (secrets masqués sauf reveal=true). `path` : chemin pointé, ex. "YOUTUBE_CHANNEL_FOLLOW.0.name".', inputSchema: { path: z.string().optional(), reveal: z.boolean().default(false) } }, async ({ path: p, reveal }) => {
    const { data, path: file } = await readVars();
    let v: unknown = data;
    for (const seg of p ? p.split('.') : []) v = (v as Record<string, unknown>)?.[seg];
    return text({ file, path: p ?? '', value: reveal ? v : mask(v, p?.split('.').pop() ?? '') });
  });

  server.registerTool('set_variable', { title: 'Définir une variable', description: 'Crée ou remplace une valeur au chemin donné (segments séparés par des points, index numériques pour les listes). Les objets intermédiaires sont créés.', inputSchema: { path: z.string().min(1), value: z.any() } }, async ({ path: p, value }) => {
    const { data, path: file } = await readVars();
    const segs = p.split('.');
    let cur: Record<string, unknown> | unknown[] = data;
    for (let i = 0; i < segs.length - 1; i++) {
      const k = segs[i];
      const next = Array.isArray(cur) ? cur[Number(k)] : cur[k];
      if (next === undefined || next === null || typeof next !== 'object') {
        const created = /^\d+$/.test(segs[i + 1]) ? [] : {};
        if (Array.isArray(cur)) cur[Number(k)] = created;
        else cur[k] = created;
        cur = created;
      } else cur = next as Record<string, unknown>;
    }
    const last = segs[segs.length - 1];
    if (Array.isArray(cur)) cur[Number(last)] = value;
    else cur[last] = value;
    await writeVars(file, data);
    return text({ ok: true, path: p });
  });

  server.registerTool('delete_variable', { title: 'Supprimer une variable', description: 'Supprime la clé (ou l’élément de liste) au chemin donné.', inputSchema: { path: z.string().min(1) } }, async ({ path: p }) => {
    const { data, path: file } = await readVars();
    const segs = p.split('.');
    let cur: unknown = data;
    for (const k of segs.slice(0, -1)) cur = (cur as Record<string, unknown>)?.[k];
    if (!cur || typeof cur !== 'object') return fail('Chemin introuvable');
    const last = segs[segs.length - 1];
    if (Array.isArray(cur)) cur.splice(Number(last), 1);
    else delete (cur as Record<string, unknown>)[last];
    await writeVars(file, data);
    return text({ ok: true });
  });

  // ---------- réglages ----------
  server.registerTool('get_settings', { title: 'Réglages', description: 'Réglages globaux (le jeton ntfy n’est jamais renvoyé) et informations système.' }, async () => {
    return text({ settings: settings.getPublic(), scripts_dir: config.scriptsDir, scripts_dir_available: registry.dirAvailable(), data_dir: config.dataDir, stats: repo.runStats() });
  });

  server.registerTool('update_settings', { title: 'Modifier les réglages', description: 'Champs : ntfy_server, ntfy_topic, ntfy_token, public_url, log_retention_days, log_max_mb, orphan_policy (kill|adopt), timezone, variables_file.', inputSchema: { ntfy_server: z.string().optional(), ntfy_topic: z.string().optional(), ntfy_token: z.string().optional(), public_url: z.string().optional(), log_retention_days: z.number().int().min(0).optional(), log_max_mb: z.number().int().min(0).optional(), orphan_policy: z.enum(['kill', 'adopt']).optional(), timezone: z.string().optional(), variables_file: z.string().optional() } }, async (patch) => {
    settings.update(patch);
    for (const s of repo.listScripts()) scheduler.rearm(s);
    return text(settings.getPublic());
  });

  server.registerTool('test_ntfy', { title: 'Tester ntfy', description: 'Envoie une notification de test avec les réglages globaux.' }, async () => text(await notifier.test()));

  return server;
}
