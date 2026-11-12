<script setup lang="ts">
// Page d'un script : aperçu + lancement, historique, planifications, environnement, code et YAML en lecture.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Play, Square, Pencil, Trash2, RefreshCw, Clock, Package, FileCode2, History as HistoryIcon, Bell, Settings2, AlertTriangle } from 'lucide-vue-next';
import { api, type ScriptDetail, type Run } from '@/lib/api';
import { onWs } from '@/lib/ws';
import { useApp } from '@/stores/app';
import { useScripts } from '@/stores/scripts';
import { CONCURRENCY, describeCron, duration, ENV_STATUS, fmtDateShort, NOTIFY_EVENTS, relative, toneClasses, TRIGGER } from '@/lib/format';
import AppIcon from '@/components/AppIcon.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import ParamForm from '@/components/ParamForm.vue';
import CodeEditor from '@/components/CodeEditor.vue';
import AppPanel from '@/components/AppPanel.vue';
import { LayoutPanelTop } from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();
const app = useApp();
const scripts = useScripts();
const slug = computed(() => route.params.slug as string);
const script = ref<ScriptDetail | null>(null);
const runs = ref<Run[]>([]);
const values = ref<Record<string, unknown>>({});
const busy = ref(false);
const now = ref(Date.now());
const tab = ref<string>((route.query.tab as string) || 'overview');
const appPageUrl = computed(() => (script.value?.spec.app?.page ? `/api/scripts/${encodeURIComponent(slug.value)}/app/page/?theme=${app.theme}&slug=${encodeURIComponent(slug.value)}` : null));
let tick: number;
let unsub: (() => void) | null = null;
let reloadTimer: number | null = null;

const tabs = computed(() => [
  ...(script.value?.spec.app ? [{ id: 'app', label: script.value.spec.app.title || 'Suivi', icon: LayoutPanelTop }] : []),
  { id: 'overview', label: 'Aperçu', icon: Play },
  { id: 'history', label: 'Historique', icon: HistoryIcon },
  { id: 'schedules', label: 'Planifications', icon: Clock },
  { id: 'env', label: 'Environnement', icon: Package },
  { id: 'notify', label: 'Notifications', icon: Bell },
  { id: 'code', label: 'Code & YAML', icon: FileCode2 },
]);

async function load(): Promise<void> {
  script.value = await api.get<ScriptDetail>(`/api/scripts/${encodeURIComponent(slug.value)}`);
  // Un script avec mini-app s'ouvre sur son onglet Suivi.
  if (!route.query.tab && script.value.spec.app && tab.value === 'overview') tab.value = 'app';
  runs.value = (await api.get<{ runs: Run[] }>(`/api/runs?slug=${slug.value}&limit=20`)).runs;
}
function scheduleReload(): void {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(() => void load().catch(() => {}), 250);
}
onMounted(() => {
  void load();
  tick = window.setInterval(() => (now.value = Date.now()), 1000);
  unsub = onWs((m) => {
    if (m.type === 'run:output') return;
    if ((m.slug && m.slug === slug.value) || ((m.run as Run | undefined)?.script_slug === slug.value)) scheduleReload();
  });
});
watch(slug, () => void load());
watch(tab, (t) => void router.replace({ query: { ...route.query, tab: t } }));
onBeforeUnmount(() => {
  clearInterval(tick);
  unsub?.();
});

const running = computed(() => script.value?.running ?? []);
const blocked = computed(() => !script.value || script.value.status !== 'ok' || (script.value.env_status !== 'none' && script.value.env_status !== 'ready'));
const lang = computed(() => {
  const i = script.value?.spec.interpreter;
  return i === 'python3' ? 'python' : i === 'node' ? 'javascript' : i ? 'bash' : 'text';
});
const concurrency = computed(() => CONCURRENCY[script.value?.spec.concurrency ?? 'skip']);
const nextBySchedule = computed(() => Object.fromEntries((script.value?.next_runs ?? []).map((n) => [n.scheduleId, n.nextAt])));

