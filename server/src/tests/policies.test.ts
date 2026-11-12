import { describe, expect, it } from 'vitest';
import { decideConcurrency } from '../core/concurrency.js';
import { retryDelayMs, shouldRetry } from '../core/retry.js';
import { RetrySchema } from '../core/spec.js';

describe('concurrence', () => {
  it('démarre toujours sans instance en cours', () => {
    for (const p of ['skip', 'queue', 'kill', 'parallel'] as const) expect(decideConcurrency(p, 0)).toBe('start');
  });
  it('applique la politique quand une instance tourne', () => {
    expect(decideConcurrency('skip', 1)).toBe('skip');
    expect(decideConcurrency('queue', 1)).toBe('queue');
    expect(decideConcurrency('kill', 2)).toBe('kill_then_start');
    expect(decideConcurrency('parallel', 3)).toBe('start');
  });
});

describe('retry', () => {
  const r = RetrySchema.parse({ attempts: 3, delay_seconds: 10, factor: 3, max_delay_seconds: 60 });

  it('retente un échec tant qu’il reste des essais', () => {
    expect(shouldRetry(r, 1, 'failed', 1)).toBe(true);
    expect(shouldRetry(r, 2, 'failed', 1)).toBe(true);
    expect(shouldRetry(r, 3, 'failed', 1)).toBe(false);
  });
  it('ne retente ni un succès ni un arrêt manuel, mais un délai dépassé ou une perte oui', () => {
    expect(shouldRetry(r, 1, 'success', 0)).toBe(false);
    expect(shouldRetry(r, 1, 'killed', null)).toBe(false);
    expect(shouldRetry(r, 1, 'timeout', null)).toBe(true);
    expect(shouldRetry(r, 1, 'lost', null)).toBe(true);
  });
  it('filtre par code de sortie', () => {
    const only = RetrySchema.parse({ attempts: 2, retry_on: [75] });
    expect(shouldRetry(only, 1, 'failed', 75)).toBe(true);
    expect(shouldRetry(only, 1, 'failed', 1)).toBe(false);
    const except = RetrySchema.parse({ attempts: 2, no_retry_on: [2] });
    expect(shouldRetry(except, 1, 'failed', 2)).toBe(false);
    expect(shouldRetry(except, 1, 'failed', 3)).toBe(true);
  });
  it('calcule un délai exponentiel plafonné', () => {
    expect(retryDelayMs(r, 2)).toBe(10_000);
    expect(retryDelayMs(r, 3)).toBe(30_000);
    expect(retryDelayMs(r, 4)).toBe(60_000);
  });
});
