<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, Square, RotateCcw, Trash2, Clock, Hash, Cpu, GitBranch } from 'lucide-vue-next';
import { api, type Run } from '@/lib/api';
import { onWs } from '@/lib/ws';
import { useApp } from '@/stores/app';
import { duration, fmtDate, TRIGGER } from '@/lib/format';
import StatusBadge from '@/components/StatusBadge.vue';
import LogViewer from '@/components/LogViewer.vue';
import DepSuggestions, { type Suggestion } from '@/components/DepSuggestions.vue';
import type { ScriptDetail } from '@/lib/api';

const route = useRoute();
const router = useRouter();
const app = useApp();
const run = ref<Run | null>(null);
const error = ref('');
const now = ref(Date.now());
let tick: number;
let unsub: (() => void) | null = null;

const id = computed(() => route.params.id as string);
// Journal d'un run échoué, pour proposer les dépendances manquantes.
const failLog = ref<string | null>(null);
const scriptDeps = ref<{ pip: string[]; npm: string[]; apt: string[] }>({ pip: [], npm: [], apt: [] });
const scriptInterpreter = ref<string | undefined>();
watch(
  () => run.value?.status,
  async (st) => {
    if (st !== 'failed') return void (failLog.value = null);
    try {
      const [log, script] = await Promise.all([
        api.get<{ text: string }>(`/api/runs/${id.value}/log?tail=1&max=65536`),
        api.get<ScriptDetail>(`/api/scripts/${encodeURIComponent(run.value!.script_slug)}`),
      ]);
      scriptDeps.value = { pip: script.spec.deps.pip, npm: script.spec.deps.npm, apt: script.spec.deps.apt };
      scriptInterpreter.value = script.spec.interpreter;
      failLog.value = log.text;
    } catch {
      failLog.value = null;
    }
  },
  { immediate: true },
);
async function addDeps(list: Suggestion[]): Promise<void> {
  if (!run.value) return;
  try {
    const slug = run.value.script_slug;
    const script = await api.get<ScriptDetail>(`/api/scripts/${encodeURIComponent(slug)}`);
    const deps = { ...script.spec.deps };
    for (const sg of list) if (!deps[sg.kind].includes(sg.package)) deps[sg.kind] = [...deps[sg.kind], sg.package];
    await api.put(`/api/scripts/${encodeURIComponent(slug)}`, { spec: { ...script.spec, deps }, code: null });
    app.toast('ok', 'Dépendances ajoutées', 'L’environnement se prépare ; relancez le script quand il est prêt.', `/scripts/${slug}?tab=env`);
    scriptDeps.value = { pip: deps.pip, npm: deps.npm, apt: deps.apt };
  } catch (e) {
    app.toast('err', 'Ajout impossible', (e as Error).message);
  }
}
const params = computed(() => {
  try {
    return Object.entries(JSON.parse(run.value?.params_json || '{}') as Record<string, unknown>);
  } catch {
    return [];
  }
});

