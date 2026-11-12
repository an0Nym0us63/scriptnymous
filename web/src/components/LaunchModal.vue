<script setup lang="ts">
// Lancement rapide : formulaire généré depuis les paramètres, envoi JSON ou multipart (fichiers).
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Play } from 'lucide-vue-next';
import type { ScriptItem, Run } from '@/lib/api';
import { api, ApiError } from '@/lib/api';
import { useApp } from '@/stores/app';
import Modal from './Modal.vue';
import ParamForm from './ParamForm.vue';

const props = defineProps<{ script: ScriptItem }>();
const emit = defineEmits<{ close: [] }>();
const app = useApp();
const router = useRouter();
const values = ref<Record<string, unknown>>({});
const busy = ref(false);
const error = ref('');

async function launch(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const hasFile = Object.values(values.value).some((v) => v instanceof File);
    let body: unknown;
    if (hasFile) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(values.value)) {
        if (v instanceof File) fd.append(k, v, v.name);
        else if (Array.isArray(v)) fd.append(k, JSON.stringify(v));
        else if (v !== undefined && v !== null) fd.append(k, String(v));
      }
      body = fd;
    } else body = { params: values.value };
    const r = await api.post<{ outcome: string; run?: Run; reason?: string }>(`/api/scripts/${encodeURIComponent(props.script.slug)}/run`, body);
    if (r.outcome === 'started' && r.run) {
      emit('close');
      void router.push(`/runs/${r.run.id}`);
    } else if (r.outcome === 'queued') {
      app.toast('info', 'Mis en file', 'Une instance tourne encore ; le lancement suivra.');
      emit('close');
    } else if (r.outcome === 'skipped') {
      app.toast('warn', 'Lancement ignoré', r.reason);
      emit('close');
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal :title="`Lancer « ${script.name} »`" @close="emit('close')">
    <form id="launch-form" @submit.prevent="launch">
      <ParamForm v-model="values" :params="script.spec.params" :slug="script.slug" />
      <p v-if="error" class="mt-4 text-sm text-err">{{ error }}</p>
    </form>
    <template #footer>
      <button class="btn-ghost" type="button" @click="emit('close')">Annuler</button>
      <button class="btn-primary" type="submit" form="launch-form" :disabled="busy"><Play class="h-4 w-4" /> Lancer</button>
    </template>
  </Modal>
</template>
