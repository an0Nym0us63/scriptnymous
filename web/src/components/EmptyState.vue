<script setup lang="ts">
defineProps<{ title: string; text?: string }>();
</script>

<template>
  <div class="card px-6 py-12 text-center">
    <div class="mx-auto mb-3 h-12 w-12 rounded-2xl bg-accent-soft flex items-center justify-center text-accent-2"><slot name="icon" /></div>
    <div class="font-semibold">{{ title }}</div>
    <p v-if="text" class="text-sm text-text-2 mt-1 max-w-md mx-auto">{{ text }}</p>
    <div v-if="$slots.default" class="mt-4 flex justify-center gap-2"><slot /></div>
  </div>
</template>
