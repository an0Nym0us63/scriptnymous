<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { onBeforeUnmount, onMounted } from 'vue';
defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close');
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-40 flex items-end md:items-center justify-center p-0 md:p-6 bg-black/50 backdrop-blur-sm" @click.self="emit('close')">
      <div class="card w-full md:max-w-lg max-h-[92vh] flex flex-col rounded-b-none md:rounded-2xl" :class="wide && 'md:max-w-3xl'">
        <div class="flex items-center gap-3 px-5 py-4 border-b border-border">
          <h2 class="font-semibold">{{ title }}</h2>
          <span class="flex-1" />
          <button class="btn-icon btn-ghost" @click="emit('close')"><X class="h-4 w-4" /></button>
        </div>
        <div class="px-5 py-4 overflow-y-auto"><slot /></div>
        <div v-if="$slots.footer" class="px-5 py-3 border-t border-border flex items-center justify-end gap-2"><slot name="footer" /></div>
      </div>
    </div>
  </Teleport>
</template>
