// Websocket : diffusion des événements (états, sortie en direct). Le client s'abonne à un run pour recevoir sa sortie.
import type { FastifyInstance } from 'fastify';
import { bus, type EventName } from '../core/events.js';

type WebSocketLike = { readyState: number; OPEN: number; send: (d: string) => void; on: (ev: string, fn: (...a: never[]) => void) => void };

interface Client {
  ws: WebSocketLike;
  runs: Set<string>; // runs dont on veut la sortie
  all: boolean; // toute la sortie (vue « console »)
}

export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  const clients = new Set<Client>();

  const send = (c: Client, msg: unknown) => {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  };

  bus.onAny(({ name, payload }) => {
    const n = name as EventName;
    for (const c of clients) {
      if (n === 'run:output') {
        const p = payload as { runId: string };
        if (!c.all && !c.runs.has(p.runId)) continue;
      }
      send(c, { type: n, ...((payload as object) ?? {}) });
    }
  });

  app.get('/api/ws', { websocket: true }, (socket) => {
    const client: Client = { ws: socket as unknown as WebSocketLike, runs: new Set(), all: false };
    clients.add(client);
    send(client, { type: 'hello', running: app.services.repo.runningRuns().map((r) => r.id) });
    socket.on('message', (raw: Buffer | string) => {
      let msg: { op?: string; runId?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.op === 'subscribe' && msg.runId) client.runs.add(msg.runId);
      else if (msg.op === 'unsubscribe' && msg.runId) client.runs.delete(msg.runId);
      else if (msg.op === 'subscribe_all') client.all = true;
      else if (msg.op === 'ping') send(client, { type: 'pong' });
    });
    socket.on('close', () => clients.delete(client));
    socket.on('error', () => clients.delete(client));
  });
}
