// Planificateur : arme chaque planification active, tire à l'heure dite, persiste l'état, rattrape si demandé.
import type { FastifyBaseLogger } from 'fastify';
import type { Repo, ScriptRecord } from '../db/repo.js';
import { bus } from './events.js';
import { applyJitter, missedOccurrences, nextOccurrence, nextOccurrences } from './schedule.js';
import type { ScheduleSpec } from './spec.js';
import type { Orchestrator } from './orchestrator.js';

interface Armed {
  slug: string;
  schedule: ScheduleSpec;
  baseAt: Date; // occurrence théorique
  fireAt: Date; // occurrence + décalage aléatoire
}

export class Scheduler {
  private readonly armed = new Map<string, Armed>();
  private timer: NodeJS.Timeout | null = null;
  private firing = false;

  constructor(
    private readonly repo: Repo,
    private readonly orchestrator: Orchestrator,
    private readonly defaultTz: () => string,
    private readonly log: FastifyBaseLogger,
  ) {}

  private key(slug: string, id: string): string {
    return `${slug}/${id}`;
  }

  /** Arme toutes les planifications de tous les scripts, avec rattrapage des occurrences manquées. */
  start(scripts: ScriptRecord[]): void {
    const now = new Date();
    for (const s of scripts) this.rearm(s, now, true);
    this.timer = setInterval(() => void this.tick(), 2_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Réarme les planifications d'un script (après modification, disparition, réapparition). */
  rearm(script: ScriptRecord, from = new Date(), withCatchUp = false): void {
    for (const k of [...this.armed.keys()]) if (k.startsWith(script.slug + '/')) this.armed.delete(k);
    const active = script.status === 'ok' && script.spec.enabled;
    for (const sch of script.spec.schedules) {
      const id = sch.id!;
      if (!active || !sch.enabled) {
        this.repo.setScheduleState(script.slug, id, null, null);
        bus.emit('schedule:armed', { slug: script.slug, scheduleId: id, nextAt: null });
        continue;
      }
      try {
        if (withCatchUp && sch.catch_up) this.catchUp(script, sch, from);
        this.armOne(script.slug, sch, from);
      } catch (e) {
        this.log.warn({ slug: script.slug, schedule: id, err: (e as Error).message }, 'Planification impossible à armer');
        this.repo.setScheduleState(script.slug, id, null, null);
      }
    }
  }

  private armOne(slug: string, sch: ScheduleSpec, from: Date): void {
    const base = nextOccurrence(sch, from, this.defaultTz());
    const id = sch.id!;
    if (!base) {
      this.repo.setScheduleState(slug, id, null, null);
      bus.emit('schedule:armed', { slug, scheduleId: id, nextAt: null });
      return;
    }
    const fireAt = applyJitter(base, sch);
    this.armed.set(this.key(slug, id), { slug, schedule: sch, baseAt: base, fireAt });
    this.repo.setScheduleState(slug, id, null, fireAt.toISOString());
    bus.emit('schedule:armed', { slug, scheduleId: id, nextAt: fireAt.toISOString() });
  }

  /** Une occurrence prévue (next_at persisté) est passée pendant l'arrêt : on la rejoue une fois. */
  private catchUp(script: ScriptRecord, sch: ScheduleSpec, now: Date): void {
    const state = this.repo.getScheduleState(script.slug, sch.id!);
    const since = state?.last_fired_at ? new Date(state.last_fired_at) : state?.next_at ? new Date(Date.parse(state.next_at) - 1000) : null;
    if (!since) return;
    const missed = missedOccurrences(sch, since, now, this.defaultTz());
    if (!missed.length) return;
    const last = missed[missed.length - 1];
    this.log.info({ slug: script.slug, schedule: sch.id, missed: missed.length, at: last.toISOString() }, 'Rattrapage d’une occurrence manquée');
    this.repo.setScheduleState(script.slug, sch.id!, last.toISOString(), null);
    void this.orchestrator.launch({ slug: script.slug, trigger: 'catch_up', params: sch.params, scheduleId: sch.id });
  }

  private async tick(): Promise<void> {
    if (this.firing) return;
    this.firing = true;
    try {
      const now = Date.now();
      for (const [k, a] of [...this.armed.entries()]) {
        if (a.fireAt.getTime() > now) continue;
        this.armed.delete(k);
        this.repo.setScheduleState(a.slug, a.schedule.id!, a.baseAt.toISOString(), null);
        this.log.info({ slug: a.slug, schedule: a.schedule.id }, 'Planification déclenchée');
        try {
          const o = await this.orchestrator.launch({ slug: a.slug, trigger: 'schedule', params: a.schedule.params, scheduleId: a.schedule.id });
          if (o.outcome === 'rejected') this.log.warn({ slug: a.slug, reason: o.reason }, 'Lancement planifié refusé');
        } catch (e) {
          this.log.error({ err: e }, 'Erreur au lancement planifié');
        }
        // Réarme à partir de l'occurrence théorique (pas de l'heure réelle : le jitter ne doit pas en sauter une).
        this.armOne(a.slug, a.schedule, a.baseAt);
      }
    } finally {
      this.firing = false;
    }
  }

  /** Prochaines dates (sans jitter) pour l'aperçu dans l'interface. */
  preview(sch: ScheduleSpec, count = 5, from = new Date()): Date[] {
    return nextOccurrences(sch, from, count, this.defaultTz());
  }

  nextFor(slug: string): { scheduleId: string; nextAt: string }[] {
    const out: { scheduleId: string; nextAt: string }[] = [];
    for (const a of this.armed.values()) if (a.slug === slug) out.push({ scheduleId: a.schedule.id!, nextAt: a.fireAt.toISOString() });
    return out.sort((x, y) => x.nextAt.localeCompare(y.nextAt));
  }
}
