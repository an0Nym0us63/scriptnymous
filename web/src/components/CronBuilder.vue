<script setup lang="ts">
// Assistant de planification : traduit une expression cron (5 champs) en formulaire et inversement.
// Modes : minutes, heures, quotidien (avec jours de semaine), mensuel, avancé (expression brute + modèles).
import { computed, ref, watch } from 'vue';
import { describeCron } from '@/lib/format';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [v: string] }>();

type Mode = 'minutes' | 'hours' | 'daily' | 'monthly' | 'advanced';
const mode = ref<Mode>('daily');
const everyMinutes = ref(15);
const everyHours = ref(1);
const atMinute = ref(0);
const hour = ref(8);
const minute = ref(0);
const days = ref<number[]>([]); // 0 = dimanche … 6 = samedi ; vide = tous les jours
const dayOfMonth = ref(1);
const raw = ref(props.modelValue || '0 8 * * *');

const DAYS = [
  { n: 1, l: 'lun' }, { n: 2, l: 'mar' }, { n: 3, l: 'mer' }, { n: 4, l: 'jeu' }, { n: 5, l: 'ven' }, { n: 6, l: 'sam' }, { n: 0, l: 'dim' },
];
const PRESETS: { label: string; cron: string }[] = [
  { label: 'Toutes les 5 minutes', cron: '*/5 * * * *' },
  { label: 'Toutes les heures', cron: '0 * * * *' },
  { label: 'Tous les jours à 8h', cron: '0 8 * * *' },
  { label: 'En semaine à 8h', cron: '0 8 * * 1-5' },
  { label: 'Le week-end à 10h', cron: '0 10 * * 0,6' },
  { label: 'Chaque nuit à 3h', cron: '0 3 * * *' },
  { label: 'Deux fois par jour (8h et 20h)', cron: '0 8,20 * * *' },
  { label: 'Le 1er du mois à 6h', cron: '0 6 1 * *' },
  { label: 'Le dimanche à 4h', cron: '0 4 * * 0' },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Expression générée depuis le formulaire. */
function build(): string {
  switch (mode.value) {
    case 'minutes':
      return `*/${Math.max(1, Math.min(59, everyMinutes.value || 1))} * * * *`;
    case 'hours':
      return `${atMinute.value || 0} ${everyHours.value > 1 ? `*/${Math.min(23, everyHours.value)}` : '*'} * * *`;
    case 'daily':
      return `${minute.value} ${hour.value} * * ${days.value.length && days.value.length < 7 ? daysExpr(days.value) : '*'}`;
    case 'monthly':
      return `${minute.value} ${hour.value} ${dayOfMonth.value} * *`;
    default:
      return raw.value;
  }
}
function daysExpr(list: number[]): string {
  const s = [...list].sort((a, b) => a - b);
  if (s.join(',') === '1,2,3,4,5') return '1-5';
  if (s.join(',') === '0,6') return '0,6';
  return s.join(',');
}
function parseDays(field: string): number[] | null {
  if (field === '*') return [];
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const m = /^(\d)(?:-(\d))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    for (let d = a; d <= b; d++) out.add(d === 7 ? 0 : d);
  }
  return [...out];
}

/** Tente de lire une expression dans le formulaire ; sinon bascule en avancé. */
function parse(expr: string): void {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return void (mode.value = 'advanced');
  const [mi, h, dom, mon, dow] = f;
  let m: RegExpExecArray | null;
  if ((m = /^\*\/(\d+)$/.exec(mi)) && h === '*' && dom === '*' && mon === '*' && dow === '*') {
    mode.value = 'minutes';
    everyMinutes.value = Number(m[1]);
    return;
  }
  if (/^\d+$/.test(mi) && (h === '*' || /^\*\/\d+$/.test(h)) && dom === '*' && mon === '*' && dow === '*') {
    mode.value = 'hours';
    atMinute.value = Number(mi);
    everyHours.value = h === '*' ? 1 : Number(h.slice(2));
    return;
  }
  if (/^\d+$/.test(mi) && /^\d+$/.test(h) && dom === '*' && mon === '*') {
    const d = parseDays(dow);
    if (d) {
      mode.value = 'daily';
      minute.value = Number(mi);
      hour.value = Number(h);
      days.value = d;
      return;
    }
  }
  if (/^\d+$/.test(mi) && /^\d+$/.test(h) && /^\d+$/.test(dom) && mon === '*' && dow === '*') {
    mode.value = 'monthly';
    minute.value = Number(mi);
    hour.value = Number(h);
    dayOfMonth.value = Number(dom);
    return;
  }
  mode.value = 'advanced';
}

