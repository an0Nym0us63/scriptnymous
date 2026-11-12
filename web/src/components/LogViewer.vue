<script setup lang="ts">
// Journal d'un run : charge l'existant par HTTP, puis suit la sortie en direct par websocket. Couleurs ANSI, auto-défilement.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AnsiUp } from 'ansi_up';
import { ArrowDownToLine, Download, WrapText } from 'lucide-vue-next';
import { api } from '@/lib/api';
import { onWs, subscribeRun } from '@/lib/ws';

const props = defineProps<{ runId: string; live: boolean }>();
const ansi = new AnsiUp();
ansi.use_classes = false;

const chunks = ref<string[]>([]);
const offset = ref(0);
const follow = ref(true);
const wrap = ref(true);
const box = ref<HTMLElement | null>(null);
let unsubWs: (() => void) | null = null;
let unsubRun: (() => void) | null = null;
let pollTimer: number | null = null;
let rendered = '';

const MAX_CHARS = 2_000_000;

function escapeLine(s: string): string {
  // Les lignes « [scriptnymous] » sont stylées à part.
  return s
    .split('\n')
    .map((l) => (l.startsWith('[scriptnymous]') ? `<span class="sys">${ansi.ansi_to_html(l)}</span>` : ansi.ansi_to_html(l)))
    .join('\n');
}

const html = computed(() => {
  // Recalcule par morceaux pour rester fluide sur les gros journaux.
  rendered = chunks.value.map(escapeLine).join('');
  return rendered;
});

async function loadInitial(): Promise<void> {
  const r = await api.get<{ text: string; offset: number; size: number }>(`/api/runs/${props.runId}/log?tail=1`);
  chunks.value = r.text ? [r.text] : [];
  offset.value = r.offset;
  await scrollToBottom();
}

/** Complète ce qui a pu arriver entre le chargement initial et l'abonnement websocket. */
async function pollMore(): Promise<void> {
  try {
    const r = await api.get<{ text: string; offset: number }>(`/api/runs/${props.runId}/log?from=${offset.value}`);
    if (r.text) {
      append(r.text);
      offset.value = r.offset;
    }
  } catch {
    /* run supprimé */
  }
}

function append(text: string): void {
  chunks.value.push(text);
  // Garde une borne mémoire : on tronque le début.
  let total = 0;
  for (const c of chunks.value) total += c.length;
  while (total > MAX_CHARS && chunks.value.length > 1) total -= chunks.value.shift()!.length;
  void scrollToBottom();
}

async function scrollToBottom(): Promise<void> {
  if (!follow.value) return;
  await nextTick();
  if (box.value) box.value.scrollTop = box.value.scrollHeight;
}

function onScroll(): void {
  const el = box.value;
  if (!el) return;
  follow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

onMounted(async () => {
  await loadInitial();
  unsubRun = subscribeRun(props.runId);
  unsubWs = onWs((m) => {
    if (m.type === 'run:output' && m.runId === props.runId) {
      append(m.chunk as string);
      offset.value += new TextEncoder().encode(m.chunk as string).length;
    }
  });
  if (props.live) pollTimer = window.setInterval(pollMore, 4000);
  void pollMore();
});
watch(
  () => props.live,
  async (v) => {
    if (!v) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      await pollMore();
    }
  },
);
onBeforeUnmount(() => {
  unsubWs?.();
  unsubRun?.();
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <div class="relative">
    <div class="absolute right-3 top-3 z-10 flex gap-1">
      <button class="btn-icon bg-surface-2/80 text-text-2 hover:text-text" :class="wrap && 'text-accent-2'" title="Retour à la ligne" @click="wrap = !wrap"><WrapText class="h-4 w-4" /></button>
      <button class="btn-icon bg-surface-2/80 text-text-2 hover:text-text" :class="follow && 'text-accent-2'" title="Suivre la sortie" @click="follow = !follow; scrollToBottom()"><ArrowDownToLine class="h-4 w-4" /></button>
      <a class="btn-icon bg-surface-2/80 text-text-2 hover:text-text" title="Télécharger le journal" :href="`/api/runs/${runId}/log/download`"><Download class="h-4 w-4" /></a>
    </div>
    <pre ref="box" class="terminal p-4 pr-28 min-h-[240px] max-h-[70vh]" :class="wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'" @scroll="onScroll" v-html="html || '<span class=&quot;sys&quot;>En attente de sortie…</span>'" />
  </div>
</template>
