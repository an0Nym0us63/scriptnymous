// Notifications ntfy : configuration globale + surcharge par script, lien d'action vers le run.
import type { FastifyBaseLogger } from 'fastify';
import type { Repo, RunRow, ScriptRecord } from '../db/repo.js';
import type { NotifyEvent } from '../core/spec.js';
import type { SettingsService } from './settings.js';

const TITLES: Record<NotifyEvent, string> = {
  start: 'Démarrage',
  success: 'Succès',
  failure: 'Échec',
  final_failure: 'Échec définitif',
  already_running: 'Déjà en cours',
  missing: 'Script introuvable',
  lost: 'Processus perdu',
};

const DEFAULT_TAGS: Record<NotifyEvent, string[]> = {
  start: ['arrow_forward'],
  success: ['white_check_mark'],
  failure: ['x'],
  final_failure: ['rotating_light'],
  already_running: ['hourglass'],
  missing: ['question'],
  lost: ['ghost'],
};

export class Notifier {
  constructor(
    private readonly repo: Repo,
    private readonly settings: SettingsService,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Envoie si l'événement est souscrit par le script. */
  async notify(event: NotifyEvent, script: ScriptRecord, run: RunRow | null, detail?: string): Promise<void> {
    const n = script.spec.notify;
    if (!n.events.includes(event)) return;
    const g = this.settings.get();
    const server = (n.server ?? g.ntfy_server).replace(/\/$/, '');
    const topic = n.topic ?? g.ntfy_topic;
    const token = n.token ?? g.ntfy_token;
    if (!server || !topic) {
      this.log.debug({ slug: script.slug, event }, 'ntfy non configuré : notification ignorée');
      return;
    }
    const lines: string[] = [];
    if (run) {
      lines.push(`Déclencheur : ${run.trigger}${run.attempt > 1 ? ` · essai ${run.attempt}/${run.max_attempts}` : ''}`);
      if (run.exit_code !== null && run.exit_code !== undefined) lines.push(`Code de sortie : ${run.exit_code}`);
      if (run.started_at && run.finished_at)
        lines.push(`Durée : ${Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000)} s`);
    }
    if (detail) lines.push(detail);
    const body = lines.join('\n') || script.spec.description || script.slug;
    const priority = event === 'final_failure' ? Math.min(5, n.priority + 1) : n.priority;
    const headers: Record<string, string> = {
      Title: `${script.spec.name} · ${TITLES[event]}`,
      Priority: String(priority),
      Tags: [...DEFAULT_TAGS[event], ...n.tags].join(','),
      'Content-Type': 'text/plain; charset=utf-8',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (g.public_url) {
      const url = run ? `${g.public_url}/runs/${run.id}` : `${g.public_url}/scripts/${script.slug}`;
      headers.Click = url;
      headers.Actions = `view, ${run ? 'Voir le run' : 'Voir le script'}, ${url}, clear=true`;
    }
    await this.send(server, topic, headers, body, script.slug, run?.id ?? null, event);
  }

  /** Envoi de test depuis la page Réglages. */
  async test(): Promise<{ ok: boolean; error?: string }> {
    const g = this.settings.get();
    if (!g.ntfy_server || !g.ntfy_topic) return { ok: false, error: 'Serveur ou sujet ntfy manquant' };
    const headers: Record<string, string> = { Title: 'ScriptNymous · test', Tags: 'tada', Priority: '3' };
    if (g.ntfy_token) headers.Authorization = `Bearer ${g.ntfy_token}`;
    return this.send(g.ntfy_server.replace(/\/$/, ''), g.ntfy_topic, headers, 'Les notifications fonctionnent.', null, null, 'test');
  }

  private async send(
    server: string,
    topic: string,
    headers: Record<string, string>,
    body: string,
    slug: string | null,
    runId: string | null,
    event: string,
  ): Promise<{ ok: boolean; error?: string }> {
    // Les en-têtes HTTP n'acceptent pas l'UTF-8 brut : ntfy supporte l'encodage RFC 2047 pour Title.
    const safeHeaders = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k, /[^\x20-\x7e]/.test(v) ? `=?UTF-8?B?${Buffer.from(v).toString('base64')}?=` : v]),
    );
    try {
      const res = await fetch(`${server}/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: safeHeaders,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      const ok = res.ok;
      const error = ok ? null : `HTTP ${res.status}`;
      this.repo.logNotification(slug, runId, event, topic, ok, error);
      if (!ok) this.log.warn({ topic, status: res.status }, 'ntfy a refusé la notification');
      return ok ? { ok } : { ok, error: error! };
    } catch (e) {
      const msg = (e as Error).message;
      this.repo.logNotification(slug, runId, event, topic, false, msg);
      this.log.warn({ topic, err: msg }, 'Envoi ntfy impossible');
      return { ok: false, error: msg };
    }
  }
}
