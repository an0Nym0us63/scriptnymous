// Bus d'événements interne : relayé vers les websockets et consommé par les notifications.
import { EventEmitter } from 'node:events';
import type { RunRow } from '../db/repo.js';

export interface EventMap {
  'run:created': { run: RunRow };
  'run:started': { run: RunRow };
  'run:output': { runId: string; slug: string; chunk: string; stream: 'stdout' | 'stderr' | 'system' };
  'run:finished': { run: RunRow };
  'run:updated': { run: RunRow };
  'script:changed': { slug: string };
  'scripts:reloaded': { count: number };
  'env:changed': { slug: string; status: string };
  'queue:changed': { slug: string };
  'schedule:armed': { slug: string; scheduleId: string; nextAt: string | null };
  'app:changed': { slug: string; table: string };
}

export type EventName = keyof EventMap;

class TypedBus {
  private readonly ee = new EventEmitter();
  constructor() {
    this.ee.setMaxListeners(200);
  }
  on<K extends EventName>(name: K, fn: (payload: EventMap[K]) => void): () => void {
    this.ee.on(name, fn);
    return () => this.ee.off(name, fn);
  }
  emit<K extends EventName>(name: K, payload: EventMap[K]): void {
    this.ee.emit(name, payload);
    this.ee.emit('*', { name, payload });
  }
  /** Abonnement à tout (websocket). */
  onAny(fn: (e: { name: EventName; payload: unknown }) => void): () => void {
    this.ee.on('*', fn);
    return () => this.ee.off('*', fn);
  }
}

export const bus = new TypedBus();
