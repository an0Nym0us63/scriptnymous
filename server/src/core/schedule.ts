// Calcul pur des occurrences d'une planification (cron + fenêtre + jours exclus + décalage aléatoire).
import { Cron } from 'croner';
import type { ScheduleSpec } from './spec.js';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export class ScheduleError extends Error {}

export function validateCron(expr: string): string | null {
  try {
    new Cron(expr, { paused: true });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Composantes locales (dans le fuseau) d'une date. */
function localParts(date: Date, tz: string): { ymd: string; weekday: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: String(parts.weekday).toLowerCase().slice(0, 3),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function parseWindow(w: string): [number, number] {
  const [a, b] = w.split('-');
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  };
  return [toMin(a), toMin(b)];
}

/** La date est-elle autorisée par la fenêtre horaire et les jours exclus ? */
export function isAllowed(schedule: ScheduleSpec, date: Date, tz: string): boolean {
  const { ymd, weekday, minutes } = localParts(date, tz);
  for (const ex of schedule.exclude_days) {
    const e = ex.toLowerCase();
    if (e === ymd) return false;
    if (WEEKDAYS.includes(e) && e === weekday) return false;
  }
  if (schedule.window) {
    const [start, end] = parseWindow(schedule.window);
    if (start <= end) {
      if (minutes < start || minutes > end) return false;
    } else {
      // Fenêtre qui passe minuit, ex. 22:00-06:00.
      if (minutes < start && minutes > end) return false;
    }
  }
  return true;
}

/**
 * Prochaines occurrences autorisées strictement après `from`.
 * Le décalage aléatoire n'est pas appliqué ici (aperçu déterministe) : voir `applyJitter`.
 */
export function nextOccurrences(schedule: ScheduleSpec, from: Date, count: number, defaultTz: string): Date[] {
  const tz = schedule.timezone ?? defaultTz;
  let cron: Cron;
  try {
    cron = new Cron(schedule.cron, { timezone: tz, paused: true });
  } catch (e) {
    throw new ScheduleError(`Expression cron invalide « ${schedule.cron} » : ${(e as Error).message}`);
  }
  const out: Date[] = [];
  let cursor: Date | null = from;
  // Garde-fou : une fenêtre très restrictive peut rejeter beaucoup d'occurrences.
  for (let i = 0; i < 5000 && out.length < count; i++) {
    const n: Date | null = cron.nextRun(cursor ?? undefined);
    if (!n) break;
    if (isAllowed(schedule, n, tz)) out.push(n);
    cursor = n;
  }
  cron.stop();
  return out;
}

export function nextOccurrence(schedule: ScheduleSpec, from: Date, defaultTz: string): Date | null {
  return nextOccurrences(schedule, from, 1, defaultTz)[0] ?? null;
}

/** Ajoute un décalage aléatoire de 0 à `jitter_seconds`. */
export function applyJitter(date: Date, schedule: ScheduleSpec, rnd: () => number = Math.random): Date {
  if (!schedule.jitter_seconds) return date;
  return new Date(date.getTime() + Math.floor(rnd() * schedule.jitter_seconds * 1000));
}

/** Occurrences manquées entre `since` (exclu) et `until` (inclus) : utilisé pour le rattrapage. */
export function missedOccurrences(schedule: ScheduleSpec, since: Date, until: Date, defaultTz: string): Date[] {
  const out: Date[] = [];
  let cursor = since;
  for (let i = 0; i < 1000; i++) {
    const n = nextOccurrence(schedule, cursor, defaultTz);
    if (!n || n.getTime() > until.getTime()) break;
    out.push(n);
    cursor = n;
  }
  return out;
}
