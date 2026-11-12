<script setup lang="ts">
// Nœud récursif de l'arbre des variables : objet, liste ou valeur simple ; édition en place, ajout, suppression, renommage.
import { computed, ref } from 'vue';
import { ChevronRight, Plus, Trash2, Eye, EyeOff, Copy } from 'lucide-vue-next';
import { useVariables, typeOf, isSecretKey, type JsonValue, type Path } from '@/stores/variables';
import { useApp } from '@/stores/app';

const props = defineProps<{ value: JsonValue; path: Path; filter: string; depth: number }>();
const store = useVariables();
const app = useApp();

const key = computed(() => props.path[props.path.length - 1]);
const kind = computed(() => typeOf(props.value));
const isContainer = computed(() => kind.value === 'object' || kind.value === 'array');
const pathKey = computed(() => props.path.join('.'));
const secret = computed(() => isSecretKey(key.value));
const shown = computed(() => !secret.value || store.revealed.has(pathKey.value));

const collapsed = ref(props.depth > 0);

/** Résumé d'un conteneur replié : champ « nom » s'il existe, sinon première valeur simple. */
const SUMMARY_KEYS = ['name', 'nom', 'title', 'titre', 'label', 'libelle', 'id', 'slug', 'key', 'url', 'host', 'ip', 'path'];
const summary = computed(() => {
  const v = props.value;
  if (v === null || typeof v !== 'object') return '';
  if (Array.isArray(v)) {
    const firsts = v.slice(0, 3).map((x) => (x !== null && typeof x === 'object' ? null : String(x))).filter((x): x is string => x !== null);
    return firsts.length ? firsts.join(', ') + (v.length > 3 ? ', …' : '') : '';
  }
  const o = v as Record<string, JsonValue>;
  for (const k of SUMMARY_KEYS) {
    const found = Object.keys(o).find((ok) => ok.toLowerCase() === k);
    if (found !== undefined && o[found] !== null && typeof o[found] !== 'object') return String(o[found]);
  }
  const first = Object.values(o).find((x) => x !== null && typeof x !== 'object');
  return first === undefined ? '' : String(first);
});
const open = computed(() => (props.filter ? true : !collapsed.value));

/** Entrées enfants, filtrées (une entrée reste si son chemin ou une de ses valeurs contient le filtre). */
const children = computed(() => {
  const v = props.value;
  const entries: [string | number, JsonValue][] = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v as Record<string, JsonValue>);
  if (!props.filter) return entries;
  const f = props.filter.toLowerCase();
  return entries.filter(([k, x]) => String(k).toLowerCase().includes(f) || JSON.stringify(x).toLowerCase().includes(f));
});

// ---- édition d'une valeur simple ----
function onInput(raw: string): void {
  if (kind.value === 'number') {
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) store.set(props.path, n);
  } else store.set(props.path, raw);
}
function changeType(t: string): void {
  const v = props.value;
  let nv: JsonValue;
  switch (t) {
    case 'string': nv = v === null || typeof v === 'object' ? '' : String(v); break;
    case 'number': nv = Number(v) || 0; break;
    case 'boolean': nv = v === true || v === 'true' || v === 1; break;
    case 'null': nv = null; break;
    case 'object': nv = {}; break;
    case 'array': nv = []; break;
    default: return;
  }
  store.set(props.path, nv);
  collapsed.value = false;
}

// ---- ajout ----
const adding = ref(false);
const newKey = ref('');
const newType = ref<'string' | 'number' | 'boolean' | 'object' | 'array'>('string');
function confirmAdd(): void {
  const init: Record<string, JsonValue> = { string: '', number: 0, boolean: false, object: {}, array: [] };
  const isArr = kind.value === 'array';
  if (!isArr && !newKey.value.trim()) return;
  const ok = store.add(props.path, isArr ? null : newKey.value.trim(), init[newType.value]);
  if (!ok) return app.toast('err', 'Clé déjà présente', newKey.value);
  adding.value = false;
  newKey.value = '';
  collapsed.value = false;
}

// ---- renommage ----
const editingKey = ref(false);
const keyDraft = ref('');
function startRename(): void {
  if (typeof key.value !== 'string') return;
  keyDraft.value = key.value;
  editingKey.value = true;
}
function confirmRename(): void {
  editingKey.value = false;
  const k = keyDraft.value.trim();
  if (!k || k === key.value) return;
  if (!store.rename(props.path, k)) app.toast('err', 'Clé déjà présente', k);
}
function removeMe(): void {
  if (isContainer.value && children.value.length && !confirm(`Supprimer « ${key.value} » et son contenu ?`)) return;
  store.remove(props.path);
}
async function copyValue(): Promise<void> {
  await navigator.clipboard.writeText(typeof props.value === 'string' ? props.value : JSON.stringify(props.value));
  app.toast('ok', 'Copié');
}
const TYPE_LABEL: Record<string, string> = { string: 'texte', number: 'nombre', boolean: 'booléen', null: 'nul', object: 'objet', array: 'liste' };
</script>

