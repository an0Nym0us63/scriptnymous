<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Bell, KeyRound, Trash2, Copy, RefreshCw, ShieldCheck, Server, Info, FolderOpen, Braces } from 'lucide-vue-next';
import FileBrowser from '@/components/FileBrowser.vue';
import { api, type Settings, type SystemInfo } from '@/lib/api';
import { useApp } from '@/stores/app';
import { bytes } from '@/lib/format';

const app = useApp();
const origin = window.location.origin;
const settings = ref<Settings | null>(null);
const system = ref<SystemInfo | null>(null);
const form = ref({ ntfy_server: '', ntfy_topic: '', ntfy_token: '', public_url: '', log_retention_days: 30, log_max_mb: 500, orphan_policy: 'kill' as 'kill' | 'adopt', timezone: 'Europe/Paris', variables_file: 'config.json' });
const browsing = ref(false);
const saving = ref(false);
const token = ref<{ set: boolean; prefix: string | null }>({ set: false, prefix: null });
const freshToken = ref('');
const pwd = ref({ current: '', next: '', confirm: '' });

async function load(): Promise<void> {
  const r = await api.get<{ settings: Settings; system: SystemInfo }>('/api/settings');
  settings.value = r.settings;
  system.value = r.system;
  form.value = { ...form.value, ...r.settings, ntfy_token: '' };
  token.value = await api.get('/api/auth/token');
}
onMounted(load);

async function save(): Promise<void> {
  saving.value = true;
  try {
    const body: Record<string, unknown> = { ...form.value, log_retention_days: Number(form.value.log_retention_days), log_max_mb: Number(form.value.log_max_mb) };
    if (!form.value.ntfy_token) delete body.ntfy_token;
    const r = await api.put<{ settings: Settings }>('/api/settings', body);
    settings.value = r.settings;
    form.value.ntfy_token = '';
    app.toast('ok', 'Réglages enregistrés');
  } catch (e) {
    app.toast('err', 'Enregistrement impossible', (e as Error).message);
  } finally {
    saving.value = false;
  }
}
async function clearToken(): Promise<void> {
  await api.put('/api/settings', { ntfy_token: null });
  await load();
}
async function testNtfy(): Promise<void> {
  const r = await api.post<{ ok: boolean; error?: string }>('/api/settings/ntfy/test');
  if (r.ok) app.toast('ok', 'Notification de test envoyée');
  else app.toast('err', 'Échec de l’envoi', r.error);
}
async function purge(): Promise<void> {
  const r = await api.post<{ removed: number }>('/api/settings/purge');
  app.toast('ok', 'Purge effectuée', `${r.removed} run(s) supprimé(s)`);
  await load();
}
async function rotate(): Promise<void> {
  if (token.value.set && !confirm('Générer un nouveau jeton révoque l’ancien. Continuer ?')) return;
  const r = await api.post<{ token: string }>('/api/auth/token');
  freshToken.value = r.token;
  token.value = await api.get('/api/auth/token');
}
async function revoke(): Promise<void> {
  if (!confirm('Révoquer le jeton d’API ?')) return;
  await api.del('/api/auth/token');
  freshToken.value = '';
  token.value = await api.get('/api/auth/token');
}
async function copy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  app.toast('ok', 'Copié');
}
async function changePassword(): Promise<void> {
  if (pwd.value.next !== pwd.value.confirm) return app.toast('err', 'Les deux mots de passe diffèrent');
  try {
    await api.post('/api/auth/password', { current: pwd.value.current, next: pwd.value.next });
    pwd.value = { current: '', next: '', confirm: '' };
    app.toast('ok', 'Mot de passe modifié');
  } catch (e) {
    app.toast('err', 'Modification refusée', (e as Error).message);
  }
}
</script>

