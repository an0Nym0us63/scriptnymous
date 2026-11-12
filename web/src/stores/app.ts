// État global : authentification, thème, notifications visuelles (toasts).
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/lib/api';
import { connectWs, disconnectWs } from '@/lib/ws';

export interface Toast {
  id: number;
  kind: 'ok' | 'err' | 'info' | 'warn';
  title: string;
  text?: string;
  to?: string;
}

export const useApp = defineStore('app', () => {
  const authenticated = ref<boolean | null>(null);
  const passwordConfigured = ref(true);
  const theme = ref<'dark' | 'light'>((document.documentElement.dataset.theme as 'dark' | 'light') || 'dark');
  const toasts = ref<Toast[]>([]);
  let toastSeq = 0;

  async function checkAuth(): Promise<boolean> {
    try {
      const r = await api.get<{ authenticated: boolean; passwordConfigured: boolean }>('/api/auth/status');
      authenticated.value = r.authenticated;
      passwordConfigured.value = r.passwordConfigured;
      if (r.authenticated) connectWs();
      return r.authenticated;
    } catch {
      authenticated.value = false;
      return false;
    }
  }
  async function login(password: string): Promise<void> {
    await api.post('/api/auth/login', { password });
    authenticated.value = true;
    connectWs();
  }
  async function logout(): Promise<void> {
    try {
      await api.post('/api/auth/logout');
    } finally {
      authenticated.value = false;
      disconnectWs();
    }
  }
  function setTheme(t: 'dark' | 'light'): void {
    theme.value = t;
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem('sn-theme', t);
    } catch {
      /* stockage indisponible */
    }
  }
  function toggleTheme(): void {
    setTheme(theme.value === 'dark' ? 'light' : 'dark');
  }
  function toast(kind: Toast['kind'], title: string, text?: string, to?: string): void {
    const id = ++toastSeq;
    toasts.value.push({ id, kind, title, text, to });
    setTimeout(() => dismiss(id), kind === 'err' ? 8000 : 4500);
  }
  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  return { authenticated, passwordConfigured, theme, toasts, checkAuth, login, logout, setTheme, toggleTheme, toast, dismiss };
});
