<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { useApp } from '@/stores/app';
const app = useApp();
const tone = (k: string) => (k === 'ok' ? 'border-ok/40' : k === 'err' ? 'border-err/40' : k === 'warn' ? 'border-warn/40' : 'border-info/40');
const dot = (k: string) => (k === 'ok' ? 'bg-ok' : k === 'err' ? 'bg-err' : k === 'warn' ? 'bg-warn' : 'bg-info');
</script>

<template>
  <div class="fixed z-50 bottom-20 md:bottom-6 right-4 left-4 md:left-auto md:w-96 space-y-2 pointer-events-none">
    <TransitionGroup name="fade">
      <div v-for="t in app.toasts" :key="t.id" class="card pointer-events-auto flex items-start gap-3 px-4 py-3 border" :class="tone(t.kind)">
        <span class="mt-1.5 h-2 w-2 rounded-full shrink-0" :class="dot(t.kind)" />
        <div class="flex-1 min-w-0">
          <component :is="t.to ? 'RouterLink' : 'div'" :to="t.to" class="font-medium text-sm block truncate" :class="t.to && 'hover:underline'">{{ t.title }}</component>
          <div v-if="t.text" class="text-xs text-text-2 mt-0.5">{{ t.text }}</div>
        </div>
        <button class="text-muted hover:text-text" @click="app.dismiss(t.id)"><X class="h-4 w-4" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>