parse(raw.value);
let internal = false;
watch([mode, everyMinutes, everyHours, atMinute, hour, minute, days, dayOfMonth], () => {
  if (mode.value === 'advanced') return;
  const v = build();
  raw.value = v;
  internal = true;
  emit('update:modelValue', v);
}, { deep: true });
watch(raw, (v) => {
  if (mode.value !== 'advanced') return;
  internal = true;
  emit('update:modelValue', v);
});
watch(
  () => props.modelValue,
  (v) => {
    if (internal) return void (internal = false);
    if (v && v !== raw.value) {
      raw.value = v;
      parse(v);
    }
  },
);
function setMode(m: Mode): void {
  if (m === 'advanced') raw.value = build();
  mode.value = m;
}
function toggleDay(n: number): void {
  days.value = days.value.includes(n) ? days.value.filter((d) => d !== n) : [...days.value, n];
}
function applyPreset(cron: string): void {
  raw.value = cron;
  parse(cron);
  if (mode.value === 'advanced') emit('update:modelValue', cron);
}
const description = computed(() => describeCron(raw.value));
const hours = Array.from({ length: 24 }, (_, i) => i);
const minutes = [0, 5, 10, 15, 20, 30, 40, 45, 50];
</script>

<template>
  <div class="rounded-xl border border-border bg-bg-elev p-3 space-y-3">
    <div class="flex flex-wrap gap-1">
      <button v-for="m in ([['minutes', 'Toutes les N min'], ['hours', 'Toutes les N h'], ['daily', 'Chaque jour'], ['monthly', 'Chaque mois'], ['advanced', 'Avancé']] as [Mode, string][])" :key="m[0]" type="button" class="btn px-3 py-1.5 text-xs" :class="mode === m[0] ? 'bg-accent-soft text-accent-2' : 'text-text-2 hover:bg-surface-2'" @click="setMode(m[0])">{{ m[1] }}</button>
    </div>

    <div v-if="mode === 'minutes'" class="flex items-center gap-2 text-sm">
      Toutes les <input v-model.number="everyMinutes" type="number" min="1" max="59" class="input !w-20 py-1" /> minutes
    </div>

    <div v-else-if="mode === 'hours'" class="flex flex-wrap items-center gap-2 text-sm">
      Toutes les <input v-model.number="everyHours" type="number" min="1" max="23" class="input !w-20 py-1" /> heure(s), à la minute
      <select v-model.number="atMinute" class="input !w-20 py-1"><option v-for="mn in minutes" :key="mn" :value="mn">:{{ pad(mn) }}</option></select>
    </div>

    <div v-else-if="mode === 'daily'" class="space-y-2 text-sm">
      <div class="flex items-center gap-2">
        À <select v-model.number="hour" class="input !w-20 py-1"><option v-for="h in hours" :key="h" :value="h">{{ pad(h) }} h</option></select>
        <select v-model.number="minute" class="input !w-20 py-1"><option v-for="mn in minutes" :key="mn" :value="mn">:{{ pad(mn) }}</option></select>
        <input v-model.number="minute" type="number" min="0" max="59" class="input !w-16 py-1 text-xs" title="Minute précise" />
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-muted mr-1">Jours :</span>
        <button v-for="d in DAYS" :key="d.n" type="button" class="chip border px-2.5 py-1 transition" :class="days.includes(d.n) ? 'bg-accent-soft text-accent-2 border-accent/50' : 'bg-surface-2 text-text-2 border-border'" @click="toggleDay(d.n)">{{ d.l }}</button>
        <button type="button" class="text-xs text-muted hover:text-text ml-1" @click="days = []">tous</button>
        <button type="button" class="text-xs text-muted hover:text-text" @click="days = [1, 2, 3, 4, 5]">semaine</button>
        <button type="button" class="text-xs text-muted hover:text-text" @click="days = [0, 6]">week-end</button>
      </div>
    </div>

    <div v-else-if="mode === 'monthly'" class="flex flex-wrap items-center gap-2 text-sm">
      Le <input v-model.number="dayOfMonth" type="number" min="1" max="31" class="input !w-16 py-1" /> de chaque mois à
      <select v-model.number="hour" class="input !w-20 py-1"><option v-for="h in hours" :key="h" :value="h">{{ pad(h) }} h</option></select>
      <select v-model.number="minute" class="input !w-20 py-1"><option v-for="mn in minutes" :key="mn" :value="mn">:{{ pad(mn) }}</option></select>
      <span class="text-xs text-muted">(un jour > 28 est ignoré les mois trop courts)</span>
    </div>

    <div v-else class="space-y-2">
      <input v-model="raw" class="input font-mono" placeholder="min heure jour mois jour-semaine" />
      <div class="grid grid-cols-5 gap-1 text-[10px] text-muted text-center font-mono">
        <span>minute<br />0-59</span><span>heure<br />0-23</span><span>jour<br />1-31</span><span>mois<br />1-12</span><span>jour sem.<br />0-6 (0=dim)</span>
      </div>
      <div class="text-xs text-muted">Syntaxes : <span class="kbd">*</span> tous, <span class="kbd">*/5</span> tous les 5, <span class="kbd">1-5</span> plage, <span class="kbd">8,20</span> liste.</div>
    </div>

    <div class="flex flex-wrap items-center gap-2 pt-1 border-t border-border">
      <span class="font-mono text-xs text-accent-2">{{ raw }}</span>
      <span class="text-xs text-text-2">· {{ description }}</span>
      <span class="flex-1" />
      <select class="input !w-auto py-1 text-xs" :value="''" @change="applyPreset(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
        <option value="" disabled>Modèles…</option>
        <option v-for="p in PRESETS" :key="p.cron" :value="p.cron">{{ p.label }}</option>
      </select>
    </div>
  </div>
</template>
