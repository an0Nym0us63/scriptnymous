<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronLeft, ChevronRight, History } from 'lucide-vue-next';
import { api, type Run } from '@/lib/api';
import { onWs } from '@/lib/ws';
import { useScripts } from '@/stores/scripts';
import { duration, fmtDateShort, relative, STATUS, TRIGGER } from '@/lib/format';
import StatusBadge from '@/components/StatusBadge.vue';
import EmptyState from '@/components/EmptyState.vue';

const route = useRoute();
const router = useRouter();
const scripts = useScripts();
const runs = ref<Run[]>([]);
const total = ref(0);
const limit = 30;
const page = ref(0);
const slug = ref((route.query.slug as string) || '');
const status = ref((route.query.status as string) || '');
const trigger = ref('');
const now = ref(Date.now());
let tick: number;
let unsub: (() => void) | null = null;
let reloadTimer: number | null = null;

async function load(): Promise<void> {
  const q = new URLSearchParams({ limit: String(limit), offset: String(page.value * limit) });
  if (slug.value) q.set('slug', slug.value);
  if (status.value) q.set('status', status.value);
  if (trigger.value) q.set('trigger', trigger.value);
  const r = await api.get<{ runs: Run[]; total: number }>(`/api/runs?${q}`);
  runs.value = r.runs;
  total.value = r.total;
  void router.replace({ query: { ...(slug.value && { slug: slug.value }), ...(status.value && { status: status.value }) } });
}
watch([slug, status, trigger], () => {
  page.value = 0;
  void load();
});
watch(page, () => void load());
onMounted(() => {
  void load();
  tick = window.setInterval(() => (now.value = Date.now()), 1000);
  unsub = onWs((m) => {
    if (m.type.startsWith('run:') && m.type !== 'run:output') {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => void load(), 300);
    }
  });
});
onBeforeUnmount(() => {
  clearInterval(tick);
  unsub?.();
});
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-3 mb-5">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Historique</h1>
        <p class="text-sm text-muted">{{ total }} run{{ total > 1 ? 's' : '' }}</p>
      </div>
      <span class="flex-1" />
      <select v-model="slug" class="input w-auto">
        <option value="">Tous les scripts</option>
        <option v-for="s in scripts.items" :key="s.slug" :value="s.slug">{{ s.name }}</option>
      </select>
      <select v-model="status" class="input w-auto">
        <option value="">Tous les statuts</option>
        <option v-for="(m, k) in STATUS" :key="k" :value="k">{{ m.label }}</option>
      </select>
      <select v-model="trigger" class="input w-auto">
        <option value="">Tous les déclencheurs</option>
        <option v-for="(l, k) in TRIGGER" :key="k" :value="k">{{ l }}</option>
      </select>
    </div>

    <EmptyState v-if="!runs.length" title="Aucun run" text="Les lancements apparaîtront ici avec leur statut, leur durée et leur journal.">
      <template #icon><History class="h-6 w-6" /></template>
    </EmptyState>

    <div v-else class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-[11px] uppercase tracking-wide text-muted bg-surface-2/60">
          <tr>
            <th class="text-left font-medium px-4 py-2.5">Script</th>
            <th class="text-left font-medium px-4 py-2.5">Statut</th>
            <th class="text-left font-medium px-4 py-2.5 hidden md:table-cell">Déclencheur</th>
            <th class="text-left font-medium px-4 py-2.5 hidden sm:table-cell">Début</th>
            <th class="text-right font-medium px-4 py-2.5">Durée</th>
            <th class="text-right font-medium px-4 py-2.5 hidden md:table-cell">Code</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="r in runs" :key="r.id" class="hover:bg-surface-2/50 cursor-pointer" @click="router.push(`/runs/${r.id}`)">
            <td class="px-4 py-2.5">
              <div class="font-medium">{{ r.script_name }}</div>
              <div class="text-[11px] text-muted font-mono">{{ r.id }}</div>
            </td>
            <td class="px-4 py-2.5"><StatusBadge :status="r.status" /></td>
            <td class="px-4 py-2.5 hidden md:table-cell text-text-2">{{ TRIGGER[r.trigger] ?? r.trigger }}<span v-if="r.max_attempts > 1" class="text-muted"> · {{ r.attempt }}/{{ r.max_attempts }}</span></td>
            <td class="px-4 py-2.5 hidden sm:table-cell text-text-2" :title="fmtDateShort(r.started_at ?? r.created_at)">{{ relative(r.started_at ?? r.created_at, now) }}</td>
            <td class="px-4 py-2.5 text-right font-mono text-text-2">{{ r.status === 'skipped' ? '—' : duration(r.started_at, r.finished_at, now) }}</td>
            <td class="px-4 py-2.5 text-right font-mono hidden md:table-cell" :class="r.exit_code === 0 ? 'text-ok' : r.exit_code ? 'text-err' : 'text-muted'">{{ r.exit_code ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div class="flex items-center gap-2 px-4 py-2.5 border-t border-border text-xs text-muted">
        <span>{{ page * limit + 1 }}–{{ Math.min(total, (page + 1) * limit) }} sur {{ total }}</span>
        <span class="flex-1" />
        <button class="btn-icon btn-ghost" :disabled="page === 0" @click="page--"><ChevronLeft class="h-4 w-4" /></button>
        <button class="btn-icon btn-ghost" :disabled="(page + 1) * limit >= total" @click="page++"><ChevronRight class="h-4 w-4" /></button>
      </div>
    </div>
  </div>
</template>
