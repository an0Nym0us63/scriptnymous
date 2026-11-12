<script setup lang="ts">
// Popup de choix d'icône : catalogue lucide complet, filtre texte, aperçu, sélection au clic.
import { computed, onMounted, ref } from 'vue';
import { Search, Loader2 } from 'lucide-vue-next';
import { loadAllIcons, allIcons, COMMON_ICONS } from '@/lib/icons';
import Modal from './Modal.vue';

const props = defineProps<{ current?: string; color?: string }>();
const emit = defineEmits<{ close: []; pick: [name: string] }>();

const query = ref('');
const limit = ref(240);
const input = ref<HTMLInputElement | null>(null);

onMounted(async () => {
  await loadAllIcons();
  input.value?.focus();
});

const names = computed(() => (allIcons.value ? Object.keys(allIcons.value).sort() : []));
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!q) return [...Object.keys(COMMON_ICONS), ...names.value.filter((n) => !COMMON_ICONS[n])];
  const terms = q.split('-').filter(Boolean);
  return names.value.filter((n) => terms.every((t) => n.includes(t)));
});
const shown = computed(() => filtered.value.slice(0, limit.value));
</script>

<template>
  <Modal title="Choisir une icône" wide @close="emit('close')">
    <div class="relative mb-3">
      <Search class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input ref="input" v-model="query" class="input pl-9" placeholder="Filtrer : camera, hard drive, bell…" @input="limit = 240" />
    </div>
    <div v-if="!allIcons" class="flex items-center gap-2 text-sm text-muted py-8 justify-center"><Loader2 class="h-4 w-4 animate-spin" /> Chargement du catalogue…</div>
    <template v-else>
      <div class="text-xs text-muted mb-2">{{ filtered.length }} icône{{ filtered.length > 1 ? 's' : '' }}<span v-if="!query"> · les plus courantes d'abord</span></div>
      <div class="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1.5 max-h-[55vh] overflow-y-auto pr-1">
        <button
          v-for="n in shown"
          :key="n"
          type="button"
          class="group flex flex-col items-center gap-1 rounded-xl border p-2 transition hover:border-border-strong"
          :class="n === current ? 'border-accent bg-accent-soft' : 'border-border'"
          :title="n"
          @click="emit('pick', n)"
        >
          <span class="h-8 w-8 rounded-lg flex items-center justify-center text-white" :style="{ background: color || 'var(--accent)' }">
            <component :is="allIcons[n]" :size="16" />
          </span>
          <span class="text-[9px] leading-tight text-muted truncate w-full text-center group-hover:text-text">{{ n }}</span>
        </button>
      </div>
      <div v-if="filtered.length > shown.length" class="mt-3 text-center">
        <button class="btn-soft" @click="limit += 240">Afficher plus ({{ filtered.length - shown.length }} restantes)</button>
      </div>
      <div v-if="!filtered.length" class="text-sm text-muted py-8 text-center">Aucune icône ne correspond.</div>
    </template>
  </Modal>
</template>
