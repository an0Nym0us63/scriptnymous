<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { CalendarClock, Pause } from 'lucide-vue-next';
import { api, type ScheduleSpec } from '@/lib/api';
import { onWs } from '@/lib/ws';
import { describeCron, fmtDateShort, relative } from '@/lib/format';
import EmptyState from '@/components/EmptyState.vue';

interface Row {
  slug: string;
  script_name: string;
  group: string | null;
  schedule: ScheduleSpec;
  next_at: string | null;
  last_fired_at: string | null;
  active: boolean;
}
const rows = ref<Row[]>([]);
const now = ref(Date.now());
let tick: number;
let unsub: (() => void) | null = null;

async function load(): Promise<void> {
  const r = await api.get<{ schedules: Row[] }>('/api/schedules');
  rows.value = r.schedules.sort((a, b) => (a.next_at ?? '9').localeCompare(b.next_at ?? '9'));
}
onMounted(() => {
  void load();
  tick = window.setInterval(() => (now.value = Date.now()), 1000);
  unsub = onWs((m) => (m.type === 'schedule:armed' || m.type === 'script:changed') && void load());
});
onBeforeUnmount(() => {
  clearInterval(tick);
  unsub?.();
});
</script>

<template>
  <div>
    <div class="mb-5">
      <h1 class="text-2xl font-semibold tracking-tight">Planifications</h1>
      <p class="text-sm text-muted">Toutes les planifications déclarées, triées par prochain passage.</p>
    </div>

    <EmptyState v-if="!rows.length" title="Aucune planification" text="Ajoutez une planification depuis la page d'un script : expression cron, fuseau, fenêtre horaire, jours exclus.">
      <template #icon><CalendarClock class="h-6 w-6" /></template>
    </EmptyState>

    <div v-else class="grid gap-3 md:grid-cols-2">
      <RouterLink v-for="r in rows" :key="r.slug + r.schedule.id" :to="`/scripts/${r.slug}?tab=schedules`" class="card p-4 hover:border-border-strong transition" :class="!r.active && 'opacity-60'">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <div class="font-semibold truncate">{{ r.script_name }} <span class="text-muted font-normal">· {{ r.schedule.name || r.schedule.id }}</span></div>
            <div class="text-xs text-text-2 mt-0.5">{{ describeCron(r.schedule.cron) }} <span class="font-mono text-muted">({{ r.schedule.cron }})</span></div>
          </div>
          <span v-if="!r.active" class="chip bg-surface-3 text-muted"><Pause class="h-3 w-3" /> suspendue</span>
          <span v-else-if="r.next_at" class="chip bg-accent-soft text-accent-2">{{ relative(r.next_at, now) }}</span>
        </div>
        <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span v-if="r.next_at">Prochain : {{ fmtDateShort(r.next_at) }}</span>
          <span v-if="r.last_fired_at">Dernier : {{ fmtDateShort(r.last_fired_at) }}</span>
          <span v-if="r.schedule.timezone">{{ r.schedule.timezone }}</span>
          <span v-if="r.schedule.window">fenêtre {{ r.schedule.window }}</span>
          <span v-if="r.schedule.jitter_seconds">± {{ r.schedule.jitter_seconds }} s</span>
          <span v-if="r.schedule.catch_up">rattrapage</span>
          <span v-if="r.schedule.exclude_days.length">exclus : {{ r.schedule.exclude_days.join(', ') }}</span>
        </div>
      </RouterLink>
    </div>
  </div>
</template>
