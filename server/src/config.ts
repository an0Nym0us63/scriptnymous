// Configuration du serveur : tout vient des variables d'environnement, rien n'est codé en dur.
import path from 'node:path';

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const isDev = process.env.NODE_ENV === 'development';

export const config = {
  isDev,
  port: num('SN_PORT', 8080),
  host: process.env.SN_HOST ?? '0.0.0.0',
  scriptsDir: path.resolve(process.env.SN_SCRIPTS_DIR ?? '/scripts'),
  dataDir: path.resolve(process.env.SN_DATA_DIR ?? '/data'),
  password: process.env.SN_PASSWORD ?? '',
  resetPassword: process.env.SN_RESET_PASSWORD === '1',
  sessionSecret: process.env.SN_SESSION_SECRET ?? '',
  timezone: process.env.TZ ?? 'Europe/Paris',
  publicUrl: (process.env.SN_PUBLIC_URL ?? '').replace(/\/$/, ''),
  ntfy: {
    server: process.env.SN_NTFY_SERVER ?? 'https://ntfy.sh',
    topic: process.env.SN_NTFY_TOPIC ?? '',
    token: process.env.SN_NTFY_TOKEN ?? '',
  },
  logRetentionDays: num('SN_LOG_RETENTION_DAYS', 30),
  logMaxMb: num('SN_LOG_MAX_MB', 500),
  logLevel: process.env.SN_LOG_LEVEL ?? 'info',
  // Intervalle de relecture du dossier des scripts (secours quand inotify ne fonctionne pas : SMB/NFS).
  scriptsPollSeconds: num('SN_SCRIPTS_POLL_SECONDS', 60),
  // Intervalle du balayage des processus fantômes.
  reaperSeconds: num('SN_REAPER_SECONDS', 30),
  // Délai de grâce entre SIGTERM et SIGKILL.
  killGraceSeconds: num('SN_KILL_GRACE_SECONDS', 10),
  // Répertoire des fichiers statiques de l'interface compilée.
  webDist: path.resolve(process.env.SN_WEB_DIST ?? path.join(process.cwd(), '..', 'web', 'dist')),
};

export const paths = {
  db: path.join(config.dataDir, 'scriptnymous.db'),
  logs: path.join(config.dataDir, 'logs'),
  envs: path.join(config.dataDir, 'envs'),
  bin: path.join(config.dataDir, 'bin'),
  aptCache: path.join(config.dataDir, 'apt-cache'),
  uploads: path.join(config.dataDir, 'uploads'),
};
