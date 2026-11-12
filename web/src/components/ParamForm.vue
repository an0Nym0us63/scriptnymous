<script setup lang="ts">
// Formulaire généré depuis les paramètres déclarés. v-model : Record<string, unknown> ; fichiers : File.
import { onMounted, reactive } from 'vue';
import { api, type ParamSpec } from '@/lib/api';

/** `slug` permet de charger les listes dynamiques (`choices_from: table.colonne`) depuis la mini-app du script. */
const props = defineProps<{ params: ParamSpec[]; modelValue: Record<string, unknown>; compact?: boolean; slug?: string }>();
const emit = defineEmits<{ 'update:modelValue': [v: Record<string, unknown>] }>();

const dynamic = reactive<Record<string, string[]>>({});
const optionsOf = (p: ParamSpec): (string | number)[] => (p.choices_from ? (dynamic[p.name] ?? []) : (p.choices ?? []));
async function loadDynamic(): Promise<void> {
  if (!props.slug) return;
  await Promise.all(
    props.params
      .filter((p) => p.choices_from)
      .map(async (p) => {
        try {
          const r = await api.get<{ choices: string[] }>(`/api/scripts/${encodeURIComponent(props.slug!)}/params/${encodeURIComponent(p.name)}/choices`);
          dynamic[p.name] = r.choices;
        } catch {
          dynamic[p.name] = [];
        }
      }),
  );
}

const set = (name: string, v: unknown) => emit('update:modelValue', { ...props.modelValue, [name]: v });
const toggleMulti = (name: string, choice: string) => {
  const cur = Array.isArray(props.modelValue[name]) ? [...(props.modelValue[name] as string[])] : [];
  const i = cur.indexOf(choice);
  if (i >= 0) cur.splice(i, 1);
  else cur.push(choice);
  set(name, cur);
};
onMounted(() => {
  // Pré-remplit avec les valeurs par défaut.
  const init: Record<string, unknown> = { ...props.modelValue };
  for (const p of props.params) if (init[p.name] === undefined && p.default !== undefined) init[p.name] = p.default;
  for (const p of props.params) if (init[p.name] === undefined && p.type === 'boolean') init[p.name] = false;
  emit('update:modelValue', init);
  void loadDynamic();
});
</script>

<template>
  <div class="grid gap-4" :class="compact ? 'md:grid-cols-2' : ''">
    <div v-for="p in params" :key="p.name" :class="p.type === 'boolean' && 'flex items-center gap-3'">
      <template v-if="p.type === 'boolean'">
        <button
          type="button"
          class="toggle"
          :class="modelValue[p.name] ? 'bg-accent' : 'bg-surface-3'"
          role="switch"
          :aria-checked="!!modelValue[p.name]"
          @click="set(p.name, !modelValue[p.name])"
        >
          <span class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" :class="modelValue[p.name] ? 'translate-x-5' : 'translate-x-0'" />
        </button>
        <div>
          <div class="text-sm font-medium">{{ p.label || p.name }}</div>
          <div v-if="p.description" class="text-xs text-muted">{{ p.description }}</div>
        </div>
      </template>

      <template v-else>
        <label class="label">{{ p.label || p.name }} <span v-if="p.required" class="text-err">*</span></label>

        <select v-if="p.type === 'choice'" class="input" :value="modelValue[p.name] ?? ''" @change="set(p.name, ($event.target as HTMLSelectElement).value)">
          <option v-if="!p.required" value="">—</option>
          <option v-for="c in optionsOf(p)" :key="String(c)" :value="String(c)">{{ c }}</option>
        </select>

        <div v-else-if="p.type === 'multichoice'" class="flex flex-wrap gap-2">
          <button
            v-for="c in optionsOf(p)"
            :key="String(c)"
            type="button"
            class="chip border transition"
            :class="(modelValue[p.name] as string[] | undefined)?.includes(String(c)) ? 'bg-accent-soft text-accent-2 border-accent/50' : 'bg-surface-2 text-text-2 border-border hover:border-border-strong'"
            @click="toggleMulti(p.name, String(c))"
          >
            {{ c }}
          </button>
        </div>

        <input
          v-else-if="p.type === 'number'"
          type="number"
          class="input"
          :min="p.min"
          :max="p.max"
          :placeholder="p.placeholder"
          :value="modelValue[p.name] ?? ''"
          @input="set(p.name, ($event.target as HTMLInputElement).value)"
        />

        <input
          v-else-if="p.type === 'file'"
          type="file"
          class="input file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:text-accent-2 file:px-3 file:py-1 file:text-xs"
          @change="set(p.name, ($event.target as HTMLInputElement).files?.[0] ?? null)"
        />

        <!-- Texte avec liste dynamique : saisie libre + suggestions filtrées au fil de la frappe -->
        <template v-else-if="p.choices_from">
          <input
            type="text"
            class="input"
            :list="`dl-${p.name}`"
            autocomplete="off"
            :placeholder="p.placeholder || (dynamic[p.name]?.length ? `${dynamic[p.name].length} valeur(s) : tapez pour filtrer` : undefined)"
            :value="modelValue[p.name] ?? ''"
            @input="set(p.name, ($event.target as HTMLInputElement).value)"
          />
          <datalist :id="`dl-${p.name}`">
            <option v-for="c in dynamic[p.name] ?? []" :key="c" :value="c" />
          </datalist>
        </template>

        <input
          v-else
          :type="p.type === 'secret' ? 'password' : 'text'"
          class="input"
          :autocomplete="p.type === 'secret' ? 'off' : undefined"
          :placeholder="p.placeholder"
          :value="modelValue[p.name] ?? ''"
          @input="set(p.name, ($event.target as HTMLInputElement).value)"
        />
        <div v-if="p.description" class="text-xs text-muted mt-1">{{ p.description }}</div>
      </template>
    </div>
    <div v-if="!params.length" class="text-sm text-muted">Ce script n'a pas de paramètre.</div>
  </div>
</template>
