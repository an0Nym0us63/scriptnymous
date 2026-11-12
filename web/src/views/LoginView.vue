<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LogIn } from 'lucide-vue-next';
import { useApp } from '@/stores/app';
import { ApiError } from '@/lib/api';

const app = useApp();
const router = useRouter();
const route = useRoute();
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await app.login(password.value);
    void router.replace((route.query.next as string) || '/');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Connexion impossible';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="min-h-full h-full overflow-y-auto overflow-x-hidden flex items-center justify-center p-6 relative">
    <div class="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />
    <div class="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-info/10 blur-3xl" />
    <div class="card w-full max-w-sm p-8 relative">
      <div class="flex items-center gap-3 mb-6">
        <img src="/favicon.svg" alt="" class="h-11 w-11" />
        <div>
          <h1 class="text-xl font-semibold tracking-tight">ScriptNymous</h1>
          <p class="text-xs text-muted">vos scripts, en direct</p>
        </div>
      </div>
      <form class="space-y-4" @submit.prevent="submit">
        <div>
          <label class="label" for="pwd">Mot de passe</label>
          <input id="pwd" v-model="password" type="password" class="input" autocomplete="current-password" autofocus required />
        </div>
        <p v-if="!app.passwordConfigured" class="text-sm text-warn">Aucun mot de passe n'est défini : renseignez <span class="kbd">SN_PASSWORD</span> puis redémarrez le service.</p>
        <p v-if="error" class="text-sm text-err">{{ error }}</p>
        <button class="btn-primary w-full" :disabled="busy || !password"><LogIn class="h-4 w-4" /> Se connecter</button>
      </form>
    </div>
  </div>
</template>