<template>
  <div v-if="settings" class="max-w-3xl">
    <h1 class="text-2xl font-semibold tracking-tight mb-5">Réglages</h1>

    <form class="space-y-5" @submit.prevent="save">
      <section class="card p-5">
        <h2 class="font-semibold flex items-center gap-2 mb-4"><Bell class="h-4 w-4 text-accent-2" /> Notifications ntfy</h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <div><label class="label">Serveur</label><input v-model="form.ntfy_server" class="input" placeholder="https://ntfy.sh" /></div>
          <div><label class="label">Sujet par défaut</label><input v-model="form.ntfy_topic" class="input" placeholder="scriptnymous" /></div>
          <div class="sm:col-span-2">
            <label class="label">Jeton d'accès {{ settings.ntfy_token_set ? '(défini)' : '(aucun)' }}</label>
            <div class="flex gap-2">
              <input v-model="form.ntfy_token" type="password" class="input" autocomplete="off" :placeholder="settings.ntfy_token_set ? 'Laisser vide pour conserver' : 'tk_…'" />
              <button v-if="settings.ntfy_token_set" type="button" class="btn-soft" @click="clearToken">Effacer</button>
            </div>
          </div>
          <div class="sm:col-span-2">
            <label class="label">URL publique (liens dans les notifications)</label>
            <input v-model="form.public_url" class="input" placeholder="https://scripts.exemple.fr" />
          </div>
        </div>
        <div class="mt-4 flex gap-2"><button type="button" class="btn-soft" @click="testNtfy">Envoyer un test</button></div>
      </section>

      <section class="card p-5">
        <h2 class="font-semibold flex items-center gap-2 mb-4"><Server class="h-4 w-4 text-accent-2" /> Exécution et journaux</h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <div><label class="label">Conserver les journaux (jours, 0 = illimité)</label><input v-model.number="form.log_retention_days" type="number" min="0" class="input" /></div>
          <div><label class="label">Taille maximale des journaux (Mo, 0 = illimité)</label><input v-model.number="form.log_max_mb" type="number" min="0" class="input" /></div>
          <div><label class="label">Fuseau horaire par défaut</label><input v-model="form.timezone" class="input" placeholder="Europe/Paris" /></div>
          <div>
            <label class="label">Run encore vivant au redémarrage</label>
            <select v-model="form.orphan_policy" class="input">
              <option value="kill">Arrêter le processus (kill)</option>
              <option value="adopt">Le suivre jusqu'à sa fin (adopt)</option>
            </select>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span v-if="system">Journaux : {{ bytes(system.logsBytes) }} · environnements : {{ bytes(system.envsBytes) }}</span>
          <span class="flex-1" />
          <button type="button" class="btn-soft" @click="purge"><Trash2 class="h-4 w-4" /> Purger maintenant</button>
        </div>
      </section>

      <section class="card p-5">
        <h2 class="font-semibold flex items-center gap-2 mb-4"><Braces class="h-4 w-4 text-accent-2" /> Variables partagées</h2>
        <label class="label">Fichier JSON des variables (relatif au dossier des scripts)</label>
        <div class="flex gap-2">
          <input v-model="form.variables_file" class="input font-mono" placeholder="config.json" />
          <button type="button" class="btn-soft shrink-0" @click="browsing = true"><FolderOpen class="h-4 w-4" /> Parcourir</button>
        </div>
        <p class="text-xs text-muted mt-2">Édité depuis la page Variables ; son chemin est passé aux scripts dans <span class="kbd">SN_CONFIG_FILE</span>. Un fichier inexistant est créé au premier enregistrement.</p>
      </section>

      <div class="flex justify-end"><button class="btn-primary" :disabled="saving">Enregistrer</button></div>
    </form>

    <FileBrowser v-if="browsing" @close="browsing = false" @pick="(p) => { form.variables_file = p; browsing = false; }" />

    <section class="card p-5 mt-5">
      <h2 class="font-semibold flex items-center gap-2 mb-2"><KeyRound class="h-4 w-4 text-accent-2" /> Jeton d'API</h2>
      <p class="text-sm text-text-2 mb-4">Pour appeler l'API depuis l'extérieur : en-tête <span class="kbd">Authorization: Bearer &lt;jeton&gt;</span>. Le jeton n'est affiché qu'une fois.</p>
      <div v-if="freshToken" class="mb-4 flex items-center gap-2 card bg-surface-2 p-3">
        <code class="font-mono text-sm flex-1 break-all">{{ freshToken }}</code>
        <button class="btn-icon btn-ghost" @click="copy(freshToken)"><Copy class="h-4 w-4" /></button>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm text-muted">{{ token.set ? `Jeton actif (${token.prefix}…)` : 'Aucun jeton' }}</span>
        <span class="flex-1" />
        <button class="btn-soft" @click="rotate"><RefreshCw class="h-4 w-4" /> {{ token.set ? 'Régénérer' : 'Générer' }}</button>
        <button v-if="token.set" class="btn-danger" @click="revoke">Révoquer</button>
      </div>
      <pre class="mt-4 terminal p-3 text-xs whitespace-pre-wrap">curl -X POST {{ form.public_url || origin }}/api/scripts/&lt;slug&gt;/run \
  -H "Authorization: Bearer &lt;jeton&gt;" -H "Content-Type: application/json" \
  -d '{"params": {"prenom": "api"}}'</pre>
    </section>

    <section class="card p-5 mt-5">
      <h2 class="font-semibold flex items-center gap-2 mb-4"><ShieldCheck class="h-4 w-4 text-accent-2" /> Mot de passe</h2>
      <form class="grid gap-4 sm:grid-cols-3" @submit.prevent="changePassword">
        <div><label class="label">Actuel</label><input v-model="pwd.current" type="password" class="input" autocomplete="current-password" required /></div>
        <div><label class="label">Nouveau</label><input v-model="pwd.next" type="password" class="input" autocomplete="new-password" minlength="8" required /></div>
        <div><label class="label">Confirmer</label><input v-model="pwd.confirm" type="password" class="input" autocomplete="new-password" required /></div>
        <div class="sm:col-span-3 flex justify-end"><button class="btn-soft">Changer le mot de passe</button></div>
      </form>
    </section>

    <section v-if="system" class="card p-5 mt-5 text-sm">
      <h2 class="font-semibold flex items-center gap-2 mb-3"><Info class="h-4 w-4 text-accent-2" /> Système</h2>
      <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-text-2">
        <dt class="text-muted">Version</dt><dd>{{ system.version }} · Node {{ system.node }} · {{ system.platform }}</dd>
        <dt class="text-muted">Scripts</dt><dd class="font-mono break-all">{{ system.scriptsDir }} <span :class="system.scriptsDirAvailable ? 'text-ok' : 'text-err'">({{ system.scriptsDirAvailable ? 'accessible' : 'inaccessible' }})</span></dd>
        <dt class="text-muted">Données</dt><dd class="font-mono break-all">{{ system.dataDir }}</dd>
      </dl>
    </section>
  </div>
</template>
