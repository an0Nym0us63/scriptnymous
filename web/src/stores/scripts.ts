// Liste des scripts : chargée une fois, rafraîchie sur les événements websocket (sans tempête de requêtes).
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, type ScriptItem } from '@/lib/api';
import { onWs } from '@/lib/ws';
import { useApp } from './app';

export const useScripts = defineStore('scripts', () => {
  const items = ref<ScriptItem[]>([]);
  const dirAvailable = ref(true);
  const stats = ref({ total: 0, running: 0, failed24h: 0, success24h: 0 });
  const loaded = ref(false);
  const loading = ref(false);
  let timer: number | null = null;
  let wsBound = false;

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const r = await api.get<{ scripts: ScriptItem[]; scriptsDirAvailable: boolean; stats: typeof stats.value }>('/api/scripts');
      items.value = r.scripts;
      dirAvailable.value = r.scriptsDirAvailable;
      stats.value = r.stats;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  /** Rechargement regroupé (plusieurs événements proches → une requête). */
  function scheduleReload(delay = 250): void {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => void load().catch(() => {}), delay);
  }

  const envSeen = new Map<string, string>();
  function bindWs(): void {
    if (wsBound) return;
    wsBound = true;
    const app = useApp();
    onWs((m) => {
      if (m.type === 'env:changed') {
        const slug = m.slug as string;
        const status = m.status as string;
        const prev = envSeen.get(slug);
        envSeen.set(slug, status);
        const name = bySlug(slug)?.name ?? slug;
        if (prev && prev !== status) {
          if (status === 'ready') app.toast('ok', `${name} : environnement prêt`, 'Le script peut être lancé.', `/scripts/${slug}`);
          else if (status === 'error') app.toast('err', `${name} : environnement en erreur`, 'Voir le journal d’installation.', `/scripts/${slug}?tab=env`);
        }
      }
      switch (m.type) {
        case 'run:created':
        case 'run:started':
        case 'run:finished':
        case 'run:updated':
        case 'script:changed':
        case 'env:changed':
        case 'queue:changed':
        case 'schedule:armed':
        case 'app:changed':
        case 'scripts:reloaded':
          scheduleReload();
          break;
      }
      if (m.type === 'run:finished') {
        const run = m.run as { status: string; script_name: string; id: string; trigger: string };
        if (run.status === 'failed' || run.status === 'timeout' || run.status === 'lost')
          app.toast('err', `${run.script_name} : échec`, `Statut ${run.status}`, `/runs/${run.id}`);
        else if (run.status === 'success' && run.trigger !== 'manual') app.toast('ok', `${run.script_name} : terminé`, undefined, `/runs/${run.id}`);
      }
    });
  }

  const groups = computed(() => {
    const map = new Map<string, ScriptItem[]>();
    for (const s of items.value) {
      const g = s.group || 'Sans groupe';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return [...map.entries()].sort((a, b) => (a[0] === 'Sans groupe' ? 1 : b[0] === 'Sans groupe' ? -1 : a[0].localeCompare(b[0])));
  });
  const running = computed(() => items.value.flatMap((s) => s.running.map((r) => ({ ...r, script: s }))));
  const installing = computed(() => items.value.filter((s) => s.env_status === 'installing' || s.env_status === 'pending'));
  const queuedCount = computed(() => items.value.reduce((n, s) => n + s.queued, 0));
  const activityCount = computed(() => running.value.length + installing.value.length + queuedCount.value);
  const bySlug = (slug: string) => items.value.find((s) => s.slug === slug);

  return { items, dirAvailable, stats, loaded, loading, load, scheduleReload, bindWs, groups, running, installing, queuedCount, activityCount, bySlug };
});
