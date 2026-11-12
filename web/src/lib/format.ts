// Mise en forme : dates relatives, durées, libellés et couleurs d'état. Tout en français.
import type { RunStatus, EnvStatus } from './api';

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const dtf = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const tf = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' });
const dfull = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dtf.format(new Date(iso));
}
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return tf.format(new Date(iso));
}
export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dfull.format(new Date(iso));
}

export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return diff < 0 ? 'à l’instant' : 'dans quelques secondes';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return fmtDate(iso);
}

export function duration(startIso: string | null | undefined, endIso?: string | null, now = Date.now()): string {
  if (!startIso) return '—';
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : now;
  return durationMs(Math.max(0, end - start));
}
export function durationMs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60 ? `${s % 60} s` : ''}`.trim();
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}

export const STATUS: Record<RunStatus, { label: string; tone: 'ok' | 'err' | 'warn' | 'info' | 'muted' | 'accent' }> = {
  queued: { label: 'En file', tone: 'info' },
  running: { label: 'En cours', tone: 'accent' },
  success: { label: 'Succès', tone: 'ok' },
  failed: { label: 'Échec', tone: 'err' },
  killed: { label: 'Arrêté', tone: 'warn' },
  timeout: { label: 'Délai dépassé', tone: 'err' },
  lost: { label: 'Perdu', tone: 'err' },
  skipped: { label: 'Ignoré', tone: 'muted' },
};

export const ENV_STATUS: Record<EnvStatus, { label: string; tone: 'ok' | 'err' | 'warn' | 'info' | 'muted' | 'accent' }> = {
  none: { label: 'Aucune dépendance', tone: 'muted' },
  pending: { label: 'En attente', tone: 'info' },
  installing: { label: 'Installation…', tone: 'accent' },
  ready: { label: 'Prêt', tone: 'ok' },
  error: { label: 'Erreur', tone: 'err' },
};

export const TRIGGER: Record<string, string> = {
  manual: 'Manuel',
  schedule: 'Planifié',
  api: 'API',
  retry: 'Nouvel essai',
  queue: 'File',
  catch_up: 'Rattrapage',
};

export const CONCURRENCY: Record<string, { label: string; help: string }> = {
  skip: { label: 'Ignorer', help: 'Si une instance tourne encore, la nouvelle demande est ignorée (et tracée).' },
  queue: { label: 'Mettre en file', help: 'La nouvelle demande attend la fin de l’instance en cours.' },
  kill: { label: 'Remplacer', help: 'L’instance en cours est arrêtée, puis la nouvelle démarre.' },
  parallel: { label: 'En parallèle', help: 'Plusieurs instances peuvent tourner en même temps.' },
};

export const NOTIFY_EVENTS: Record<string, string> = {
  start: 'Démarrage',
  success: 'Succès',
  failure: 'Échec (chaque essai)',
  final_failure: 'Échec définitif',
  already_running: 'Instance déjà en cours',
  missing: 'Script introuvable',
  lost: 'Processus perdu',
};

export function toneClasses(tone: string): string {
  switch (tone) {
    case 'ok':
      return 'bg-ok-soft text-ok';
    case 'err':
      return 'bg-err-soft text-err';
    case 'warn':
      return 'bg-warn-soft text-warn';
    case 'info':
      return 'bg-info-soft text-info';
    case 'accent':
      return 'bg-accent-soft text-accent-2';
    default:
      return 'bg-surface-3 text-muted';
  }
}

/** Description humaine (approximative) d'une expression cron à 5 champs. */
export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  const days: Record<string, string> = { '0': 'dim.', '1': 'lun.', '2': 'mar.', '3': 'mer.', '4': 'jeu.', '5': 'ven.', '6': 'sam.', '7': 'dim.' };
  const dowTxt = (d: string) => {
    if (d === '*') return '';
    if (d === '1-5') return 'du lundi au vendredi';
    if (d === '0,6' || d === '6,0') return 'le week-end';
    return 'le ' + d.split(',').map((x) => x.includes('-') ? x.split('-').map((y) => days[y] ?? y).join(' à ') : days[x] ?? x).join(', ');
  };
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*') return `toutes les ${min.slice(2)} min ${dowTxt(dow)}`.trim();
  if (hour.startsWith('*/') && dom === '*' && mon === '*') return `toutes les ${hour.slice(2)} h à :${min.padStart(2, '0')} ${dowTxt(dow)}`.trim();
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*') return `tous les jours à ${hour.padStart(2, '0')}:${min.padStart(2, '0')} ${dowTxt(dow)}`.trim();
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && mon === '*') return `le ${dom} de chaque mois à ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (min === '*' && hour === '*') return 'chaque minute';
  return expr;
}
