// Politique de concurrence : décision pure, testée isolément.
import type { ConcurrencyPolicy } from './spec.js';

export type ConcurrencyDecision = 'start' | 'skip' | 'queue' | 'kill_then_start';

export function decideConcurrency(policy: ConcurrencyPolicy, runningCount: number): ConcurrencyDecision {
  if (runningCount <= 0) return 'start';
  switch (policy) {
    case 'parallel':
      return 'start';
    case 'skip':
      return 'skip';
    case 'queue':
      return 'queue';
    case 'kill':
      return 'kill_then_start';
  }
}
