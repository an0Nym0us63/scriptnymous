<script setup lang="ts">
// Page Variables : /scripts/config.json en arbre éditable (filtre, ajout sans limite de profondeur) ou en JSON brut.
import { computed, onMounted, ref } from 'vue';
import { Search, Save, Undo2, Plus, Braces, ListTree, Download, AlertTriangle } from 'lucide-vue-next';
import { useVariables, typeOf, type JsonValue } from '@/stores/variables';
import { useApp } from '@/stores/app';
import { ApiError } from '@/lib/api';
import VarNode from '@/components/VarNode.vue';
import CodeEditor from '@/components/CodeEditor.vue';

const store = useVariables();
const app = useApp();
const filter = ref('');
const mode = ref<'tree' | 'raw'>('tree');
const raw = ref('');
const rawDirty = ref(false);
const saving = ref(false);
const adding = ref(false);
const newKey = ref('');
const newType = ref<'string' | 'number' | 'boolean' | 'object' | 'array'>('string');

onMounted(async () => {
  await store.load();
  raw.value = store.rawText;
});

const rootEntries = computed(() => {
  const d = store.doc;
  if (typeOf(d) !== 'object') return [];
  const entries = Object.entries(d as Record<string, JsonValue>);
  const f = filter.value.toLowerCase();
  return f ? entries.filter(([k, v]) => k.toLowerCase().includes(f) || JSON.stringify(v).toLowerCase().includes(f)) : entries;
});
const total = computed(() => (typeOf(store.doc) === 'object' ? Object.keys(store.doc as object).length : 0));

/** Préfixes (avant le premier « _ ») pour un filtrage rapide. */
const prefixes = computed(() => {
  const counts = new Map<string, number>();
  if (typeOf(store.doc) !== 'object') return [];
  for (const k of Object.keys(store.doc as object)) {
    const p = k.split(/[_-]/)[0].toUpperCase();
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 14);
});

