// Registre des scripts : lit /scripts/<slug>/script.yaml, surveille le dossier (chokidar + relecture périodique)
// et tient la table `scripts` à jour. Un script absent passe en « missing », rien n'est supprimé.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import type { Repo, ScriptRecord } from '../db/repo.js';
import { bus } from './events.js';
import { parseSpec, SpecError, stringifySpec, type ScriptSpec, isValidSlug } from './spec.js';
import { ensureDir } from '../util/fs.js';

export const YAML_NAME = 'script.yaml';
export const MAX_DEPTH = 4;
const SKIP_DIRS = new Set(['node_modules', 'venv', '.venv', '__pycache__', '#recycle', '@eaDir']);

export interface RegistryHooks {
  onMissing?: (script: ScriptRecord) => void;
  onChanged?: (script: ScriptRecord, previous: ScriptRecord | null) => void;
}

export class Registry {
  private watcher: FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  private reloading = false;

  constructor(
    private readonly repo: Repo,
    private readonly log: FastifyBaseLogger,
    private readonly hooks: RegistryHooks = {},
  ) {}

  dirAvailable(): boolean {
    try {
      return fs.statSync(config.scriptsDir).isDirectory();
    } catch {
      return false;
    }
  }

  /** Relit tout le dossier et rapproche avec la base. */
  async reloadAll(): Promise<void> {
    if (this.reloading) return;
    this.reloading = true;
    try {
      const known = new Map(this.repo.listScripts().map((s) => [s.slug, s]));
      const seen = new Set<string>();
      if (!this.dirAvailable()) {
        this.log.warn({ dir: config.scriptsDir }, 'Dossier des scripts introuvable : tous les scripts passent en « introuvable »');
      } else {
        for (const { slug, yamlPath } of await this.findDeclared(config.scriptsDir, '', 0)) {
          let st: fs.Stats;
          try {
            st = await fsp.stat(yamlPath);
          } catch {
            continue;
          }
          seen.add(slug);
          const prev = known.get(slug) ?? null;
          if (prev && prev.status !== 'missing' && prev.yaml_mtime === Math.floor(st.mtimeMs)) {
            this.repo.touchScriptSeen(slug);
            continue;
          }
          await this.loadOne(slug, yamlPath, Math.floor(st.mtimeMs), prev);
        }
      }
      for (const [slug, s] of known) {
        if (seen.has(slug)) continue;
        if (this.repo.markScriptMissing(slug)) {
          this.log.warn({ slug }, 'Script introuvable dans le dossier : planifications suspendues');
          const rec = this.repo.getScript(slug)!;
          this.hooks.onMissing?.(rec);
          bus.emit('script:changed', { slug });
        }
      }
      bus.emit('scripts:reloaded', { count: seen.size });
    } finally {
      this.reloading = false;
    }
  }

