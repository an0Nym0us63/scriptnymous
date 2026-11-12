<script setup lang="ts">
import { computed } from 'vue';
import { Play, Square, Clock, AlertTriangle, Package, Loader2 } from 'lucide-vue-next';
import type { ScriptItem } from '@/lib/api';
import { relative, STATUS, toneClasses, duration, ENV_STATUS } from '@/lib/format';
import AppIcon from './AppIcon.vue';

const props = defineProps<{ script: ScriptItem; now: number }>();
const emit = defineEmits<{ launch: [s: ScriptItem]; stop: [runId: string] }>();

const isRunning = computed(() => props.script.running.length > 0);
const next = computed(() => props.script.next_runs[0]?.nextAt ?? null);
const last = computed(() => props.script.last_run);
const envTone = computed(() => ENV_STATUS[props.script.env_status]);
const blocked = computed(() => props.script.status !== 'ok' || (props.script.env_status !== 'none' && props.script.env_status !== 'ready'));
</script>

<template>
  <RouterLink :to="`/scripts/${script.slug}`" class="card group relative flex min-w-0 flex-col overflow-hidden p-4 transition hover:border-border-strong hover:-translate-y-0.5" :class="script.status !== 'ok' && 'opacity-80'">
    <div class="absolute inset-x-0 top-0 h-1 rounded-t-2xl" :style="{ background: script.spec.color }" />
    <div class="flex items-start gap-3">
      <div class="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center text-white" :style="{ background: script.spec.color }">
        <AppIcon :name="script.spec.icon" :size="20" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="font-semibold truncate">{{ script.name }}</div>
        <div class="text-xs text-muted truncate">{{ script.spec.description || script.slug }}</div>
      </div>
      <button
        v-if="isRunning"
        class="btn-icon bg-err-soft text-err hover:brightness-110"
        title="Arrêter"
        @click.prevent.stop="emit('stop', script.running[0].id)"
      >
        <Square class="h-4 w-4" />
      </button>
      <button v-else class="btn-icon btn-primary" :disabled="blocked" title="Lancer" @click.prevent.stop="emit('launch', script)"><Play class="h-4 w-4" /></button>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-2 text-xs">
      <span v-if="script.status === 'missing'" class="chip bg-err-soft text-err"><AlertTriangle class="h-3 w-3" /> introuvable</span>
      <span v-else-if="script.status === 'invalid'" class="chip bg-err-soft text-err" :title="script.spec_error ?? ''"><AlertTriangle class="h-3 w-3" /> YAML invalide</span>
      <span v-else-if="isRunning" class="chip bg-accent-soft text-accent-2"><span class="h-1.5 w-1.5 rounded-full bg-current live-dot" /> en cours · {{ duration(script.running[0].started_at, null, now) }}</span>
      <span v-else-if="last" class="chip" :class="toneClasses(STATUS[last.status].tone)">{{ STATUS[last.status].label }} · {{ relative(last.finished_at ?? last.started_at, now) }}</span>
      <span v-else class="chip bg-surface-3 text-muted">jamais lancé</span>

      <span v-if="script.env_status !== 'none'" class="chip" :class="toneClasses(envTone.tone)" :title="`Environnement : ${envTone.label}`">
        <Loader2 v-if="script.env_status === 'installing'" class="h-3 w-3 animate-spin" /><Package v-else class="h-3 w-3" /> {{ envTone.label }}
      </span>
      <span v-if="script.queued" class="chip bg-info-soft text-info">{{ script.queued }} en file</span>
      <template v-if="script.app_summary">
        <span v-if="script.app_summary.by_status.error" class="chip bg-err-soft text-err">{{ script.app_summary.by_status.error }} en erreur</span>
        <span v-if="script.app_summary.by_status.pending" class="chip bg-info-soft text-info">{{ script.app_summary.by_status.pending }} en attente</span>
        <span v-if="script.app_summary.by_status.warn" class="chip bg-warn-soft text-warn">{{ script.app_summary.by_status.warn }} à voir</span>
      </template>
      <span class="flex-1" />
      <span v-if="next" class="inline-flex items-center gap-1 text-muted" :title="new Date(next).toLocaleString('fr-FR')"><Clock class="h-3 w-3" /> {{ relative(next, now) }}</span>
    </div>
  </RouterLink>
</template>
