<script setup lang="ts">
// Explorateur du dossier des scripts : navigation par dossier, sélection d'un fichier.
import { computed, onMounted, ref, watch } from 'vue';
import { Folder, FolderCheck, FileText, ChevronRight, Home } from 'lucide-vue-next';
import { api } from '@/lib/api';
import { bytes } from '@/lib/format';
import Modal from './Modal.vue';

interface Entry {
  name: string;
  type: 'dir' | 'file';
  size: number;
  mtime: string | null;
  declared: boolean;
}

const props = defineProps<{
  /** Dossier de départ, relatif à /scripts. */
  start?: string;
  /** Si défini, la navigation reste à l'intérieur de ce dossier. */
  root?: string;
}>();
const emit = defineEmits<{ close: []; pick: [relPath: string] }>();

const current = ref(props.start ?? props.root ?? '');
const items = ref<Entry[]>([]);
const error = ref('');
const loading = ref(false);

const crumbs = computed(() => {
  const parts = current.value ? current.value.split('/') : [];
  return parts.map((p, i) => ({ name: p, path: parts.slice(0, i + 1).join('/') }));
});
const canGoUp = computed(() => current.value !== (props.root ?? '') && current.value !== '');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const r = await api.get<{ path: string; items: Entry[] }>(`/api/browse?path=${encodeURIComponent(current.value)}`);
    items.value = r.items;
  } catch (e) {
    error.value = (e as Error).message;
    items.value = [];
  } finally {
    loading.value = false;
  }
}
function open(e: Entry): void {
  const p = current.value ? `${current.value}/${e.name}` : e.name;
  if (e.type === 'dir') current.value = p;
  else emit('pick', p);
}
function goTo(p: string): void {
  if (props.root && !p.startsWith(props.root)) return;
  current.value = p;
}
watch(current, load);
onMounted(load);
</script>

<template>
  <Modal title="Choisir un fichier dans /scripts" wide @close="emit('close')">
    <div class="flex items-center gap-1 text-sm mb-3 flex-wrap">
      <button class="btn-icon btn-ghost" :disabled="!!root" @click="goTo('')"><Home class="h-4 w-4" /></button>
      <template v-for="c in crumbs" :key="c.path">
        <ChevronRight class="h-3 w-3 text-muted" />
        <button class="btn-ghost px-2 py-1 font-mono text-xs" @click="goTo(c.path)">{{ c.name }}</button>
      </template>
    </div>
    <p v-if="error" class="text-sm text-err mb-3">{{ error }}</p>
    <div class="card overflow-hidden divide-y divide-border max-h-[55vh] overflow-y-auto">
      <button v-if="canGoUp" class="w-full flex items-center gap-3 px-4 py-2 text-sm text-muted hover:bg-surface-2" @click="goTo(current.split('/').slice(0, -1).join('/'))">
        <Folder class="h-4 w-4" /> ..
      </button>
      <button v-for="e in items" :key="e.name" class="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-surface-2 text-left" @click="open(e)">
        <FolderCheck v-if="e.type === 'dir' && e.declared" class="h-4 w-4 text-ok shrink-0" />
        <Folder v-else-if="e.type === 'dir'" class="h-4 w-4 text-accent-2 shrink-0" />
        <FileText v-else class="h-4 w-4 text-muted shrink-0" />
        <span class="font-mono truncate flex-1">{{ e.name }}</span>
        <span v-if="e.type === 'dir' && e.declared" class="chip bg-ok-soft text-ok">déclaré</span>
        <span v-if="e.type === 'file'" class="text-xs text-muted">{{ bytes(e.size) }}</span>
      </button>
      <div v-if="!items.length && !loading && !error" class="px-4 py-6 text-sm text-muted text-center">Dossier vide.</div>
    </div>
    <p class="text-xs text-muted mt-3">Un script doit être dans son propre sous-dossier de <span class="font-mono">/scripts</span> : le nom du dossier devient son identifiant.</p>
  </Modal>
</template>