  /**
   * Dossiers contenant un script.yaml, à toute profondeur (MAX_DEPTH). On ne descend pas dans un dossier déclaré :
   * ses sous-dossiers appartiennent au script. Les dossiers cachés et les environnements sont ignorés.
   */
  private async findDeclared(dir: string, rel: string, depth: number): Promise<{ slug: string; yamlPath: string }[]> {
    const out: { slug: string; yamlPath: string }[] = [];
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const slug = rel ? `${rel}/${e.name}` : e.name;
      if (!isValidSlug(slug)) {
        this.log.warn({ dir: slug }, 'Dossier ignoré : nom invalide');
        continue;
      }
      const sub = path.join(dir, e.name);
      const yamlPath = path.join(sub, YAML_NAME);
      if (fs.existsSync(yamlPath)) out.push({ slug, yamlPath });
      else if (depth < MAX_DEPTH) out.push(...(await this.findDeclared(sub, slug, depth + 1)));
    }
    return out;
  }

  private async loadOne(slug: string, yamlPath: string, mtime: number, prev: ScriptRecord | null): Promise<void> {
    let text: string;
    try {
      text = await fsp.readFile(yamlPath, 'utf8');
    } catch (e) {
      this.log.warn({ slug, err: e }, 'Lecture du YAML impossible');
      return;
    }
    try {
      const spec = parseSpec(text);
      const filePath = path.join(path.dirname(yamlPath), spec.file);
      if (!fs.existsSync(filePath)) throw new SpecError(`Fichier du script introuvable : ${spec.file}`);
      this.repo.upsertScript(slug, spec, mtime, null);
      this.log.info({ slug, name: spec.name }, prev ? 'Script mis à jour' : 'Script découvert');
    } catch (e) {
      const msg = e instanceof SpecError ? e.message : String(e);
      // On garde la dernière déclaration valide connue pour l'affichage, avec l'erreur.
      const fallback: ScriptSpec = prev?.spec ?? {
        name: slug,
        description: '',
        icon: 'alert-triangle',
        color: '#ef4444',
        interpreter: 'bash',
        file: 'script.sh',
        env: {},
        timeout_seconds: 0,
        params: [],
        concurrency: 'skip',
        retry: { attempts: 1, delay_seconds: 30, factor: 2, max_delay_seconds: 3600, retry_on: [], no_retry_on: [] },
        schedules: [],
        notify: { events: [], priority: 3, tags: [] },
        deps: { apt: [], pip: [], npm: [], bin: [] },
        enabled: true,
      };
      this.repo.upsertScript(slug, fallback, mtime, msg);
      this.log.warn({ slug, err: msg }, 'Déclaration invalide');
    }
    const rec = this.repo.getScript(slug)!;
    this.hooks.onChanged?.(rec, prev);
    bus.emit('script:changed', { slug });
  }

  /** Démarre la surveillance : chokidar (inotify) + relecture périodique de secours. */
  start(): void {
    const schedule = () => {
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => void this.reloadAll().catch((e) => this.log.error(e)), 500);
    };
    if (this.dirAvailable()) {
      try {
        this.watcher = chokidar.watch(config.scriptsDir, {
          ignoreInitial: true,
          depth: MAX_DEPTH + 1,
          awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        });
        this.watcher.on('all', (ev, p) => {
          if (p.endsWith(YAML_NAME) || ev === 'addDir' || ev === 'unlinkDir') schedule();
        });
        this.watcher.on('error', (e) => this.log.warn({ err: e }, 'Surveillance du dossier en erreur (relecture périodique active)'));
      } catch (e) {
        this.log.warn({ err: e }, 'Surveillance du dossier impossible (relecture périodique seule)');
      }
    }
    this.pollTimer = setInterval(() => void this.reloadAll().catch((e) => this.log.error(e)), config.scriptsPollSeconds * 1000);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    await this.watcher?.close();
  }

  // ---------- écriture depuis l'interface ----------

  scriptDir(slug: string): string {
    return path.join(config.scriptsDir, slug);
  }

  readScriptFile(slug: string, file: string): string | null {
    const p = this.safePath(slug, file);
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  }

  readYaml(slug: string): string | null {
    try {
      return fs.readFileSync(path.join(this.scriptDir(slug), YAML_NAME), 'utf8');
    } catch {
      return null;
    }
  }

  /** Écrit la déclaration (et éventuellement le code) puis recharge ce script. */
  async save(slug: string, spec: ScriptSpec, code?: string | null, yamlText?: string | null): Promise<ScriptRecord> {
    if (!isValidSlug(slug)) throw new SpecError('Identifiant invalide : chemin de dossier relatif à /scripts, sans « .. » ni caractères interdits');
    if (!this.dirAvailable()) throw new SpecError(`Le dossier des scripts ${config.scriptsDir} est inaccessible`);
    const dir = this.scriptDir(slug);
    ensureDir(dir);
    const filePath = this.safePath(slug, spec.file);
    if (code !== undefined && code !== null) {
      await fsp.writeFile(filePath, code.replace(/\r\n/g, '\n'), 'utf8');
    } else if (!fs.existsSync(filePath)) {
      await fsp.writeFile(filePath, defaultTemplate(spec), 'utf8');
    }
    const text = yamlText ?? stringifySpec(spec);
    await fsp.writeFile(path.join(dir, YAML_NAME), text, 'utf8');
    const st = await fsp.stat(path.join(dir, YAML_NAME));
    await this.loadOne(slug, path.join(dir, YAML_NAME), Math.floor(st.mtimeMs), this.repo.getScript(slug));
    return this.repo.getScript(slug)!;
  }

  /** Supprime le dossier du script et sa ligne en base (les runs et journaux restent). */
  async remove(slug: string): Promise<void> {
    const dir = this.scriptDir(slug);
    if (fs.existsSync(dir)) await fsp.rm(dir, { recursive: true, force: true });
    this.repo.deleteScript(slug);
    bus.emit('script:changed', { slug });
  }

  private safePath(slug: string, file: string): string {
    const dir = this.scriptDir(slug);
    const p = path.resolve(dir, file);
    if (!p.startsWith(dir + path.sep) && p !== dir) throw new SpecError('Chemin de fichier hors du dossier du script');
    return p;
  }
}

function defaultTemplate(spec: ScriptSpec): string {
  switch (spec.interpreter) {
    case 'python3':
      return '#!/usr/bin/env python3\nimport sys\n\nprint("Bonjour depuis", sys.argv[0])\nprint("Arguments :", sys.argv[1:])\n';
    case 'node':
      return "console.log('Bonjour depuis', process.argv[1]);\nconsole.log('Arguments :', process.argv.slice(2));\n";
    default:
      return '#!/usr/bin/env bash\nset -euo pipefail\n\necho "Bonjour depuis $0"\necho "Arguments : $*"\n';
  }
}
