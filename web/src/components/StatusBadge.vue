<script setup lang="ts">
import { computed } from 'vue';
import type { RunStatus } from '@/lib/api';
import { STATUS, toneClasses } from '@/lib/format';
const props = defineProps<{ status: RunStatus; small?: boolean }>();
const meta = computed(() => STATUS[props.status] ?? { label: props.status, tone: 'muted' });
</script>

<template>
  <span class="chip" :class="[toneClasses(meta.tone), small ? 'text-[10px] px-1.5' : '']">
    <span v-if="status === 'running'" class="h-1.5 w-1.5 rounded-full bg-current live-dot" />
    {{ meta.label }}
  </span>
</template>
