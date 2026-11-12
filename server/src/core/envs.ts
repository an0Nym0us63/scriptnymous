// Environnements de dépendances par script : venv (uv), node_modules, binaires, paquets apt.
// Tout vit dans /data/envs/<slug>/, /data/bin et le cache apt ; rien n'exige de reconstruire l'image.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { paths } from '../config.js';
import type { Repo, ScriptRecord } from '../db/repo.js';
import { bus } from './events.js';
import { depsFingerprint, hasDeps, type DepsSpec } from './spec.js';
import { isLinux, isWindows } from './proc.js';
import { ensureDir, exists } from '../util/fs.js';

export function envDir(slug: string): string {
  return path.join(paths.envs, slug);
}

/** Variables et PATH à injecter au lancement d'un script (synchrone, sans vérification). */
export function envRuntime(slug: string, deps: DepsSpec): { env: Record<string, string>; pathPrepend: string[] } {
  const env: Record<string, string> = {};
  const pathPrepend: string[] = [];
  const dir = envDir(slug);
  if (deps.pip.length) {
    const venv = path.join(dir, 'venv');
    env.VIRTUAL_ENV = venv;
    pathPrepend.push(path.join(venv, isWindows ? 'Scripts' : 'bin'));
  }
  if (deps.npm.length) {
    const nodeDir = path.join(dir, 'node');
    env.NODE_PATH = path.join(nodeDir, 'node_modules');
    pathPrepend.push(path.join(nodeDir, 'node_modules', '.bin'));
  }
  if (deps.bin.length) pathPrepend.push(paths.bin);
  return { env, pathPrepend };
}

