import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import { router } from './router';
import { setUnauthorizedHandler } from './lib/api';
import { useApp } from './stores/app';
import './style.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
// Focus à l'apparition d'un champ (formulaires ouverts dynamiquement) : `autofocus` ne vaut qu'au premier rendu.
app.directive('focus', { mounted: (el: HTMLElement) => el.focus() });

setUnauthorizedHandler(() => {
  const store = useApp();
  store.authenticated = false;
  if (router.currentRoute.value.name !== 'login') void router.push({ name: 'login', query: { next: router.currentRoute.value.fullPath } });
});

registerSW({ immediate: true });

app.mount('#app');