<template>
  <div class="group/row">
    <!-- Ligne -->
    <div class="flex items-center gap-2 py-1 rounded-lg hover:bg-surface-2/60 px-1 -mx-1" :style="{ paddingLeft: `${depth * 18}px` }">
      <button v-if="isContainer" class="h-5 w-5 flex items-center justify-center text-muted hover:text-text" @click="collapsed = !collapsed">
        <ChevronRight class="h-4 w-4 transition-transform" :class="open && 'rotate-90'" />
      </button>
      <span v-else class="w-5" />

      <!-- Clé -->
      <input v-if="editingKey" v-model="keyDraft" class="input py-0.5 px-1.5 !w-56 font-mono text-xs" v-focus @keydown.enter="confirmRename" @keydown.escape="editingKey = false" @blur="confirmRename" />
      <button v-else class="font-mono text-sm text-left truncate max-w-[40%] shrink-0" :class="typeof key === 'number' ? 'text-muted' : 'text-text'" :title="typeof key === 'string' ? 'Renommer' : ''" @dblclick="startRename">
        {{ typeof key === 'number' ? `[${key}]` : key }}
      </button>

      <!-- Valeur -->
      <template v-if="isContainer">
        <span class="chip bg-surface-3 text-muted shrink-0">{{ TYPE_LABEL[kind] }} · {{ Array.isArray(value) ? value.length : Object.keys(value as object).length }}</span>
        <span v-if="!open && summary" class="text-sm text-text-2 truncate min-w-0" :title="summary">{{ summary }}</span>
        <span class="flex-1" />
        <button class="btn-ghost px-2 py-1 text-xs opacity-0 group-hover/row:opacity-100 focus:opacity-100" @click="adding = !adding"><Plus class="h-3.5 w-3.5" /> {{ Array.isArray(value) ? 'élément' : 'clé' }}</button>
      </template>
      <template v-else-if="kind === 'boolean'">
        <button type="button" class="toggle" :class="value ? 'bg-accent' : 'bg-surface-3'" @click="store.set(path, !value)"><span class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" :class="value ? 'translate-x-5' : 'translate-x-0'" /></button>
        <span class="flex-1" />
      </template>
      <template v-else-if="kind === 'null'">
        <span class="text-muted italic text-sm">null</span>
        <span class="flex-1" />
      </template>
      <template v-else>
        <input
          class="input py-1 px-2 font-mono text-xs flex-1 min-w-0"
          :type="shown ? (kind === 'number' ? 'number' : 'text') : 'password'"
          :value="value as string | number"
          :step="kind === 'number' ? 'any' : undefined"
          autocomplete="off"
          @input="onInput(($event.target as HTMLInputElement).value)"
        />
        <button v-if="secret" class="btn-icon btn-ghost p-1" :title="shown ? 'Masquer' : 'Afficher'" @click="store.toggleReveal(pathKey)"><component :is="shown ? EyeOff : Eye" class="h-3.5 w-3.5" /></button>
        <button class="btn-icon btn-ghost p-1 opacity-0 group-hover/row:opacity-100" title="Copier la valeur" @click="copyValue"><Copy class="h-3.5 w-3.5" /></button>
      </template>

      <!-- Type + suppression -->
      <select class="input py-0.5 px-1 !w-20 shrink-0 text-[11px] opacity-0 group-hover/row:opacity-100 focus:opacity-100" :value="kind" title="Type" @change="changeType(($event.target as HTMLSelectElement).value)">
        <option v-for="(l, t) in TYPE_LABEL" :key="t" :value="t">{{ l }}</option>
      </select>
      <button class="btn-icon btn-ghost p-1 text-muted hover:text-err opacity-0 group-hover/row:opacity-100 focus:opacity-100" title="Supprimer" @click="removeMe"><Trash2 class="h-3.5 w-3.5" /></button>
    </div>

    <!-- Formulaire d'ajout -->
    <div v-if="adding && isContainer" class="flex items-center gap-2 py-1.5" :style="{ paddingLeft: `${(depth + 1) * 18 + 4}px` }">
      <input v-if="!Array.isArray(value)" v-model="newKey" class="input py-1 px-2 font-mono text-xs !w-56" placeholder="NOM_DE_LA_CLE" v-focus @keydown.enter="confirmAdd" @keydown.escape="adding = false" />
      <select v-model="newType" class="input py-1 px-2 !w-28 text-xs">
        <option value="string">texte</option><option value="number">nombre</option><option value="boolean">booléen</option><option value="object">objet</option><option value="array">liste</option>
      </select>
      <button class="btn-primary py-1 px-3 text-xs" @click="confirmAdd">Ajouter</button>
      <button class="btn-ghost py-1 px-2 text-xs" @click="adding = false">Annuler</button>
    </div>

    <!-- Enfants -->
    <template v-if="isContainer && open">
      <VarNode v-for="[k] in children" :key="String(k)" :value="(value as Record<string, JsonValue>)[k as string]" :path="[...path, k]" :filter="filter" :depth="depth + 1" />
      <div v-if="!children.length" class="text-xs text-muted py-1" :style="{ paddingLeft: `${(depth + 1) * 18 + 4}px` }">{{ filter ? 'aucune correspondance' : 'vide' }}</div>
    </template>
  </div>
</template>
