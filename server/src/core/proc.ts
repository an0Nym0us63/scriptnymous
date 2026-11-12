// Outils processus : /proc sous Linux, repli portable ailleurs (dev sous Windows/macOS).
import fs from 'node:fs';
import { execFile } from 'node:child_process';

export const isLinux = process.platform === 'linux';
export const isWindows = process.platform === 'win32';

/** Champ `starttime` (22e) de /proc/<pid>/stat ; null si absent ou hors Linux. */
export function readProcStartTicks(pid: number): string | null {
  if (!isLinux) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Le nom de commande est entre parenthèses et peut contenir des espaces : on coupe après la dernière ')'.
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    // rest[0] = state (champ 3) ; starttime est le champ 22 → index 19.
    return rest[19] ?? null;
  } catch {
    return null;
  }
}

/** pgid d'un processus d'après /proc (champ 5) ; null hors Linux. */
export function readProcPgid(pid: number): number | null {
  if (!isLinux) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return Number(rest[2]);
  } catch {
    return null;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Le processus `pid` est-il bien celui que l'on a lancé ?
 * Sous Linux on compare le starttime enregistré ; ailleurs on se contente de la vivacité.
 */
export function isSameProcess(pid: number, startTicks: string | null): boolean {
  if (!pidAlive(pid)) return false;
  if (!isLinux || !startTicks) return true;
  return readProcStartTicks(pid) === startTicks;
}

/** Tous les pids appartenant au groupe `pgid` (Linux uniquement). */
export function pidsInGroup(pgid: number): number[] {
  if (!isLinux) return [];
  const out: number[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    const pid = Number(e);
    if (readProcPgid(pid) === pgid) out.push(pid);
  }
  return out;
}

/** Envoie un signal au groupe entier (Linux) ou à l'arbre (Windows). */
export function killGroup(pid: number, pgid: number | null, signal: NodeJS.Signals): void {
  if (isWindows) {
    if (signal === 'SIGKILL') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {});
    } else {
      try {
        process.kill(pid, signal);
      } catch {
        /* déjà mort */
      }
    }
    return;
  }
  const target = pgid && pgid > 0 ? -pgid : pid;
  try {
    process.kill(target, signal);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ESRCH' && target !== pid) {
      try {
        process.kill(pid, signal);
      } catch {
        /* déjà mort */
      }
    }
  }
}
