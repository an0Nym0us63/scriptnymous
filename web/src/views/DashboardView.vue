<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Plus, RefreshCw, Search, Activity, CheckCircle2, XCircle, Layers } from 'lucide-vue-next';
import { useScripts } from '@/stores/scripts';
import { useApp } from '@/stores/app';
import { api, type ScriptItem } from '@/lib/api';
import { duration } from '@/lib/format';
import ScriptCard from '@/components/ScriptCard.vue';
import LaunchModal from '@/components/LaunchModal.vue';
import EmptyState from '@/components/EmptyState.vue';

const scripts = useScripts();
const app = useApp();
const query = ref('');
const launching = ref<ScriptItem | null>(null);
const now = ref(Date.now());
let tick: number;
onMounted(() => {
  tick = window.setInterval(() => (now.value = Date.now()), 1000);
  if (!scripts.loaded) void scripts.load();
});
onBeforeUnmount(() => clearInterval(tick));

const groups = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return scripts.groups;
  return scripts.groups
    .map(([g, list]) => [g, list.filter((s) => `${s.name} ${s.slug} ${s.spec.description} ${g}`.toLowerCase().includes(q))] as [string, ScriptItem[]])
    .filter(([, list]) => list.length);
});

function onLaunch(s: ScriptItem): void {
  if (s.spec.params.length) launching.value = s;
  else void quickLaunch(s);
}
async function quickLaunch(s: ScriptItem): Promise<void> {
  try {
    const r = await api.post<{ outcome: string; reason?: string }>(`/api/scripts/${s.slug}/run`, { params: {} });
    if (r.outcome === 'started') app.toast('ok', `${s.name} lancé`);
    else if (r.outcome === 'queued') app.toast('info', `${s.name} mis en file`);
    else app.toast('warn', `${s.name} : ${r.reason ?? r.outcome}`);
  } catch (e) {
    app.toast('err', 'Lancement refusé', (e as Error).message);
  }
}
async function stop(runId: string): Promise<void> {
  try {
    await api.post(`/api/runs/${runId}/stop`);
    app.toast('info', 'Arrêt demandé');
  } catch (e) {
    app.toast('err', 'Arrêt impossible', (e as Error).message);
  }
}
async function reload(): Promise<void> {
  await api.post('/api/scripts/reload');
  await scripts.load();
  app.toast('ok', 'Dossier relu');
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
        <p class="text-sm text-muted">{{ scripts.items.length }} script{{ scripts.items.length > 1 ? 's' : '' }} · {{ scripts.groups.length }} groupe{{ scripts.groups.length > 1 ? 's' : '' }}</p>
      </div>
      <span class="flex-1" />
      <div class="relative">
        <Search class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input v-model="query" class="input pl-9 w-56" placeholder="Rechercher…" />
      </div>
      <button class="btn-soft" title="Relire le dossier des scripts" @click="reload"><RefreshCw class="h-4 w-4" :class="scripts.loading && 'animate-spin'" /></button>
      <RouterLink to="/scripts/new" class="btn-primary md:hidden"><Plus class="h-4 w-4" /></RouterLink>
    </div>

    <!-- Indicateurs -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      <div class="card p-4 flex items-center gap-3">
        <div class="h-10 w-10 rounded-xl bg-accent-soft text-accent-2 flex items-center justify-center"><Activity class="h-5 w-5" /></div>
        <div><div class="text-2xl font-semibold leading-none">{{ scripts.stats.running }}</div><div class="text-xs text-muted mt-1">en cours</div></div>
      </div>
      <div class="card p-4 flex items-center gap-3">
        <div class="h-10 w-10 rounded-xl bg-ok-soft text-ok flex items-center justify-center"><CheckCircle2 class="h-5 w-5" /></div>
        <div><div class="text-2xl font-semibold leading-none">{{ scripts.stats.success24h }}</div><div class="text-xs text-muted mt-1">succès · 24 h</div></div>
      </div>
      <div class="card p-4 flex items-center gap-3">
        <div class="h-10 w-10 rounded-xl bg-err-soft text-err flex items-center justify-center"><XCircle class="h-5 w-5" /></div>
        <div><div class="text-2xl font-semibold leading-none">{{ scripts.stats.failed24h }}</div><div class="text-xs text-muted mt-1">échecs · 24 h</div></div>
      </div>
      <div class="card p-4 flex items-center gap-3">
        <div class="h-10 w-10 rounded-xl bg-info-soft text-info flex items-center justify-center"><Layers class="h-5 w-5" /></div>
        <div><div class="text-2xl font-semibold leading-none">{{ scripts.stats.total }}</div><div class="text-xs text-muted mt-1">runs au total</div></div>
      </div>
    </div>

    <!-- En cours -->
    <div v-if="scripts.running.length" class="mb-6">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-muted mb-2">En cours</h2>
      <div class="flex flex-wrap gap-2">
        <RouterLink v-for="r in scripts.running" :key="r.id" :to="`/runs/${r.id}`" class="chip bg-accent-soft text-accent-2 border border-accent/30 px-3 py-1.5 hover:brightness-110">
          <span class="h-1.5 w-1.5 rounded-full bg-current live-dot" /> {{ r.script.name }} · {{ duration(r.started_at, null, now) }}
        </RouterLink>
      </div>
    </div>

    <EmptyState v-if="scripts.loaded && !scripts.items.length" title="Aucun script pour l'instant" text="Déposez un dossier contenant un script.yaml dans le partage des scripts, ou créez-en un depuis l'interface.">
      <template #icon><Plus class="h-6 w-6" /></template>
      <RouterLink to="/scripts/new" class="btn-primary"><Plus class="h-4 w-4" /> Créer un script</RouterLink>
    </EmptyState>

    <section v-for="[group, list] in groups" :key="group" class="mb-8">
      <h2 class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted mb-3">
        {{ group }} <span class="text-[10px] font-normal normal-case tracking-normal bg-surface-2 rounded-full px-2 py-0.5">{{ list.length }}</span>
      </h2>
      <div class="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <ScriptCard v-for="s in list" :key="s.slug" :script="s" :now="now" @launch="onLaunch" @stop="stop" />
      </div>
    </section>

    <LaunchModal v-if="launching" :script="launching" @close="launching = null" />
  </div>
</template>
