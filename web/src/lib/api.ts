// Client HTTP minimal : JSON, erreurs lisibles, redirection vers la connexion sur 401.
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { ...init, method, headers, body: payload, credentials: 'same-origin' });
  if (res.status === 401 && !url.endsWith('/auth/login') && !url.endsWith('/auth/status')) {
    onUnauthorized?.();
    throw new ApiError('Session expirée', 401);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `Erreur HTTP ${res.status}`;
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

// ---- Types partagés avec le serveur (sous-ensemble utile à l'interface) ----
export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'killed' | 'timeout' | 'lost' | 'skipped';
export type EnvStatus = 'none' | 'pending' | 'installing' | 'ready' | 'error';

export interface ParamSpec {
  name: string;
  label?: string;
  description?: string;
  type: 'text' | 'number' | 'boolean' | 'choice' | 'multichoice' | 'file' | 'secret';
  required: boolean;
  default?: unknown;
  choices?: (string | number)[];
  pass: 'positional' | 'option' | 'env';
  as?: string;
  min?: number;
  max?: number;
  placeholder?: string;
}
export interface ScheduleSpec {
  id?: string;
  name?: string;
  cron: string;
  timezone?: string;
  enabled: boolean;
  jitter_seconds: number;
  window?: string;
  exclude_days: string[];
  catch_up: boolean;
  params: Record<string, unknown>;
}
export interface ScriptSpec {
  name: string;
  description: string;
  group?: string;
  icon: string;
  color: string;
  interpreter?: 'bash' | 'sh' | 'python3' | 'node';
  command?: string;
  file: string;
  workdir?: string;
  env: Record<string, string>;
  timeout_seconds: number;
  params: ParamSpec[];
  concurrency: 'skip' | 'queue' | 'kill' | 'parallel';
  retry: { attempts: number; delay_seconds: number; factor: number; max_delay_seconds: number; retry_on: number[]; no_retry_on: number[] };
  schedules: ScheduleSpec[];
  notify: { topic?: string; server?: string; token?: string; events: string[]; priority: number; tags: string[] };
  deps: { apt: string[]; pip: string[]; npm: string[]; bin: { name: string; url: string; sha256?: string }[] };
  enabled: boolean;
}
export interface RunSummary {
  id: string;
  status: RunStatus;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  trigger: string;
}
export interface ScriptItem {
  slug: string;
  name: string;
  group: string | null;
  status: 'ok' | 'invalid' | 'missing';
  spec_error: string | null;
  env_status: EnvStatus;
  env_updated_at: string | null;
  missing_since: string | null;
  spec: ScriptSpec;
  last_run: RunSummary | null;
  running: { id: string; started_at: string | null }[];
  next_runs: { scheduleId: string; nextAt: string }[];
  queued: number;
}
export interface ScriptDetail extends ScriptItem {
  yaml: string | null;
  code: string | null;
  env_log: string | null;
  env_fingerprint: string | null;
  queue: QueueItem[];
}
export interface QueueItem {
  id: string;
  script_slug: string;
  trigger: string;
  schedule_id: string | null;
  params_json: string;
  attempt: number;
  not_before: string | null;
  created_at: string;
}
export interface Run {
  id: string;
  script_slug: string;
  script_name: string;
  trigger: string;
  schedule_id: string | null;
  params_json: string;
  status: RunStatus;
  exit_code: number | null;
  signal: string | null;
  pid: number | null;
  attempt: number;
  max_attempts: number;
  parent_run_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  log_bytes: number;
  error: string | null;
  created_at: string;
}
export interface Settings {
  ntfy_server: string;
  ntfy_topic: string;
  ntfy_token_set: boolean;
  public_url: string;
  log_retention_days: number;
  log_max_mb: number;
  orphan_policy: 'kill' | 'adopt';
  timezone: string;
}
export interface SystemInfo {
  version: string;
  node: string;
  platform: string;
  scriptsDir: string;
  scriptsDirAvailable: boolean;
  dataDir: string;
  logsBytes: number;
  envsBytes: number;
  publicUrlFromEnv: boolean;
}
