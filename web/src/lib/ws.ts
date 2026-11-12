// Websocket temps réel : reconnexion automatique, abonnements par run, diffusion typée.
import { ref } from 'vue';

export type WsMessage = { type: string } & Record<string, unknown>;
type Listener = (m: WsMessage) => void;

const listeners = new Set<Listener>();
const subscriptions = new Set<string>();
let socket: WebSocket | null = null;
let retryDelay = 1000;
let wantOpen = false;
let pingTimer: number | null = null;

export const wsConnected = ref(false);

function url(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api/ws`;
}

export function connectWs(): void {
  wantOpen = true;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  socket = new WebSocket(url());
  socket.onopen = () => {
    wsConnected.value = true;
    retryDelay = 1000;
    for (const id of subscriptions) socket!.send(JSON.stringify({ op: 'subscribe', runId: id }));
    pingTimer = window.setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ op: 'ping' })), 25_000);
  };
  socket.onmessage = (ev) => {
    let m: WsMessage;
    try {
      m = JSON.parse(ev.data as string) as WsMessage;
    } catch {
      return;
    }
    for (const l of listeners) l(m);
  };
  socket.onclose = () => {
    wsConnected.value = false;
    if (pingTimer) clearInterval(pingTimer);
    socket = null;
    if (wantOpen) {
      setTimeout(connectWs, retryDelay);
      retryDelay = Math.min(15_000, retryDelay * 1.8);
    }
  };
  socket.onerror = () => socket?.close();
}

export function disconnectWs(): void {
  wantOpen = false;
  socket?.close();
}

export function onWs(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function subscribeRun(runId: string): () => void {
  subscriptions.add(runId);
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 'subscribe', runId }));
  return () => {
    subscriptions.delete(runId);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 'unsubscribe', runId }));
  };
}
