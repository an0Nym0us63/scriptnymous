import { describe, expect, it } from 'vitest';
import { applyJitter, isAllowed, missedOccurrences, nextOccurrences, validateCron } from '../core/schedule.js';
import { ScheduleSchema } from '../core/spec.js';

const TZ = 'Europe/Paris';
const sch = (o: Record<string, unknown>) => ScheduleSchema.parse({ id: 't', cron: '0 * * * *', ...o });
const paris = (iso: string) => new Date(iso); // ISO avec décalage explicite

describe('planification', () => {
  it('valide les expressions cron', () => {
    expect(validateCron('*/5 * * * *')).toBeNull();
    expect(validateCron('99 * * * *')).not.toBeNull();
  });

  it('donne les 5 prochaines occurrences dans le fuseau du script', () => {
    const s = sch({ cron: '30 8 * * *', timezone: TZ });
    const from = paris('2026-03-01T10:00:00+01:00');
    const next = nextOccurrences(s, from, 5, 'UTC');
    expect(next).toHaveLength(5);
    expect(next[0].toISOString()).toBe('2026-03-02T07:30:00.000Z');
    // Passage à l'heure d'été le 29 mars 2026 : 08:30 Paris = 06:30 UTC.
    const summer = nextOccurrences(s, paris('2026-03-29T10:00:00+02:00'), 1, 'UTC');
    expect(summer[0].toISOString()).toBe('2026-03-30T06:30:00.000Z');
  });

  it('respecte la fenêtre horaire', () => {
    const s = sch({ cron: '0 * * * *', window: '09:00-11:00' });
    const next = nextOccurrences(s, paris('2026-06-01T00:30:00+02:00'), 4, TZ);
    expect(next.map((d) => d.toISOString())).toEqual([
      '2026-06-01T07:00:00.000Z',
      '2026-06-01T08:00:00.000Z',
      '2026-06-01T09:00:00.000Z',
      '2026-06-02T07:00:00.000Z',
    ]);
  });

  it('gère une fenêtre qui passe minuit', () => {
    const s = sch({ cron: '0 * * * *', window: '23:00-01:00' });
    expect(isAllowed(s, paris('2026-06-01T23:30:00+02:00'), TZ)).toBe(true);
    expect(isAllowed(s, paris('2026-06-01T00:30:00+02:00'), TZ)).toBe(true);
    expect(isAllowed(s, paris('2026-06-01T12:00:00+02:00'), TZ)).toBe(false);
  });

  it('exclut des jours de semaine et des dates', () => {
    const s = sch({ cron: '0 12 * * *', exclude_days: ['sun', '2026-06-02'] });
    // 31 mai 2026 est un dimanche.
    const next = nextOccurrences(s, paris('2026-05-30T13:00:00+02:00'), 3, TZ);
    expect(next.map((d) => d.toISOString())).toEqual([
      '2026-06-01T10:00:00.000Z',
      '2026-06-03T10:00:00.000Z',
      '2026-06-04T10:00:00.000Z',
    ]);
  });

  it('borne le décalage aléatoire', () => {
    const s = sch({ jitter_seconds: 120 });
    const base = new Date('2026-01-01T00:00:00Z');
    expect(applyJitter(base, s, () => 0).getTime()).toBe(base.getTime());
    expect(applyJitter(base, s, () => 0.999).getTime()).toBeLessThan(base.getTime() + 120_000);
    expect(applyJitter(base, sch({}), () => 0.5).getTime()).toBe(base.getTime());
  });

  it('liste les occurrences manquées pour le rattrapage', () => {
    const s = sch({ cron: '0 */6 * * *' });
    const missed = missedOccurrences(s, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T13:00:00Z'), 'UTC');
    expect(missed.map((d) => d.toISOString())).toEqual(['2026-01-01T06:00:00.000Z', '2026-01-01T12:00:00.000Z']);
    expect(missedOccurrences(s, new Date('2026-01-01T12:00:00Z'), new Date('2026-01-01T13:00:00Z'), 'UTC')).toEqual([]);
  });
});
