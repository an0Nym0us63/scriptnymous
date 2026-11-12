// Politique de retry : décisions pures.
import type { RetrySpec } from './spec.js';
import type { RunStatus } from '../db/repo.js';

/** Un nouvel essai est-il dû après ce résultat ? */
export function shouldRetry(retry: RetrySpec, attempt: number, status: RunStatus, exitCode: number | null): boolean {
  if (attempt >= retry.attempts) return false;
  // Un arrêt demandé par l'utilisateur n'est jamais retenté ; un délai dépassé ou une perte le sont.
  if (status === 'killed' || status === 'success' || status === 'skipped') return false;
  if (status === 'timeout' || status === 'lost') return true;
  if (exitCode === null) return true;
  if (retry.no_retry_on.includes(exitCode)) return false;
  if (retry.retry_on.length > 0) return retry.retry_on.includes(exitCode);
  return exitCode !== 0;
}

/** Délai avant l'essai `nextAttempt` (≥ 2) : délai initial × facteur^(n-2), plafonné. */
export function retryDelayMs(retry: RetrySpec, nextAttempt: number): number {
  const exp = Math.max(0, nextAttempt - 2);
  const secs = Math.min(retry.max_delay_seconds, retry.delay_seconds * Math.pow(retry.factor, exp));
  return Math.round(secs * 1000);
}