async function load(): Promise<void> {
  try {
    run.value = (await api.get<{ run: Run }>(`/api/runs/${id.value}`)).run;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => {
  void load();
  tick = window.setInterval(() => (now.value = Date.now()), 1000);
  unsub = onWs((m) => {
    if ((m.type === 'run:finished' || m.type === 'run:started' || m.type === 'run:updated') && (m.run as Run).id === id.value) run.value = m.run as Run;
  });
});
watch(id, () => void load());
onBeforeUnmount(() => {
  clearInterval(tick);
  unsub?.();
});

async function stop(): Promise<void> {
  try {
    await api.post(`/api/runs/${id.value}/stop`);
    app.toast('info', 'Arrêt demandé', 'SIGTERM envoyé, SIGKILL après le délai de grâce.');
  } catch (e) {
    app.toast('err', 'Arrêt impossible', (e as Error).message);
  }
}
async function relaunch(): Promise<void> {
  if (!run.value) return;
  try {
    const p = JSON.parse(run.value.params_json || '{}') as Record<string, unknown>;
    for (const k of Object.keys(p)) if (p[k] === '••••••') delete p[k];
    const r = await api.post<{ outcome: string; run?: Run; reason?: string }>(`/api/scripts/${encodeURIComponent(run.value.script_slug)}/run`, { params: p });
    if (r.outcome === 'started' && r.run) void router.push(`/runs/${r.run.id}`);
    else app.toast('warn', r.reason ?? r.outcome);
  } catch (e) {
    app.toast('err', 'Relance refusée', (e as Error).message);
  }
}
async function remove(): Promise<void> {
  if (!confirm('Supprimer ce run et son journal ?')) return;
  await api.del(`/api/runs/${id.value}`);
  void router.push('/runs');
}
</script>

<template>
  <div v-if="run">
    <div class="flex flex-wrap items-center gap-3 mb-5">
      <button class="btn-icon btn-ghost" @click="router.back()"><ArrowLeft class="h-4 w-4" /></button>
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <RouterLink :to="`/scripts/${run.script_slug}`" class="text-xl font-semibold tracking-tight hover:underline truncate">{{ run.script_name }}</RouterLink>
          <StatusBadge :status="run.status" />
        </div>
        <div class="text-xs text-muted font-mono">{{ run.id }}</div>
      </div>
      <span class="flex-1" />
      <button v-if="run.status === 'running'" class="btn-danger" @click="stop"><Square class="h-4 w-4" /> Arrêter</button>
      <template v-else>
        <button class="btn-soft" @click="relaunch"><RotateCcw class="h-4 w-4" /> Relancer</button>
        <button class="btn-icon btn-ghost text-muted hover:text-err" title="Supprimer" @click="remove"><Trash2 class="h-4 w-4" /></button>
      </template>
    </div>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-5 text-sm">
      <div class="card p-3"><div class="text-[11px] uppercase tracking-wide text-muted flex items-center gap-1"><Clock class="h-3 w-3" /> Début</div><div class="mt-1">{{ fmtDate(run.started_at ?? run.created_at) }}</div></div>
      <div class="card p-3"><div class="text-[11px] uppercase tracking-wide text-muted">Durée</div><div class="mt-1 font-mono">{{ duration(run.started_at, run.finished_at, now) }}</div></div>
      <div class="card p-3"><div class="text-[11px] uppercase tracking-wide text-muted flex items-center gap-1"><GitBranch class="h-3 w-3" /> Déclencheur</div><div class="mt-1">{{ TRIGGER[run.trigger] ?? run.trigger }} <span v-if="run.max_attempts > 1" class="text-muted">· essai {{ run.attempt }}/{{ run.max_attempts }}</span></div></div>
      <div class="card p-3"><div class="text-[11px] uppercase tracking-wide text-muted flex items-center gap-1"><Hash class="h-3 w-3" /> Code · <Cpu class="h-3 w-3" /> pid</div><div class="mt-1 font-mono">{{ run.exit_code ?? '—' }}<span v-if="run.signal"> ({{ run.signal }})</span> · {{ run.pid ?? '—' }}</div></div>
    </div>

    <div v-if="run.error" class="mb-4 card border-err/40 bg-err-soft px-4 py-3 text-sm text-err">{{ run.error }}</div>
    <div v-if="failLog" class="mb-4">
      <DepSuggestions :interpreter="scriptInterpreter" :log="failLog" :existing="scriptDeps" compact @add="(s) => addDeps([s])" @add-all="addDeps" />
    </div>
    <div v-if="run.parent_run_id" class="mb-4 text-sm text-muted">Nouvel essai du run <RouterLink :to="`/runs/${run.parent_run_id}`" class="font-mono text-accent-2 hover:underline">{{ run.parent_run_id }}</RouterLink>.</div>

    <div v-if="params.length" class="mb-4 flex flex-wrap gap-2">
      <span v-for="[k, v] in params" :key="k" class="chip bg-surface-2 text-text-2 border border-border font-mono"><span class="text-muted">{{ k }}=</span>{{ Array.isArray(v) ? v.join(',') : v }}</span>
    </div>

    <LogViewer v-if="run.status !== 'skipped'" :key="run.id" :run-id="run.id" :live="run.status === 'running'" />
    <div v-else class="card p-6 text-sm text-muted">Ce lancement a été ignoré : aucune sortie.</div>
  </div>
  <div v-else-if="error" class="card p-6 text-err">{{ error }}</div>
</template>