async function launch(): Promise<void> {
  if (!script.value) return;
  busy.value = true;
  try {
    const hasFile = Object.values(values.value).some((v) => v instanceof File);
    let body: unknown = { params: values.value };
    if (hasFile) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(values.value)) {
        if (v instanceof File) fd.append(k, v, v.name);
        else if (Array.isArray(v)) fd.append(k, JSON.stringify(v));
        else if (v !== undefined && v !== null) fd.append(k, String(v));
      }
      body = fd;
    }
    const r = await api.post<{ outcome: string; run?: Run; reason?: string }>(`/api/scripts/${encodeURIComponent(slug.value)}/run`, body);
    if (r.outcome === 'started' && r.run) void router.push(`/runs/${r.run.id}`);
    else if (r.outcome === 'queued') app.toast('info', 'Mis en file', 'Une instance tourne encore.');
    else app.toast('warn', 'Lancement ignoré', r.reason);
  } catch (e) {
    app.toast('err', 'Lancement refusé', (e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function stop(id: string): Promise<void> {
  try {
    await api.post(`/api/runs/${id}/stop`);
  } catch (e) {
    app.toast('err', 'Arrêt impossible', (e as Error).message);
  }
}
async function rebuildEnv(): Promise<void> {
  await api.post(`/api/scripts/${encodeURIComponent(slug.value)}/env/rebuild`);
  app.toast('info', 'Reconstruction de l’environnement lancée');
}
async function toggleEnabled(): Promise<void> {
  if (!script.value) return;
  await api.put(`/api/scripts/${encodeURIComponent(slug.value)}`, { spec: { ...script.value.spec, enabled: !script.value.spec.enabled }, code: null });
  await load();
}
async function toggleSchedule(id: string): Promise<void> {
  if (!script.value) return;
  const spec = { ...script.value.spec, schedules: script.value.spec.schedules.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)) };
  await api.put(`/api/scripts/${encodeURIComponent(slug.value)}`, { spec, code: null });
  await load();
}
async function remove(): Promise<void> {
  if (!confirm(`Supprimer définitivement le script « ${script.value?.name} » et son dossier ? Les runs passés sont conservés.`)) return;
  try {
    await api.del(`/api/scripts/${encodeURIComponent(slug.value)}`);
    await scripts.load();
    void router.push('/');
  } catch (e) {
    app.toast('err', 'Suppression impossible', (e as Error).message);
  }
}
async function clearQueue(): Promise<void> {
  await api.del(`/api/scripts/${encodeURIComponent(slug.value)}/queue`);
  await load();
}
/** Efface l'historique des runs de ce script (tout, ou seulement les échecs) : journaux compris, runs en cours conservés. */
async function purgeHistory(failedOnly: boolean): Promise<void> {
  const what = failedOnly ? 'les échecs' : 'tout l’historique';
  if (!confirm(`Effacer ${what} de « ${script.value?.name} » ? Les journaux correspondants sont supprimés, les runs en cours conservés.`)) return;
  try {
    const r = await api.del<{ removed: number }>(`/api/runs?slug=${encodeURIComponent(slug.value)}${failedOnly ? '&status=failed' : ''}`);
    app.toast('ok', 'Historique effacé', `${r.removed} run(s) supprimé(s)`);
    await load();
  } catch (e) {
    app.toast('err', 'Effacement impossible', (e as Error).message);
  }
}
const appKey = ref(0);
/** Vide les tables de la mini-app (les fichiers de données sont conservés). */
async function resetAppData(): Promise<void> {
  const tables = Object.keys(script.value?.spec.app?.tables ?? {});
  if (!confirm(`Remettre à zéro les données de « ${script.value?.spec.app?.title || script.value?.name} » ?\nTables vidées : ${tables.join(', ')}.\nLes fichiers (vignettes, captures…) sont conservés ; le script repartira comme au premier passage.`)) return;
  try {
    const r = await api.del<{ tables: Record<string, number> }>(`/api/scripts/${encodeURIComponent(slug.value)}/app`);
    const n = Object.values(r.tables).reduce((a, b) => a + b, 0);
    app.toast('ok', 'Données remises à zéro', `${n} ligne(s) supprimée(s)`);
    appKey.value++;
    await load();
  } catch (e) {
    app.toast('err', 'Remise à zéro impossible', (e as Error).message);
  }
}
</script>

<template>
  <div v-if="script">
    <!-- En-tête -->
    <div class="card relative overflow-hidden p-5 mb-5">
      <div class="absolute inset-0 opacity-[0.12] pointer-events-none" :style="{ background: `radial-gradient(600px 200px at 0% 0%, ${script.spec.color}, transparent 70%)` }" />
      <div class="relative flex flex-wrap items-start gap-4">
        <div class="h-14 w-14 rounded-2xl flex items-center justify-center text-white shrink-0" :style="{ background: script.spec.color }"><AppIcon :name="script.spec.icon" :size="26" /></div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-2xl font-semibold tracking-tight">{{ script.name }}</h1>
            <span v-if="script.group" class="chip bg-surface-2 text-text-2 border border-border">{{ script.group }}</span>
            <span v-if="!script.spec.enabled" class="chip bg-warn-soft text-warn">désactivé</span>
            <span v-if="script.status === 'missing'" class="chip bg-err-soft text-err"><AlertTriangle class="h-3 w-3" /> introuvable depuis {{ relative(script.missing_since, now) }}</span>
            <span v-if="script.status === 'invalid'" class="chip bg-err-soft text-err"><AlertTriangle class="h-3 w-3" /> déclaration invalide</span>
          </div>
          <p class="text-sm text-text-2 mt-1">{{ script.spec.description || 'Aucune description.' }}</p>
          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted font-mono">
            <span>{{ script.slug }}/{{ script.spec.file }}</span>
            <span>{{ script.spec.command || script.spec.interpreter }}</span>
            <span v-if="script.spec.timeout_seconds">délai max {{ script.spec.timeout_seconds }} s</span>
            <span :title="concurrency.help">{{ concurrency.label }}</span>
            <span v-if="script.spec.retry.attempts > 1">{{ script.spec.retry.attempts }} essais</span>
          </div>
          <p v-if="script.spec_error" class="mt-2 text-sm text-err">{{ script.spec_error }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button v-if="running.length" class="btn-danger" @click="stop(running[0].id)"><Square class="h-4 w-4" /> Arrêter</button>
          <RouterLink :to="`/scripts/${script.slug}/edit`" class="btn-soft"><Pencil class="h-4 w-4" /> Modifier</RouterLink>
          <button class="btn-icon btn-ghost text-muted hover:text-err" title="Supprimer" @click="remove"><Trash2 class="h-4 w-4" /></button>
        </div>
      </div>
    </div>

    <!-- Onglets -->
    <div class="flex gap-1 overflow-x-auto mb-5 -mx-4 px-4 md:mx-0 md:px-0">
      <button v-for="t in tabs" :key="t.id" class="btn whitespace-nowrap" :class="tab === t.id ? 'bg-accent-soft text-accent-2' : 'text-text-2 hover:bg-surface-2'" @click="tab = t.id">
        <component :is="t.icon" class="h-4 w-4" /> {{ t.label }}
      </button>
    </div>

    <!-- Mini-app / Suivi -->
    <div v-if="tab === 'app' && script.spec.app">
      <iframe v-if="appPageUrl" :key="appKey" :src="appPageUrl" class="w-full rounded-2xl border border-border bg-bg-elev" style="height: 75vh" title="Sous-app du script" />
      <AppPanel v-else :key="appKey" :slug="script.slug" :app="script.spec.app" />
      <div class="mt-3 flex items-center justify-end gap-3 text-xs text-muted">
        <span>{{ Object.keys(script.spec.app.tables).length }} table(s) de suivi</span>
        <button type="button" class="btn-soft text-err" @click="resetAppData"><Trash2 class="h-4 w-4" /> Remettre à zéro les données</button>
      </div>
    </div>

    <!-- Aperçu -->
    <div v-else-if="tab === 'overview'" class="grid gap-5 lg:grid-cols-5">
      <div class="lg:col-span-3 card p-5">
        <h2 class="font-semibold mb-4 flex items-center gap-2"><Play class="h-4 w-4 text-accent-2" /> Lancer</h2>
        <form @submit.prevent="launch">
          <ParamForm v-model="values" :params="script.spec.params" compact />
          <div class="mt-5 flex items-center gap-3">
            <button class="btn-primary" :disabled="busy || blocked"><Play class="h-4 w-4" /> Lancer maintenant</button>
            <span v-if="blocked && script.status === 'ok'" class="text-xs text-warn">Environnement non prêt ({{ ENV_STATUS[script.env_status].label }}).</span>
            <span v-else-if="blocked" class="text-xs text-err">Le script ne peut pas être lancé dans son état actuel.</span>
            <span v-else-if="running.length" class="text-xs text-muted">Une instance tourne : politique « {{ concurrency.label }} ».</span>
          </div>
        </form>
      </div>
      <div class="lg:col-span-2 space-y-4">
        <div class="card p-5">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-muted mb-3">État</h2>
          <div class="space-y-2.5 text-sm">
            <div class="flex items-center justify-between gap-3"><span class="text-text-2">En cours</span>
              <span v-if="running.length" class="chip bg-accent-soft text-accent-2"><span class="h-1.5 w-1.5 rounded-full bg-current live-dot" /> {{ duration(running[0].started_at, null, now) }}</span><span v-else class="text-muted">non</span></div>
            <div class="flex items-center justify-between gap-3"><span class="text-text-2">Dernier run</span>
              <RouterLink v-if="script.last_run" :to="`/runs/${script.last_run.id}`" class="flex items-center gap-2"><StatusBadge :status="script.last_run.status" small /> <span class="text-muted text-xs">{{ relative(script.last_run.finished_at ?? script.last_run.started_at, now) }}</span></RouterLink><span v-else class="text-muted">jamais</span></div>
            <div class="flex items-center justify-between gap-3"><span class="text-text-2">Prochain passage</span><span :class="script.next_runs[0] ? 'text-text' : 'text-muted'">{{ script.next_runs[0] ? fmtDateShort(script.next_runs[0].nextAt) : 'aucun' }}</span></div>
            <div class="flex items-center justify-between gap-3"><span class="text-text-2">Environnement</span><span class="chip" :class="toneClasses(ENV_STATUS[script.env_status].tone)">{{ ENV_STATUS[script.env_status].label }}</span></div>
            <div v-if="script.queue.length" class="flex items-center justify-between gap-3"><span class="text-text-2">En file</span><span class="flex items-center gap-2"><span class="chip bg-info-soft text-info">{{ script.queue.length }}</span><button class="text-xs text-muted hover:text-err" @click="clearQueue">vider</button></span></div>
          </div>
        </div>
        <div class="card p-5 flex items-center gap-3">
          <div class="flex-1 text-sm"><div class="font-medium">Planifications actives</div><div class="text-xs text-muted">Désactiver suspend toutes les planifications de ce script.</div></div>
          <button type="button" class="toggle" :class="script.spec.enabled ? 'bg-accent' : 'bg-surface-3'" @click="toggleEnabled"><span class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" :class="script.spec.enabled ? 'translate-x-5' : 'translate-x-0'" /></button>
        </div>
      </div>
    </div>

    <!-- Historique -->
    <div v-else-if="tab === 'history'" class="card overflow-hidden">
      <div v-if="!runs.length" class="p-6 text-sm text-muted">Aucun run pour ce script.</div>
      <table v-else class="w-full text-sm">
        <tbody class="divide-y divide-border">
          <tr v-for="r in runs" :key="r.id" class="hover:bg-surface-2/50 cursor-pointer" @click="router.push(`/runs/${r.id}`)">
            <td class="px-4 py-2.5"><StatusBadge :status="r.status" /></td>
            <td class="px-4 py-2.5 text-text-2">{{ TRIGGER[r.trigger] ?? r.trigger }}<span v-if="r.max_attempts > 1" class="text-muted"> · {{ r.attempt }}/{{ r.max_attempts }}</span></td>
            <td class="px-4 py-2.5 text-text-2 hidden sm:table-cell">{{ fmtDateShort(r.started_at ?? r.created_at) }}</td>
            <td class="px-4 py-2.5 text-right font-mono text-text-2">{{ r.status === 'skipped' ? '—' : duration(r.started_at, r.finished_at, now) }}</td>
            <td class="px-4 py-2.5 text-right font-mono hidden sm:table-cell" :class="r.exit_code === 0 ? 'text-ok' : r.exit_code ? 'text-err' : 'text-muted'">{{ r.exit_code ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div class="px-4 py-2.5 border-t border-border text-xs flex flex-wrap items-center gap-3">
        <RouterLink :to="`/runs?slug=${script.slug}`" class="text-accent-2 hover:underline">Tout l'historique →</RouterLink>
        <span class="flex-1" />
        <button v-if="runs.length" type="button" class="text-muted hover:text-err" @click="purgeHistory(true)">Effacer les échecs</button>
        <button v-if="runs.length" type="button" class="text-muted hover:text-err" @click="purgeHistory(false)">Effacer tout l'historique</button>
      </div>
    </div>

    <!-- Planifications -->
    <div v-else-if="tab === 'schedules'" class="space-y-3">
      <div v-if="!script.spec.schedules.length" class="card p-6 text-sm text-muted">Aucune planification. <RouterLink :to="`/scripts/${script.slug}/edit?tab=schedules`" class="text-accent-2 hover:underline">En ajouter une</RouterLink>.</div>
      <div v-for="s in script.spec.schedules" :key="s.id" class="card p-4 flex flex-wrap items-center gap-3">
        <div class="min-w-0 flex-1">
          <div class="font-medium">{{ s.name || s.id }} <span class="font-mono text-xs text-muted ml-1">{{ s.cron }}</span></div>
          <div class="text-xs text-text-2 mt-0.5">{{ describeCron(s.cron) }}<span v-if="s.timezone"> · {{ s.timezone }}</span><span v-if="s.window"> · fenêtre {{ s.window }}</span><span v-if="s.jitter_seconds"> · ± {{ s.jitter_seconds }} s</span><span v-if="s.exclude_days.length"> · exclus {{ s.exclude_days.join(', ') }}</span><span v-if="s.catch_up"> · rattrapage</span></div>
          <div v-if="Object.keys(s.params).length" class="mt-1 flex flex-wrap gap-1"><span v-for="(v, k) in s.params" :key="k" class="chip bg-surface-2 text-text-2 font-mono text-[10px]">{{ k }}={{ v }}</span></div>
        </div>
        <span v-if="s.enabled && script.spec.enabled && nextBySchedule[s.id!]" class="chip bg-accent-soft text-accent-2">{{ relative(nextBySchedule[s.id!], now) }} · {{ fmtDateShort(nextBySchedule[s.id!]) }}</span>
        <span v-else class="chip bg-surface-3 text-muted">suspendue</span>
        <button type="button" class="toggle" :class="s.enabled ? 'bg-accent' : 'bg-surface-3'" @click="toggleSchedule(s.id!)"><span class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" :class="s.enabled ? 'translate-x-5' : 'translate-x-0'" /></button>
      </div>
      <RouterLink :to="`/scripts/${script.slug}/edit?tab=schedules`" class="btn-soft"><Settings2 class="h-4 w-4" /> Modifier les planifications</RouterLink>
    </div>

    <!-- Environnement -->
    <div v-else-if="tab === 'env'" class="space-y-4">
      <div class="card p-5">
        <div class="flex flex-wrap items-center gap-3 mb-4">
          <h2 class="font-semibold">Dépendances</h2>
          <span class="chip" :class="toneClasses(ENV_STATUS[script.env_status].tone)">{{ ENV_STATUS[script.env_status].label }}</span>
          <span v-if="script.env_updated_at" class="text-xs text-muted">mis à jour {{ relative(script.env_updated_at, now) }}</span>
          <span class="flex-1" />
          <button class="btn-soft" @click="rebuildEnv"><RefreshCw class="h-4 w-4" /> Reconstruire</button>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div v-for="k in (['apt', 'pip', 'npm'] as const)" :key="k" class="rounded-xl bg-surface-2 p-3">
            <div class="text-[11px] uppercase tracking-wide text-muted mb-1">{{ k }}</div>
            <div v-if="script.spec.deps[k].length" class="font-mono text-xs space-y-0.5"><div v-for="d in script.spec.deps[k]" :key="d">{{ d }}</div></div>
            <div v-else class="text-xs text-muted">—</div>
          </div>
          <div class="rounded-xl bg-surface-2 p-3">
            <div class="text-[11px] uppercase tracking-wide text-muted mb-1">binaires</div>
            <div v-if="script.spec.deps.bin.length" class="font-mono text-xs space-y-0.5"><div v-for="b in script.spec.deps.bin" :key="b.name" :title="b.url">{{ b.name }}</div></div>
            <div v-else class="text-xs text-muted">—</div>
          </div>
        </div>
      </div>
      <div v-if="script.env_log" class="card p-0 overflow-hidden">
        <div class="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted border-b border-border">Journal d'installation</div>
        <pre class="terminal rounded-none border-0 p-4 max-h-[50vh] whitespace-pre-wrap">{{ script.env_log }}</pre>
      </div>
    </div>

    <!-- Notifications -->
    <div v-else-if="tab === 'notify'" class="card p-5 text-sm space-y-3">
      <div class="flex flex-wrap gap-2">
        <span v-for="e in script.spec.notify.events" :key="e" class="chip bg-accent-soft text-accent-2">{{ NOTIFY_EVENTS[e] ?? e }}</span>
        <span v-if="!script.spec.notify.events.length" class="text-muted">Aucun événement notifié.</span>
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-text-2">
        <dt class="text-muted">Sujet</dt><dd>{{ script.spec.notify.topic || 'sujet global' }}</dd>
        <dt class="text-muted">Serveur</dt><dd>{{ script.spec.notify.server || 'serveur global' }}</dd>
        <dt class="text-muted">Priorité</dt><dd>{{ script.spec.notify.priority }}/5</dd>
        <dt class="text-muted">Étiquettes</dt><dd>{{ script.spec.notify.tags.join(', ') || '—' }}</dd>
      </dl>
      <RouterLink :to="`/scripts/${script.slug}/edit?tab=notify`" class="btn-soft inline-flex"><Settings2 class="h-4 w-4" /> Modifier</RouterLink>
    </div>

    <!-- Code -->
    <div v-else-if="tab === 'code'" class="space-y-4">
      <div>
        <div class="flex items-center gap-2 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{{ script.spec.file }} <RouterLink :to="`/scripts/${script.slug}/edit?tab=code`" class="ml-auto normal-case tracking-normal text-accent-2 hover:underline font-medium">Modifier</RouterLink></div>
        <CodeEditor v-if="script.code !== null" :model-value="script.code" :lang="lang" />
        <div v-else class="card p-4 text-sm text-err">Fichier introuvable.</div>
      </div>
      <div>
        <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">script.yaml</div>
        <CodeEditor v-if="script.yaml !== null" :model-value="script.yaml" lang="yaml" min-height="200px" />
      </div>
    </div>
  </div>
</template>
