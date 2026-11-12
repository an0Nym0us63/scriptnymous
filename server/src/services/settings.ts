// Réglages globaux : valeurs par défaut depuis l'environnement, surcharge stockée en base (page Réglages).
import { config } from '../config.js';
import type { Repo } from '../db/repo.js';

export interface Settings {
  ntfy_server: string;
  ntfy_topic: string;
  ntfy_token: string;
  public_url: string;
  log_retention_days: number;
  log_max_mb: number;
  // Au redémarrage, un run encore vivant est tué (kill) ou suivi jusqu'à sa fin (adopt).
  orphan_policy: 'kill' | 'adopt';
  timezone: string;
}

export const SETTING_KEYS: (keyof Settings)[] = [
  'ntfy_server',
  'ntfy_topic',
  'ntfy_token',
  'public_url',
  'log_retention_days',
  'log_max_mb',
  'orphan_policy',
  'timezone',
];

export function defaults(): Settings {
  return {
    ntfy_server: config.ntfy.server,
    ntfy_topic: config.ntfy.topic,
    ntfy_token: config.ntfy.token,
    public_url: config.publicUrl,
    log_retention_days: config.logRetentionDays,
    log_max_mb: config.logMaxMb,
    orphan_policy: (process.env.SN_ORPHAN_POLICY as Settings['orphan_policy']) === 'adopt' ? 'adopt' : 'kill',
    timezone: config.timezone,
  };
}

export class SettingsService {
  constructor(private readonly repo: Repo) {}

  get(): Settings {
    const s = defaults();
    for (const k of SETTING_KEYS) {
      const v = this.repo.getSetting(k);
      if (v === null) continue;
      if (k === 'log_retention_days' || k === 'log_max_mb') (s as unknown as Record<string, unknown>)[k] = Number(v);
      else (s as unknown as Record<string, unknown>)[k] = v;
    }
    return s;
  }

  /** Vue publique : le jeton ntfy n'est jamais renvoyé en clair. */
  getPublic(): Omit<Settings, 'ntfy_token'> & { ntfy_token_set: boolean } {
    const { ntfy_token, ...rest } = this.get();
    return { ...rest, ntfy_token_set: !!ntfy_token };
  }

  update(patch: Partial<Record<keyof Settings, string | number | null>>): Settings {
    for (const k of SETTING_KEYS) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (v === null || v === undefined) this.repo.deleteSetting(k);
      else this.repo.setSetting(k, String(v));
    }
    return this.get();
  }
}
