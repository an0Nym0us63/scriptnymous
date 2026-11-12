<script setup lang="ts">
// Suggestions de dépendances (d'après le code et/ou un journal) avec ajout en un clic.
import { computed, ref, watch } from 'vue';
import { Plus, Sparkles, Loader2 } from 'lucide-vue-next';
import { api } from '@/lib/api';

export interface Suggestion {
  kind: 'pip' | 'npm' | 'apt';
  package: string;
  reason: string;
  fromError: boolean;
}

const props = defineProps<{
  interpreter?: string;
  code?: string | null;
  log?: string | null;
  /** Paquets déjà déclarés, pour ne pas les reproposer. */
  existing: { pip: string[]; npm: string[]; apt: string[] };
  compact?: boolean;
}>();
const emit = defineEmits<{ add: [s: Suggestion]; addAll: [s: Suggestion[]] }>();

const suggestions = ref<Suggestion[]>([]);
const loading = ref(false);
let timer: number | null = null;

const norm = (p: string) => p.toLowerCase().split(/[<>=!~\[ ]/)[0];
const pending = computed(() => suggestions.value.filter((s) => !props.existing[s.kind].map(norm).includes(norm(s.package))));

async function compute(): Promise<void> {
  if (!props.code && !props.log) return void (suggestions.value = []);
  loading.value = true;
  try {
    const r = await api.post<{ suggestions: Suggestion[] }>('/api/deps/suggest', { interpreter: props.interpreter, code: props.code ?? undefined, log: props.log ?? undefined });
    suggestions.value = r.suggestions;
  } catch {
    suggestions.value = [];
  } finally {
    loading.value = false;
  }
}
watch(
  () => [props.code, props.log, props.interpreter],
  () => {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(compute, 400);
  },
  { immediate: true },
);
defineExpose({ pending });
</script>

<template>
  <div v-if="loading || pending.length" class="rounded-xl border border-accent/30 bg-accent-soft/40 p-3" :class="compact && 'text-sm'">
    <div class="flex items-center gap-2 text-sm font-medium mb-2">
      <Sparkles class="h-4 w-4 text-accent-2" /> Dépendances suggérées
      <Loader2 v-if="loading" class="h-3.5 w-3.5 animate-spin text-muted" />
      <span class="flex-1" />
      <button v-if="pending.length > 1" type="button" class="text-xs text-accent-2 hover:underline" @click="emit('addAll', pending)">Tout ajouter</button>
    </div>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="s in pending"
        :key="s.kind + s.package"
        type="button"
        class="chip border px-2.5 py-1 transition hover:brightness-110"
        :class="s.fromError ? 'bg-err-soft text-err border-err/40' : 'bg-surface-2 text-text border-border'"
        :title="s.fromError ? `Erreur observée : ${s.reason}` : `Détecté dans le code : ${s.reason}`"
        @click="emit('add', s)"
      >
        <Plus class="h-3 w-3" /> <span class="text-muted">{{ s.kind }}</span> <span class="font-mono">{{ s.package }}</span>
        <span v-if="s.reason !== s.package" class="text-muted">({{ s.reason }})</span>
      </button>
    </div>
  </div>
</template>
