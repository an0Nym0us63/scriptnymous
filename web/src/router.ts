import { createRouter, createWebHistory } from 'vue-router';
import { useApp } from '@/stores/app';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true, title: 'Connexion' } },
    { path: '/', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: 'Tableau de bord' } },
    { path: '/scripts/new', name: 'script-new', component: () => import('@/views/ScriptEditView.vue'), meta: { title: 'Nouveau script' } },
    { path: '/scripts/:slug', name: 'script', component: () => import('@/views/ScriptView.vue'), meta: { title: 'Script' } },
    { path: '/scripts/:slug/edit', name: 'script-edit', component: () => import('@/views/ScriptEditView.vue'), meta: { title: 'Édition' } },
    { path: '/runs', name: 'runs', component: () => import('@/views/HistoryView.vue'), meta: { title: 'Historique' } },
    { path: '/runs/:id', name: 'run', component: () => import('@/views/RunView.vue'), meta: { title: 'Run' } },
    { path: '/schedules', name: 'schedules', component: () => import('@/views/SchedulesView.vue'), meta: { title: 'Planifications' } },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: 'Réglages' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const app = useApp();
  if (app.authenticated === null) await app.checkAuth();
  if (!to.meta.public && !app.authenticated) return { name: 'login', query: { next: to.fullPath } };
  if (to.name === 'login' && app.authenticated) return { name: 'dashboard' };
  document.title = to.meta.title ? `${to.meta.title} · ScriptNymous` : 'ScriptNymous';
  return true;
});
