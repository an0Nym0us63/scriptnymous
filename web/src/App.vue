<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { LayoutDashboard, History, CalendarClock, Settings, Sun, Moon, LogOut, Plus, Wifi, WifiOff, Activity } from 'lucide-vue-next';
import { useApp } from '@/stores/app';
import { useScripts } from '@/stores/scripts';
import { wsConnected } from '@/lib/ws';
import Toasts from '@/components/Toasts.vue';
const ActivityPanel = defineAsyncComponent(() => import('@/components/ActivityPanel.vue'));
const activityOpen = ref(false);

const app = useApp();
const scripts = useScripts();
const route = useRoute();

const nav = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, exact: true },
  { to: '/runs', label: 'Historique', icon: History },
  { to: '/schedules', label: 'Planifications', icon: CalendarClock },
  { to: '/settings', label: 'Réglages', icon: Settings },
];
const isActive = (item: { to: string; exact?: boolean }) => (item.exact ? route.path === item.to : route.path.startsWith(item.to));
const showShell = computed(() => app.authenticated && route.name !== 'login');

watch(
  () => app.authenticated,
  (v) => {
    if (v) {
      scripts.bindWs();
      void scripts.load();
    }
  },
  { immediate: true },
);
onMounted(() => {
  // Rafraîchit les données quand l'application PWA revient au premier plan.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.authenticated) scripts.scheduleReload(0);
  });
});
</script>

<template>
  <div v-if="showShell" class="min-h-full md:flex">
    <!-- Barre latérale (desktop) -->
    <aside class="hidden md:flex md:w-64 shrink-0 flex-col border-r border-border bg-bg-elev sticky top-0 h-screen">
      <RouterLink to="/" class="flex items-center gap-3 px-5 h-16 border-b border-border">
        <img src="/favicon.svg" alt="" class="h-8 w-8" />
        <div class="leading-tight">
          <div class="font-semibold tracking-tight">ScriptNymous</div>
          <div class="text-[11px] text-muted">vos scripts, en direct</div>
        </div>
      </RouterLink>
      <nav class="flex-1 px-3 py-4 space-y-1">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition"
          :class="isActive(item) ? 'bg-accent-soft text-accent-2' : 'text-text-2 hover:bg-surface-2 hover:text-text'"
        >
          <component :is="item.icon" class="h-[18px] w-[18px]" />
          {{ item.label }}
        </RouterLink>
        <button class="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition text-text-2 hover:bg-surface-2 hover:text-text" @click="activityOpen = true">
          <Activity class="h-[18px] w-[18px]" :class="scripts.activityCount ? 'text-accent-2' : ''" />
          Activité
          <span v-if="scripts.activityCount" class="ml-auto chip bg-accent-soft text-accent-2"><span class="h-1.5 w-1.5 rounded-full bg-current live-dot" /> {{ scripts.activityCount }}</span>
        </button>
        <RouterLink to="/scripts/new" class="btn-primary w-full mt-4"><Plus class="h-4 w-4" /> Nouveau script</RouterLink>
      </nav>
      <div class="px-3 py-3 border-t border-border flex items-center gap-1">
        <span class="chip" :class="wsConnected ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'" :title="wsConnected ? 'Temps réel connecté' : 'Temps réel déconnecté'">
          <component :is="wsConnected ? Wifi : WifiOff" class="h-3 w-3" /> {{ wsConnected ? 'direct' : 'hors ligne' }}
        </span>
        <span class="flex-1" />
        <button class="btn-icon btn-ghost" :title="app.theme === 'dark' ? 'Thème clair' : 'Thème sombre'" @click="app.toggleTheme()">
          <component :is="app.theme === 'dark' ? Sun : Moon" class="h-4 w-4" />
        </button>
        <button class="btn-icon btn-ghost" title="Se déconnecter" @click="app.logout()"><LogOut class="h-4 w-4" /></button>
      </div>
    </aside>

    <!-- Contenu -->
    <div class="flex-1 min-w-0 flex flex-col">
      <header class="md:hidden sticky top-0 z-20 flex items-center gap-3 px-4 h-14 border-b border-border bg-bg-elev/90 backdrop-blur">
        <RouterLink to="/" class="flex items-center gap-2"><img src="/favicon.svg" alt="" class="h-7 w-7" /><span class="font-semibold">ScriptNymous</span></RouterLink>
        <span class="flex-1" />
        <span class="h-2 w-2 rounded-full" :class="wsConnected ? 'bg-ok' : 'bg-warn'" />
        <button class="btn-icon btn-ghost relative" @click="activityOpen = true">
          <Activity class="h-4 w-4" :class="scripts.activityCount ? 'text-accent-2' : ''" />
          <span v-if="scripts.activityCount" class="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-accent text-white text-[10px] leading-4 text-center">{{ scripts.activityCount }}</span>
        </button>
        <button class="btn-icon btn-ghost" @click="app.toggleTheme()"><component :is="app.theme === 'dark' ? Sun : Moon" class="h-4 w-4" /></button>
        <button class="btn-icon btn-ghost" @click="app.logout()"><LogOut class="h-4 w-4" /></button>
      </header>

      <main class="flex-1 px-4 md:px-8 py-5 md:py-8 pb-24 md:pb-10 max-w-7xl w-full mx-auto">
        <div v-if="!scripts.dirAvailable && scripts.loaded" class="mb-5 card border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn flex items-center gap-3">
          <span class="font-semibold">Dossier des scripts inaccessible.</span>
          <span class="text-text-2">Le partage n'est pas monté ou est vide : les scripts connus passent en « introuvable » et leurs planifications sont suspendues. Rien n'est supprimé.</span>
        </div>
        <RouterView v-slot="{ Component }">
          <Transition name="fade" mode="out-in"><component :is="Component" /></Transition>
        </RouterView>
      </main>

      <!-- Navigation basse (mobile) -->
      <nav class="md:hidden fixed bottom-0 inset-x-0 z-20 border-t border-border bg-bg-elev/95 backdrop-blur flex" style="padding-bottom: env(safe-area-inset-bottom)">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium"
          :class="isActive(item) ? 'text-accent-2' : 'text-muted'"
        >
          <component :is="item.icon" class="h-5 w-5" />{{ item.label.split(' ')[0] }}
        </RouterLink>
      </nav>
    </div>
  </div>
  <RouterView v-else />
  <ActivityPanel v-if="activityOpen" @close="activityOpen = false" />
  <Toasts />
</template>