function run(cmd: string, args: string[], onLog: (s: string) => void, opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<number> {
  return new Promise((resolve) => {
    onLog(`$ ${cmd} ${args.join(' ')}\n`);
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      onLog(`erreur : ${(e as Error).message}\n`);
      return resolve(127);
    }
    child.stdout?.on('data', (b) => onLog(b.toString()));
    child.stderr?.on('data', (b) => onLog(b.toString()));
    child.on('error', (e) => {
      onLog(`erreur : ${e.message}\n`);
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function which(cmd: string): boolean {
  const sep = isWindows ? ';' : ':';
  const exts = isWindows ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const d of (process.env.PATH ?? '').split(sep)) for (const e of exts) if (exists(path.join(d, cmd + e))) return true;
  return false;
}

export class EnvManager {
  private readonly busy = new Set<string>();
  private aptLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly repo: Repo,
    private readonly log: FastifyBaseLogger,
  ) {
    ensureDir(paths.envs);
    ensureDir(paths.bin);
    ensureDir(paths.aptCache);
  }

  isReady(script: ScriptRecord): boolean {
    return !hasDeps(script.spec.deps) || script.env_status === 'ready';
  }

  /** Prépare l'environnement si l'empreinte a changé (ou si `force`). Ne bloque pas l'appelant. */
  ensure(script: ScriptRecord, force = false): void {
    const deps = script.spec.deps;
    const slug = script.slug;
    if (!hasDeps(deps)) {
      if (script.env_status !== 'none') this.setStatus(slug, 'none', null, null);
      return;
    }
    const fp = depsFingerprint(deps);
    if (!force && script.env_status === 'ready' && script.env_fingerprint === fp && this.artifactsPresent(slug, deps)) return;
    if (this.busy.has(slug)) return;
    this.busy.add(slug);
    this.setStatus(slug, 'installing', '', script.env_fingerprint);
    void this.install(slug, deps, fp).finally(() => this.busy.delete(slug));
  }

  private artifactsPresent(slug: string, deps: DepsSpec): boolean {
    const dir = envDir(slug);
    if (deps.pip.length && !exists(path.join(dir, 'venv'))) return false;
    if (deps.npm.length && !exists(path.join(dir, 'node', 'node_modules'))) return false;
    for (const b of deps.bin) if (!exists(path.join(paths.bin, b.name))) return false;
    return true;
  }

  private setStatus(slug: string, status: 'none' | 'pending' | 'installing' | 'ready' | 'error', log: string | null, fp: string | null): void {
    this.repo.setEnvStatus(slug, status, log, fp);
    bus.emit('env:changed', { slug, status });
  }

  private async install(slug: string, deps: DepsSpec, fp: string): Promise<void> {
    const dir = envDir(slug);
    ensureDir(dir);
    let buffer = '';
    let flushTimer: NodeJS.Timeout | null = null;
    const onLog = (s: string) => {
      buffer += s;
      if (!flushTimer)
        flushTimer = setTimeout(() => {
          this.repo.appendEnvLog(slug, buffer);
          buffer = '';
          flushTimer = null;
          bus.emit('env:changed', { slug, status: 'installing' });
        }, 300);
    };
    const flush = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      if (buffer) this.repo.appendEnvLog(slug, buffer);
      buffer = '';
    };
    onLog(`# Préparation de l'environnement de ${slug} — ${new Date().toISOString()}\n`);
    try {
      if (deps.apt.length) await this.installApt(deps.apt, onLog);
      if (deps.pip.length) await this.installPip(dir, deps.pip, onLog);
      else await fsp.rm(path.join(dir, 'venv'), { recursive: true, force: true });
      if (deps.npm.length) await this.installNpm(dir, deps.npm, onLog);
      else await fsp.rm(path.join(dir, 'node'), { recursive: true, force: true });
      for (const b of deps.bin) await this.installBin(b, onLog);
      onLog(`# Environnement prêt.\n`);
      flush();
      const log = this.repo.getScript(slug)?.env_log ?? null;
      this.setStatus(slug, 'ready', log, fp);
      this.log.info({ slug }, 'Environnement prêt');
    } catch (e) {
      onLog(`# ERREUR : ${(e as Error).message}\n`);
      flush();
      const log = this.repo.getScript(slug)?.env_log ?? null;
      this.setStatus(slug, 'error', log, null);
      this.log.warn({ slug, err: (e as Error).message }, 'Environnement en erreur');
    }
  }

  private async installPip(dir: string, pkgs: string[], onLog: (s: string) => void): Promise<void> {
    const venv = path.join(dir, 'venv');
    const py = path.join(venv, isWindows ? 'Scripts/python.exe' : 'bin/python');
    if (which('uv')) {
      if (!exists(py)) {
        const c = await run('uv', ['venv', venv, '--quiet'], onLog);
        if (c !== 0) throw new Error(`uv venv a échoué (code ${c})`);
      }
      const c = await run('uv', ['pip', 'install', '--python', py, '--quiet', ...pkgs], onLog, { env: { UV_CACHE_DIR: path.join(paths.envs, '.uv-cache') } });
      if (c !== 0) throw new Error(`uv pip install a échoué (code ${c})`);
      return;
    }
    // Repli sans uv : venv standard + pip.
    const python = isWindows ? 'python' : 'python3';
    if (!exists(py)) {
      const c = await run(python, ['-m', 'venv', venv], onLog);
      if (c !== 0) throw new Error(`python -m venv a échoué (code ${c})`);
    }
    const c = await run(py, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', ...pkgs], onLog);
    if (c !== 0) throw new Error(`pip install a échoué (code ${c})`);
  }

  private async installNpm(dir: string, pkgs: string[], onLog: (s: string) => void): Promise<void> {
    const nodeDir = path.join(dir, 'node');
    ensureDir(nodeDir);
    const deps: Record<string, string> = {};
    for (const p of pkgs) {
      // « nom@version » ou « nom » ; les paquets scopés commencent par @.
      const at = p.lastIndexOf('@');
      if (at > 0) deps[p.slice(0, at)] = p.slice(at + 1);
      else deps[p] = '*';
    }
    await fsp.writeFile(path.join(nodeDir, 'package.json'), JSON.stringify({ name: 'scriptnymous-env', private: true, dependencies: deps }, null, 2));
    const npm = isWindows ? 'npm.cmd' : 'npm';
    const c = await run(npm, ['install', '--no-audit', '--no-fund', '--omit=dev', '--loglevel=warn'], onLog, { cwd: nodeDir });
    if (c !== 0) throw new Error(`npm install a échoué (code ${c})`);
  }

  private async installBin(b: { name: string; url: string; sha256?: string }, onLog: (s: string) => void): Promise<void> {
    const target = path.join(paths.bin, b.name);
    if (exists(target)) {
      if (!b.sha256 || (await sha256File(target)) === b.sha256.toLowerCase()) {
        onLog(`binaire ${b.name} déjà présent\n`);
        return;
      }
      onLog(`binaire ${b.name} présent mais somme différente : nouveau téléchargement\n`);
    }
    onLog(`téléchargement de ${b.url}\n`);
    const res = await fetch(b.url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`téléchargement de ${b.name} : HTTP ${res.status}`);
    const tmp = target + '.part';
    const buf = Buffer.from(await res.arrayBuffer());
    await fsp.writeFile(tmp, buf);
    if (b.sha256) {
      const sum = createHash('sha256').update(buf).digest('hex');
      if (sum !== b.sha256.toLowerCase()) {
        await fsp.rm(tmp, { force: true });
        throw new Error(`somme SHA-256 incorrecte pour ${b.name} (obtenu ${sum})`);
      }
    }
    await fsp.rename(tmp, target);
    if (!isWindows) await fsp.chmod(target, 0o755);
    onLog(`binaire ${b.name} installé\n`);
  }

  /** Installation apt sérialisée (un seul apt à la fois). Hors Linux ou sans droits : ignorée avec avertissement. */
  installApt(pkgs: string[], onLog: (s: string) => void): Promise<void> {
    const task = async () => {
      if (!isLinux || !which('apt-get')) {
        onLog(`apt ignoré (pas de apt-get sur cette plateforme) : ${pkgs.join(' ')}\n`);
        return;
      }
      const missing: string[] = [];
      for (const p of pkgs) {
        const c = await run('dpkg', ['-s', p], () => {});
        if (c !== 0) missing.push(p);
      }
      if (!missing.length) {
        onLog(`paquets apt déjà présents : ${pkgs.join(' ')}\n`);
        return;
      }
      const env = { DEBIAN_FRONTEND: 'noninteractive' };
      const aptOpts = [`-o`, `Dir::Cache::archives=${paths.aptCache}`];
      const sudo = process.getuid?.() === 0 ? [] : which('sudo') ? ['sudo', '-n'] : null;
      if (sudo === null) throw new Error('apt-get requiert root (ou sudo sans mot de passe)');
      const prefix = sudo.length ? sudo : [];
      const cmd = prefix.length ? prefix[0] : 'apt-get';
      const pre = prefix.length ? [...prefix.slice(1), 'apt-get'] : [];
      let c = await run(cmd, [...pre, ...aptOpts, 'update', '-qq'], onLog, { env });
      if (c !== 0) onLog(`avertissement : apt-get update a renvoyé ${c}\n`);
      c = await run(cmd, [...pre, ...aptOpts, 'install', '-y', '-qq', '--no-install-recommends', ...missing], onLog, { env });
      if (c !== 0) throw new Error(`apt-get install a échoué (code ${c})`);
    };
    const p = this.aptLock.then(task, task);
    this.aptLock = p.catch(() => {});
    return p;
  }

  /** Au démarrage : union des paquets apt déclarés par tous les scripts. */
  async installAptUnion(scripts: ScriptRecord[]): Promise<void> {
    const all = new Set<string>();
    for (const s of scripts) if (s.status === 'ok') for (const p of s.spec.deps.apt) all.add(p);
    if (!all.size) return;
    const lines: string[] = [];
    try {
      await this.installApt([...all], (s) => lines.push(s));
      this.log.info({ packages: [...all] }, 'Paquets apt vérifiés au démarrage');
    } catch (e) {
      this.log.warn({ err: (e as Error).message, out: lines.join('').slice(-2000) }, 'Installation apt au démarrage en échec');
    }
  }
}

async function sha256File(p: string): Promise<string> {
  const h = createHash('sha256');
  h.update(await fsp.readFile(p));
  return h.digest('hex');
}

export { fs as _fs };
