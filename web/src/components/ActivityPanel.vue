<script setup lang="ts">
// Panneau « Activité » : installations d'environnement (avec journal), runs en cours, file d'attente et retries à venir.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Loader2, Package, Play, ListOrdered, X } from 'lucide-vue-next';
import { api } from '@/lib/api';
import { onWs } from '@/lib/ws';
import { duration, relative, TRIGGER } from '@/lib/format';
import Modal from './Modal.vue';

interface Activity {
  installs: { slug: string; name: string; status: string; since: string | null; log_tail: string }[];
  running: { id: string; slug: string; name: string; started_at: string | null; trigger: string; attempt: number; max_attempts: number }[];
  queue: { id: string; slug: string; name: string; trigger: string; attempt: number; not_before: string | null; created_at: string }[];
  count: number;
}
const emit = defineEmits<{ close: [] }>();
const data = ref<Activity | null>(null);
const now = ref(Date.now());
let tick: number;
let unsub: (() => void) | null = null;
let timer: number | null = null;

async function load(): Promise<void> {
  data.value = await api.get<Activity>('/api/activity');
}
function scheduleLoad(): void {
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(() => void load().catch(() => {}), 300);
}
async function dequeue(id: string): Promise<void> {
  await api.del(`/api/queue/${id}`);
  await load();
}
onMounted(() => {
  void load();
  tick = window.setInterval(() => (now.value = Date.now()), 1000);
  unsub = onWs((m) => m.type !== 'run:output' && scheduleLoad());
});
onBeforeUnmount(() => {
  clearInterval(tick);
  unsub?.();
});
</script>

<template>
  <Modal title="Activité en cours" wide @close="emit('close')">
    <div v-if="!data" class="text-sm text-muted py-6 text-center">Chargement…</div>
    <div v-else-if="!data.count" class="text-sm text-muted py-8 text-center">Rien en cours : aucune installation, aucun run, file d'attente vide.</div>
    <div v-else class="space-y-5">
      <section v-if="data.installs.length">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-muted mb-2 flex items-center gap-2"><Package class="h-3.5 w-3.5" /> Environnements en préparation</h3>
        <div v-for="i in data.installs" :key="i.slug" class="card p-3 mb-2">
          <div class="flex items-center gap-2 text-sm">
            <Loader2 class="h-4 w-4 animate-spin text-accent-2" />
            <RouterLink :to="`/scripts/${i.slug}?tab=env`" class="font-medium hover:underline" @click="emit('close')">{{ i.name }}</RouterLink>
            <span class="text-muted text-xs">{{ i.status === 'installing' ? 'installation' : 'en attente' }}<span v-if="i.since"> · depuis {{ relative(i.since, now) }}</span></span>
          </div>
          <pre v-if="i.log_tail" class="terminal mt-2 p-2 text-[11px] max-h-32 whitespace-pre-wrap">{{ i.log_tail.trim().split('\n').slice(-6).join('\n') }}</pre>
        </div>
      </section>

      <section v-if="data.running.length">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-muted mb-2 flex items-center gap-2"><Play class="h-3.5 w-3.5" /> Runs en cours</h3>
        <RouterLink v-for="r in data.running" :key="r.id" :to="`/runs/${r.id}`" class="card p-3 mb-2 flex items-center gap-3 text-sm hover:border-border-strong" @click="emit('close')">
          <span class="h-2 w-2 rounded-full bg-accent live-dot" />
          <span class="font-medium">{{ r.name }}</span>
          <span class="text-muted text-xs">{{ TRIGGER[r.trigger] ?? r.trigger }}<span v-if="r.max_attempts > 1"> · essai {{ r.attempt }}/{{ r.max_attempts }}</span></span>
          <span class="flex-1" />
          <span class="font-mono text-xs text-text-2">{{ duration(r.started_at, null, now) }}</span>
        </RouterLink>
      </section>

      <section v-if="data.queue.length">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-muted mb-2 flex items-center gap-2"><ListOrdered class="h-3.5 w-3.5" /> En attente</h3>
        <div v-for="q in data.queue" :key="q.id" class="card p-3 mb-2 flex items-center gap-3 text-sm">
          <span class="font-medium">{{ q.name }}</span>
          <span class="text-muted text-xs">
            {{ TRIGGER[q.trigger] ?? q.trigger }}<span v-if="q.attempt > 1"> · essai {{ q.attempt }}</span>
            <template v-if="q.not_before"> · {{ new Date(q.not_before).getTime() > now ? `prévu ${relative(q.not_before, now)}` : 'dès que possible' }}</template>
            <template v-else> · attend la fin de l'instance en cours</template>
          </span>
          <span class="flex-1" />
          <button class="btn-icon btn-ghost text-muted hover:text-err" title="Retirer de la file" @click="dequeue(q.id)"><X class="h-4 w-4" /></button>
        </div>
      </section>
    </div>
  </Modal>
</template>