function switchMode(m: 'tree' | 'raw'): void {
  if (m === 'raw' && !rawDirty.value) raw.value = JSON.stringify(store.doc, null, 2) + '\n';
  mode.value = m;
}
function applyRaw(): void {
  try {
    store.doc = JSON.parse(raw.value) as JsonValue;
    rawDirty.value = false;
    mode.value = 'tree';
    app.toast('ok', 'JSON appliqué à l’arbre');
  } catch (e) {
    app.toast('err', 'JSON invalide', (e as Error).message);
  }
}
async function save(force = false): Promise<void> {
  saving.value = true;
  try {
    if (mode.value === 'raw' && rawDirty.value) await store.save({ raw: raw.value, force });
    else await store.save({ force });
    rawDirty.value = false;
    raw.value = store.rawText;
    app.toast('ok', 'Variables enregistrées', 'Sauvegarde précédente dans config.json.bak');
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && !force) {
      if (confirm(`${e.message}\n\nÉcraser quand même la version du fichier ?`)) return save(true);
    } else app.toast('err', 'Enregistrement impossible', (e as Error).message);
  } finally {
    saving.value = false;
  }
}
function addRoot(): void {
  const init: Record<string, JsonValue> = { string: '', number: 0, boolean: false, object: {}, array: [] };
  const k = newKey.value.trim();
  if (!k) return;
  if (typeOf(store.doc) !== 'object') store.doc = {};
  if (!store.add([], k, init[newType.value])) return app.toast('err', 'Clé déjà présente', k);
  adding.value = false;
  newKey.value = '';
  filter.value = '';
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-3 mb-5">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Variables</h1>
        <p class="text-sm text-muted font-mono">{{ store.filePath || '/scripts/config.json' }}<span v-if="!store.exists" class="ml-2 text-warn font-sans">(sera créé à l'enregistrement)</span> <RouterLink to="/settings" class="ml-2 text-accent-2 font-sans hover:underline">changer</RouterLink></p>
      </div>
      <span class="flex-1" />
      <div class="flex rounded-xl border border-border overflow-hidden">
        <button class="btn rounded-none" :class="mode === 'tree' ? 'bg-accent-soft text-accent-2' : 'text-text-2'" @click="switchMode('tree')"><ListTree class="h-4 w-4" /> Arbre</button>
        <button class="btn rounded-none" :class="mode === 'raw' ? 'bg-accent-soft text-accent-2' : 'text-text-2'" @click="switchMode('raw')"><Braces class="h-4 w-4" /> JSON</button>
      </div>
      <a class="btn-icon btn-ghost" title="Télécharger la sauvegarde précédente (.bak)" href="/api/variables/backup" download="config.json.bak"><Download class="h-4 w-4" /></a>
      <button v-if="store.dirty || rawDirty" class="btn-soft" @click="store.discard(); rawDirty = false; raw = store.rawText"><Undo2 class="h-4 w-4" /> Annuler</button>
      <button class="btn-primary" :disabled="saving || !(store.dirty || rawDirty)" @click="save()"><Save class="h-4 w-4" /> Enregistrer</button>
    </div>

    <div v-if="store.parseError" class="mb-4 card border-err/40 bg-err-soft px-4 py-3 text-sm text-err flex items-center gap-2">
      <AlertTriangle class="h-4 w-4" /> {{ store.parseError }} — corrigez-le dans l'onglet JSON.
    </div>

    <template v-if="mode === 'tree'">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <div class="relative flex-1 min-w-56">
          <Search class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input v-model="filter" class="input pl-9" placeholder="Filtrer par clé ou valeur…" />
        </div>
        <button class="btn-soft" @click="adding = !adding"><Plus class="h-4 w-4" /> Nouvelle variable</button>
      </div>
      <div class="flex flex-wrap gap-1.5 mb-3">
        <button v-for="[p, n] in prefixes" :key="p" class="chip border transition" :class="filter.toUpperCase() === p + '_' ? 'bg-accent-soft text-accent-2 border-accent/50' : 'bg-surface-2 text-text-2 border-border hover:border-border-strong'" @click="filter = filter.toUpperCase() === p + '_' ? '' : p + '_'">{{ p }} <span class="text-muted">{{ n }}</span></button>
      </div>

      <div v-if="adding" class="card p-3 mb-3 flex flex-wrap items-center gap-2">
        <input v-model="newKey" class="input font-mono !w-72" placeholder="NOM_DE_LA_VARIABLE" v-focus @keydown.enter="addRoot" @keydown.escape="adding = false" />
        <select v-model="newType" class="input !w-52">
          <option value="string">texte</option><option value="number">nombre</option><option value="boolean">booléen</option><option value="object">objet (sous-ensemble)</option><option value="array">liste</option>
        </select>
        <button class="btn-primary" @click="addRoot">Ajouter</button>
        <button class="btn-ghost" @click="adding = false">Annuler</button>
      </div>

      <div class="card p-3">
        <div class="text-xs text-muted mb-2 px-1">{{ rootEntries.length }}{{ filter ? ` / ${total}` : '' }} variable{{ total > 1 ? 's' : '' }} · double-clic sur une clé pour la renommer · les clés sensibles sont masquées</div>
        <VarNode v-for="[k, v] in rootEntries" :key="k" :value="v" :path="[k]" :filter="filter" :depth="0" />
        <div v-if="!rootEntries.length" class="text-sm text-muted py-6 text-center">{{ filter ? 'Aucune variable ne correspond.' : 'Aucune variable. Ajoutez-en une ou collez un JSON dans l’onglet JSON.' }}</div>
      </div>
    </template>

    <template v-else>
      <div class="flex items-center gap-2 mb-2 text-xs text-muted">
        <span>Édition libre du fichier. « Enregistrer » écrit ce texte tel quel après validation.</span>
        <span class="flex-1" />
        <button class="btn-soft" @click="applyRaw">Appliquer à l'arbre</button>
      </div>
      <CodeEditor :model-value="raw" lang="json" min-height="60vh" @update:model-value="raw = $event; rawDirty = true" />
    </template>
  </div>
</template>
