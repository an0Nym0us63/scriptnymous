<script setup lang="ts">
// Création / édition d'un script : formulaire complet (général, paramètres, planifications, exécution, notifications,
// dépendances), éditeur de code et YAML brut. Écrit dans /scripts/<slug>/ via l'API.
import { computed, defineAsyncComponent, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import YAML from 'yaml';
import { ArrowLeft, Plus, Trash2, Save, GripVertical, Wand2, FolderOpen } from 'lucide-vue-next';
import { api, ApiError, type ScriptDetail, type ScriptSpec, type ParamSpec, type ScheduleSpec } from '@/lib/api';
import { useApp } from '@/stores/app';
import { useScripts } from '@/stores/scripts';
import { CONCURRENCY, describeCron, fmtDateShort, NOTIFY_EVENTS } from '@/lib/format';
import AppIcon from '@/components/AppIcon.vue';
import CodeEditor from '@/components/CodeEditor.vue';
import ParamForm from '@/components/ParamForm.vue';
import FileBrowser from '@/components/FileBrowser.vue';
import DepSuggestions, { type Suggestion } from '@/components/DepSuggestions.vue';
const IconPicker = defineAsyncComponent(() => import('@/components/IconPicker.vue'));
const pickingIcon = ref(false);

const route = useRoute();
const router = useRouter();
const app = useApp();
const scripts = useScripts();
const isNew = computed(() => route.name === 'script-new');
const slug = ref((route.params.slug as string) || '');
const tab = ref<string>((route.query.tab as string) || 'general');
const saving = ref(false);
const error = ref('');
const issues = ref<string[]>([]);
const code = ref<string | null>(null);
const codeLoaded = ref(false);
const yamlText = ref('');
const yamlDirty = ref(false);
const envText = ref('');
const depsText = reactive({ apt: '', pip: '', npm: '' });
const previews = reactive<Record<string, string[] | string>>({});

const blank = (): ScriptSpec => ({
  name: '',
  description: '',
  group: undefined,
  icon: 'terminal',
  color: '#6366f1',
  interpreter: 'bash',
  command: undefined,
  file: 'script.sh',
  workdir: undefined,
  env: {},
  timeout_seconds: 0,
  params: [],
  concurrency: 'skip',
  retry: { attempts: 1, delay_seconds: 30, factor: 2, max_delay_seconds: 3600, retry_on: [], no_retry_on: [] },
  schedules: [],
  notify: { events: ['failure', 'final_failure', 'missing', 'lost'], priority: 3, tags: [] },
  deps: { apt: [], pip: [], npm: [], bin: [] },
  enabled: true,
});
const spec = reactive<ScriptSpec>(blank());
const retryOn = ref('');
const noRetryOn = ref('');
const tagsText = ref('');
const mode = ref<'interpreter' | 'command'>('interpreter');

const tabs = [
  { id: 'general', label: 'Général' },
  { id: 'params', label: 'Paramètres' },
  { id: 'schedules', label: 'Planifications' },
  { id: 'exec', label: 'Exécution' },
  { id: 'notify', label: 'Notifications' },
  { id: 'deps', label: 'Dépendances' },
  { id: 'code', label: 'Code' },
  { id: 'yaml', label: 'YAML' },
];
const lang = computed(() => (spec.interpreter === 'python3' ? 'python' : spec.interpreter === 'node' ? 'javascript' : spec.interpreter ? 'bash' : 'text'));
const COLORS = ['#6366f1', '#7c6cff', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6', '#64748b'];

function assign(src: ScriptSpec): void {
  Object.assign(spec, JSON.parse(JSON.stringify(src)));
  mode.value = src.command ? 'command' : 'interpreter';
  envText.value = Object.entries(src.env).map(([k, v]) => `${k}=${v}`).join('\n');
  depsText.apt = src.deps.apt.join('\n');
  depsText.pip = src.deps.pip.join('\n');
  depsText.npm = src.deps.npm.join('\n');
  retryOn.value = src.retry.retry_on.join(', ');
  noRetryOn.value = src.retry.no_retry_on.join(', ');
  tagsText.value = src.notify.tags.join(', ');
}

onMounted(async () => {
  if (!isNew.value) {
    const d = await api.get<ScriptDetail>(`/api/scripts/${encodeURIComponent(slug.value)}`);
    assign(d.spec);
    code.value = d.code;
    yamlText.value = d.yaml ?? '';
  } else {
    assign(blank());
  }
  codeLoaded.value = true;
  for (const s of spec.schedules) void preview(s);
});

watch(tab, (t) => {
  void router.replace({ query: { ...route.query, tab: t } });
  if (t === 'yaml' && !yamlDirty.value) yamlText.value = YAML.stringify(buildSpec(), { lineWidth: 100 });
});
watch(
  () => spec.name,
  (n) => {
    if (isNew.value && !slugTouched.value) slug.value = slugify(n);
  },
);
const slugTouched = ref(false);
const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

watch(
  () => spec.interpreter,
  (i, old) => {
    if (!isNew.value || !old) return;
    const ext: Record<string, string> = { bash: 'sh', sh: 'sh', python3: 'py', node: 'js' };
    if (spec.file === `script.${ext[old]}`) spec.file = `script.${ext[i ?? 'bash']}`;
  },
);

const lines = (t: string) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const nums = (t: string) => t.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean).map(Number).filter((n) => Number.isInteger(n));

/** Assemble la déclaration finale depuis le formulaire. */
function buildSpec(): ScriptSpec {
  const out: ScriptSpec = JSON.parse(JSON.stringify(spec));
  if (mode.value === 'command') out.interpreter = undefined;
  else out.command = undefined;
  if (!out.group) out.group = undefined;
  if (!out.workdir) out.workdir = undefined;
  out.env = Object.fromEntries(lines(envText.value).map((l) => {
    const i = l.indexOf('=');
    return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1)] : [l, ''];
  }));
  out.deps.apt = lines(depsText.apt);
  out.deps.pip = lines(depsText.pip);
  out.deps.npm = lines(depsText.npm);
  out.deps.bin = out.deps.bin.filter((b) => b.name && b.url).map((b) => ({ ...b, sha256: b.sha256 || undefined }));
  out.retry.retry_on = nums(retryOn.value);
  out.retry.no_retry_on = nums(noRetryOn.value);
  out.notify.tags = tagsText.value.split(',').map((t) => t.trim()).filter(Boolean);
  if (!out.notify.topic) out.notify.topic = undefined;
  if (!out.notify.server) out.notify.server = undefined;
  if (!out.notify.token) out.notify.token = undefined;
  out.params = out.params.map((p) => {
    const q: ParamSpec = { ...p };
    if (q.type !== 'choice' && q.type !== 'multichoice') delete q.choices;
    if (q.default === '' || q.default === undefined || q.default === null) delete q.default;
    else if (q.type === 'number') q.default = Number(q.default);
    else if (q.type === 'boolean') q.default = q.default === true || q.default === 'true';
    if (!q.as) delete q.as;
    if (!q.label) delete q.label;
    if (!q.description) delete q.description;
    if (!q.placeholder) delete q.placeholder;
    if (q.min === null || (q.min as unknown) === '') delete q.min;
    if (q.max === null || (q.max as unknown) === '') delete q.max;
    return q;
  });
  out.schedules = out.schedules.map((s) => {
    const t: ScheduleSpec = { ...s };
    if (!t.name) delete t.name;
    if (!t.timezone) delete t.timezone;
    if (!t.window) delete t.window;
    t.exclude_days = (Array.isArray(t.exclude_days) ? t.exclude_days : String(t.exclude_days).split(',')).map((d) => String(d).trim()).filter(Boolean);
    return t;
  });
  // Nettoyage des undefined pour un YAML propre.
  return JSON.parse(JSON.stringify(out));
}

// ---- Paramètres ----
function addParam(): void {
  spec.params.push({ name: `param${spec.params.length + 1}`, type: 'text', required: false, pass: 'positional' } as ParamSpec);
}
const choicesText = (p: ParamSpec) => (p.choices ?? []).join(', ');
const setChoices = (p: ParamSpec, t: string) => (p.choices = t.split(',').map((s) => s.trim()).filter(Boolean));

// ---- Planifications ----
function addSchedule(): void {
  const s: ScheduleSpec = { id: `s${Date.now().toString(36)}`, cron: '0 8 * * *', enabled: true, jitter_seconds: 0, exclude_days: [], catch_up: false, params: {} };
  spec.schedules.push(s);
  void preview(s);
}
let previewTimers: Record<string, number> = {};
function preview(s: ScheduleSpec): void {
  const key = s.id!;
  if (previewTimers[key]) clearTimeout(previewTimers[key]);
  previewTimers[key] = window.setTimeout(async () => {
    try {
      const body = { ...s, exclude_days: Array.isArray(s.exclude_days) ? s.exclude_days : String(s.exclude_days).split(',').map((d) => d.trim()).filter(Boolean), timezone: s.timezone || undefined, window: s.window || undefined, name: s.name || undefined };
      const r = await api.post<{ next: string[] }>('/api/schedules/preview', body);
      previews[key] = r.next;
    } catch (e) {
      previews[key] = (e as Error).message;
    }
  }, 350);
}
const excludeText = (s: ScheduleSpec) => (Array.isArray(s.exclude_days) ? s.exclude_days.join(', ') : String(s.exclude_days));

// ---- Explorateur de /scripts ----
const browsing = ref(false);
const EXT_LANG: Record<string, ScriptSpec['interpreter']> = { sh: 'bash', bash: 'bash', py: 'python3', js: 'node', mjs: 'node', cjs: 'node' };
/** Fichier choisi dans /scripts : fixe l'identifiant (dossier), le fichier, l'interpréteur probable et charge le code. */
async function pickFile(rel: string): Promise<void> {
  browsing.value = false;
  const parts = rel.split('/');
  if (parts.length < 2) return app.toast('warn', 'Fichier à la racine', 'Placez le script dans son propre sous-dossier de /scripts.');
  // Le script est le dossier qui contient le fichier ; les dossiers au-dessus forment le groupe proposé.
  const folder = parts.slice(0, -1).join('/');
  const file = parts[parts.length - 1];
  if (isNew.value) {
    slug.value = folder;
    slugTouched.value = true;
    const leaf = parts[parts.length - 2];
    if (!spec.name) spec.name = leaf.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
    if (!spec.group && parts.length > 2) spec.group = parts.slice(0, -2).join(' / ');
  } else if (folder !== slug.value) {
    return app.toast('warn', 'Mauvais dossier', `Le fichier doit être dans /scripts/${slug.value}/.`);
  }
  spec.file = file;
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  if (EXT_LANG[ext]) {
    mode.value = 'interpreter';
    spec.interpreter = EXT_LANG[ext];
  }
  try {
    const r = await api.get<{ content: string }>(`/api/browse/file?path=${encodeURIComponent(rel)}`);
    code.value = r.content;
    app.toast('ok', 'Fichier chargé', rel);
  } catch (e) {
    app.toast('warn', 'Code non chargé', (e as Error).message);
  }
}

// ---- Suggestions de dépendances ----
const existingDeps = computed(() => ({ pip: lines(depsText.pip), npm: lines(depsText.npm), apt: lines(depsText.apt) }));
function addDep(sg: Suggestion): void {
  const cur = lines(depsText[sg.kind]);
  if (!cur.includes(sg.package)) depsText[sg.kind] = [...cur, sg.package].join('\n');
}
function addDeps(list: Suggestion[]): void {
  for (const sg of list) addDep(sg);
}

// ---- Enregistrement ----
async function save(): Promise<void> {
  error.value = '';
  issues.value = [];
  if (!slug.value) return void (error.value = 'Identifiant requis');
  saving.value = true;
  try {
    const body: Record<string, unknown> = { code: code.value };
    if (tab.value === 'yaml' && yamlDirty.value) body.yaml = yamlText.value;
    else body.spec = buildSpec();
    await api.put(`/api/scripts/${encodeURIComponent(slug.value)}`, body);
    await scripts.load();
    app.toast('ok', isNew.value ? 'Script créé' : 'Script enregistré');
    void router.push(`/scripts/${slug.value}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : String(e);
    issues.value = ((e as ApiError).body as { issues?: string[] })?.issues ?? [];
  } finally {
    saving.value = false;
  }
}
function applyYamlToForm(): void {
  try {
    const parsed = YAML.parse(yamlText.value) as ScriptSpec;
    assign({ ...blank(), ...parsed, retry: { ...blank().retry, ...(parsed.retry ?? {}) }, notify: { ...blank().notify, ...(parsed.notify ?? {}) }, deps: { ...blank().deps, ...(parsed.deps ?? {}) } });
    yamlDirty.value = false;
    app.toast('ok', 'YAML appliqué au formulaire');
  } catch (e) {
    app.toast('err', 'YAML invalide', (e as Error).message);
  }
}
</script>

<template>
  <div v-if="codeLoaded">
    <div class="flex flex-wrap items-center gap-3 mb-5">
      <button class="btn-icon btn-ghost" @click="router.back()"><ArrowLeft class="h-4 w-4" /></button>
      <h1 class="text-2xl font-semibold tracking-tight">{{ isNew ? 'Nouveau script' : `Modifier « ${spec.name} »` }}</h1>
      <span class="flex-1" />
      <button class="btn-primary" :disabled="saving" @click="save"><Save class="h-4 w-4" /> Enregistrer</button>
    </div>

    <div v-if="error" class="mb-4 card border-err/40 bg-err-soft px-4 py-3 text-sm text-err">
      {{ error }}
      <ul v-if="issues.length" class="list-disc ml-5 mt-1 text-xs"><li v-for="i in issues" :key="i">{{ i }}</li></ul>
    </div>

    <div class="flex gap-1 overflow-x-auto mb-5 -mx-4 px-4 md:mx-0 md:px-0">
      <button v-for="t in tabs" :key="t.id" class="btn whitespace-nowrap" :class="tab === t.id ? 'bg-accent-soft text-accent-2' : 'text-text-2 hover:bg-surface-2'" @click="tab = t.id">{{ t.label }}</button>
    </div>

    <!-- Général -->
    <div v-show="tab === 'general'" class="card p-5 grid gap-4 md:grid-cols-2">
      <div><label class="label">Nom</label><input v-model="spec.name" class="input" placeholder="Sauvegarde nocturne" required /></div>
      <div>
        <label class="label">Identifiant (dossier)</label>
        <input v-model="slug" class="input font-mono" :disabled="!isNew" placeholder="sauvegarde-nocturne ou Photos/tri-doublons" @input="slugTouched = true" />
        <div class="text-xs text-muted mt-1">
          Chemin du dossier du script : <span class="font-mono text-text-2">/scripts/{{ slug || '…' }}/{{ spec.file }}</span>. Sous-dossiers autorisés.
          <button v-if="isNew" type="button" class="ml-1 text-accent-2 hover:underline" @click="browsing = true">Choisir un script déjà présent sur le partage…</button>
        </div>
      </div>
      <div class="md:col-span-2"><label class="label">Description</label><input v-model="spec.description" class="input" placeholder="Ce que fait le script, en une phrase." /></div>
      <div>
        <label class="label">Groupe</label>
        <input v-model="spec.group" class="input" list="groups" placeholder="Maison, Serveur, …" />
        <datalist id="groups"><option v-for="[g] in scripts.groups" :key="g" :value="g" /></datalist>
      </div>
      <div class="flex items-center gap-3 pt-5">
        <button type="button" class="toggle" :class="spec.enabled ? 'bg-accent' : 'bg-surface-3'" @click="spec.enabled = !spec.enabled"><span class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" :class="spec.enabled ? 'translate-x-5' : 'translate-x-0'" /></button>
        <div class="text-sm"><div class="font-medium">Planifications actives</div><div class="text-xs text-muted">Le lancement manuel reste possible.</div></div>
      </div>
      <div>
        <label class="label">Icône</label>
        <div class="flex items-center gap-3">
          <div class="h-12 w-12 rounded-xl flex items-center justify-center text-white shrink-0" :style="{ background: spec.color }"><AppIcon :name="spec.icon" :size="22" /></div>
          <div class="min-w-0 flex-1">
            <div class="font-mono text-sm truncate">{{ spec.icon }}</div>
            <div class="text-xs text-muted">Catalogue lucide complet.</div>
          </div>
          <button type="button" class="btn-soft" @click="pickingIcon = true"><Wand2 class="h-4 w-4" /> Choisir…</button>
        </div>
      </div>
      <div>
        <label class="label">Couleur</label>
        <div class="flex flex-wrap items-center gap-1.5">
          <button v-for="c in COLORS" :key="c" type="button" class="h-8 w-8 rounded-full border-2 transition" :class="spec.color === c ? 'border-text scale-110' : 'border-transparent'" :style="{ background: c }" @click="spec.color = c" />
          <input v-model="spec.color" type="color" class="h-8 w-10 rounded-lg bg-transparent border border-border cursor-pointer" />
        </div>
        <div class="mt-3 flex items-center gap-3 p-3 rounded-xl bg-surface-2">
          <div class="h-10 w-10 rounded-xl flex items-center justify-center text-white" :style="{ background: spec.color }"><AppIcon :name="spec.icon" :size="20" /></div>
          <div><div class="font-semibold text-sm">{{ spec.name || 'Aperçu' }}</div><div class="text-xs text-muted">{{ spec.description || 'description' }}</div></div>
        </div>
      </div>
    </div>

    <!-- Paramètres -->
    <div v-show="tab === 'params'" class="space-y-3">
      <div v-for="(p, i) in spec.params" :key="i" class="card p-4">
        <div class="flex items-center gap-2 mb-3">
          <GripVertical class="h-4 w-4 text-muted" />
          <input v-model="p.name" class="input font-mono w-48" placeholder="nom" />
          <select v-model="p.type" class="input w-auto">
            <option value="text">Texte</option><option value="number">Nombre</option><option value="boolean">Booléen</option><option value="choice">Choix</option><option value="multichoice">Multi-choix</option><option value="file">Fichier</option><option value="secret">Secret</option>
          </select>
          <span class="flex-1" />
          <button class="btn-icon btn-ghost text-muted hover:text-err" @click="spec.params.splice(i, 1)"><Trash2 class="h-4 w-4" /></button>
        </div>
        <div class="grid gap-3 md:grid-cols-3">
          <div><label class="label">Libellé</label><input v-model="p.label" class="input" :placeholder="p.name" /></div>
          <div><label class="label">Description</label><input v-model="p.description" class="input" /></div>
          <div>
            <label class="label">Passage</label>
            <select v-model="p.pass" class="input"><option value="positional">Argument positionnel</option><option value="option">Option --nom valeur</option><option value="env">Variable d'environnement</option></select>
          </div>
          <div v-if="p.pass !== 'positional'"><label class="label">{{ p.pass === 'env' ? 'Nom de la variable' : 'Nom de l’option' }}</label><input v-model="p.as" class="input font-mono" :placeholder="p.pass === 'env' ? p.name.toUpperCase() : p.name" /></div>
          <div v-if="p.type === 'choice' || p.type === 'multichoice'" class="md:col-span-2"><label class="label">Choix (séparés par des virgules)</label><input :value="choicesText(p)" class="input" @input="setChoices(p, ($event.target as HTMLInputElement).value)" /></div>
          <div v-if="p.type === 'number'"><label class="label">Min</label><input v-model.number="p.min" type="number" class="input" /></div>
          <div v-if="p.type === 'number'"><label class="label">Max</label><input v-model.number="p.max" type="number" class="input" /></div>
          <div v-if="p.type !== 'file' && p.type !== 'secret'">
            <label class="label">Valeur par défaut</label>
            <select v-if="p.type === 'boolean'" :value="String(p.default ?? false)" class="input" @change="p.default = ($event.target as HTMLSelectElement).value === 'true'"><option value="false">non</option><option value="true">oui</option></select>
            <input v-else v-model="p.default" class="input" />
          </div>
          <div class="flex items-center gap-2 pt-5"><input :id="`req${i}`" v-model="p.required" type="checkbox" class="accent-accent h-4 w-4" /><label :for="`req${i}`" class="text-sm">Obligatoire</label></div>
        </div>
      </div>
      <button class="btn-soft" @click="addParam"><Plus class="h-4 w-4" /> Ajouter un paramètre</button>
      <div v-if="spec.params.length" class="card p-5">
        <div class="text-xs font-semibold uppercase tracking-wide text-muted mb-3">Aperçu du formulaire de lancement</div>
        <ParamForm :model-value="{}" :params="buildSpec().params" compact />
      </div>
    </div>

    <!-- Planifications -->
    <div v-show="tab === 'schedules'" class="space-y-3">
      <div v-for="(s, i) in spec.schedules" :key="s.id" class="card p-4">
        <div class="flex items-center gap-2 mb-3">
          <button type="button" class="toggle" :class="s.enabled ? 'bg-accent' : 'bg-surface-3'" @click="s.enabled = !s.enabled"><span class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" :class="s.enabled ? 'translate-x-5' : 'translate-x-0'" /></button>
          <input v-model="s.name" class="input w-56" placeholder="Nom (facultatif)" />
          <span class="flex-1" />
          <button class="btn-icon btn-ghost text-muted hover:text-err" @click="spec.schedules.splice(i, 1)"><Trash2 class="h-4 w-4" /></button>
        </div>
        <div class="grid gap-3 md:grid-cols-3">
          <div class="md:col-span-2">
            <label class="label">Expression cron (min heure jour mois jour-semaine)</label>
            <input v-model="s.cron" class="input font-mono" @input="preview(s)" />
            <div class="text-xs text-muted mt-1">{{ describeCron(s.cron) }}</div>
          </div>
          <div><label class="label">Fuseau</label><input v-model="s.timezone" class="input" placeholder="défaut global" @input="preview(s)" /></div>
          <div><label class="label">Décalage aléatoire max (s)</label><input v-model.number="s.jitter_seconds" type="number" min="0" class="input" /></div>
          <div><label class="label">Fenêtre horaire</label><input v-model="s.window" class="input font-mono" placeholder="08:00-20:00" @input="preview(s)" /></div>
          <div><label class="label">Jours exclus</label><input :value="excludeText(s)" class="input" placeholder="sun, sat, 2026-12-25" @input="s.exclude_days = ($event.target as HTMLInputElement).value.split(',').map((d) => d.trim()).filter(Boolean); preview(s)" /></div>
          <div class="flex items-center gap-2"><input :id="`cu${i}`" v-model="s.catch_up" type="checkbox" class="accent-accent h-4 w-4" /><label :for="`cu${i}`" class="text-sm">Rattraper une occurrence manquée pendant un arrêt</label></div>
        </div>
        <div v-if="spec.params.length" class="mt-4">
          <div class="label">Paramètres de ce passage</div>
          <ParamForm v-model="s.params" :params="spec.params" compact />
        </div>
        <div class="mt-4 text-xs">
          <span class="text-muted">Prochaines occurrences :</span>
          <span v-if="typeof previews[s.id!] === 'string'" class="text-err ml-1">{{ previews[s.id!] }}</span>
          <span v-else class="ml-1 inline-flex flex-wrap gap-1.5"><span v-for="d in (previews[s.id!] as string[] | undefined) ?? []" :key="d" class="chip bg-surface-2 text-text-2">{{ fmtDateShort(d) }}</span></span>
        </div>
      </div>
      <button class="btn-soft" @click="addSchedule"><Plus class="h-4 w-4" /> Ajouter une planification</button>
    </div>

    <!-- Exécution -->
    <div v-show="tab === 'exec'" class="space-y-4">
      <div class="card p-5 grid gap-4 md:grid-cols-2">
        <div class="md:col-span-2 flex gap-2">
          <button class="btn" :class="mode === 'interpreter' ? 'bg-accent-soft text-accent-2' : 'btn-soft'" @click="mode = 'interpreter'">Interpréteur</button>
          <button class="btn" :class="mode === 'command' ? 'bg-accent-soft text-accent-2' : 'btn-soft'" @click="mode = 'command'">Commande libre</button>
        </div>
        <div v-if="mode === 'interpreter'">
          <label class="label">Interpréteur</label>
          <select v-model="spec.interpreter" class="input"><option value="bash">bash</option><option value="sh">sh</option><option value="python3">python3</option><option value="node">node</option></select>
        </div>
        <div v-else><label class="label">Commande (le fichier est ajouté en argument)</label><input v-model="spec.command" class="input font-mono" placeholder="php -f" /></div>
        <div>
          <label class="label">Fichier du script</label>
          <div class="flex gap-2">
            <input v-model="spec.file" class="input font-mono" />
            <button type="button" class="btn-soft shrink-0" title="Choisir un fichier existant dans /scripts" @click="browsing = true"><FolderOpen class="h-4 w-4" /> Parcourir</button>
          </div>
        </div>
        <div><label class="label">Répertoire de travail (relatif au dossier du script)</label><input v-model="spec.workdir" class="input font-mono" placeholder="." /></div>
        <div><label class="label">Délai maximum (secondes, 0 = aucun)</label><input v-model.number="spec.timeout_seconds" type="number" min="0" class="input" /></div>
        <div class="md:col-span-2"><label class="label">Variables d'environnement (une par ligne, CLE=valeur)</label><textarea v-model="envText" class="input font-mono h-24" placeholder="LANG=fr_FR.UTF-8" /></div>
      </div>
      <div class="card p-5">
        <div class="label">Si une instance tourne encore</div>
        <div class="grid gap-2 sm:grid-cols-2">
          <label v-for="(c, k) in CONCURRENCY" :key="k" class="flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition" :class="spec.concurrency === k ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong'">
            <input v-model="spec.concurrency" type="radio" :value="k" class="mt-1 accent-accent" />
            <div><div class="text-sm font-medium">{{ c.label }}</div><div class="text-xs text-muted">{{ c.help }}</div></div>
          </label>
        </div>
      </div>
      <div class="card p-5 grid gap-4 md:grid-cols-3">
        <div class="md:col-span-3 label">Nouveaux essais en cas d'échec</div>
        <div><label class="label">Nombre d'essais au total</label><input v-model.number="spec.retry.attempts" type="number" min="1" max="50" class="input" /></div>
        <div><label class="label">Délai avant le 2e essai (s)</label><input v-model.number="spec.retry.delay_seconds" type="number" min="0" class="input" /></div>
        <div><label class="label">Facteur multiplicatif</label><input v-model.number="spec.retry.factor" type="number" min="1" step="0.5" class="input" /></div>
        <div><label class="label">Délai maximal (s)</label><input v-model.number="spec.retry.max_delay_seconds" type="number" min="0" class="input" /></div>
        <div><label class="label">Retenter seulement ces codes</label><input v-model="retryOn" class="input font-mono" placeholder="vide = tous sauf exclus" /></div>
        <div><label class="label">Ne jamais retenter ces codes</label><input v-model="noRetryOn" class="input font-mono" placeholder="2, 64" /></div>
      </div>
    </div>

    <!-- Notifications -->
    <div v-show="tab === 'notify'" class="card p-5 grid gap-4 md:grid-cols-2">
      <div class="md:col-span-2">
        <div class="label">Événements notifiés</div>
        <div class="flex flex-wrap gap-2">
          <button v-for="(l, e) in NOTIFY_EVENTS" :key="e" type="button" class="chip border px-3 py-1.5 transition" :class="spec.notify.events.includes(e) ? 'bg-accent-soft text-accent-2 border-accent/50' : 'bg-surface-2 text-text-2 border-border'" @click="spec.notify.events.includes(e) ? spec.notify.events.splice(spec.notify.events.indexOf(e), 1) : spec.notify.events.push(e)">{{ l }}</button>
        </div>
      </div>
      <div><label class="label">Sujet ntfy (vide = sujet global)</label><input v-model="spec.notify.topic" class="input" /></div>
      <div><label class="label">Serveur ntfy (vide = serveur global)</label><input v-model="spec.notify.server" class="input" /></div>
      <div><label class="label">Jeton (vide = jeton global)</label><input v-model="spec.notify.token" type="password" class="input" autocomplete="off" /></div>
      <div><label class="label">Priorité (1 à 5)</label><input v-model.number="spec.notify.priority" type="number" min="1" max="5" class="input" /></div>
      <div class="md:col-span-2"><label class="label">Étiquettes (émojis ntfy, séparés par des virgules)</label><input v-model="tagsText" class="input" placeholder="floppy_disk, house" /></div>
    </div>

    <!-- Dépendances -->
    <div v-show="tab === 'deps'" class="space-y-4">
      <DepSuggestions :interpreter="mode === 'interpreter' ? spec.interpreter : undefined" :code="code" :existing="existingDeps" @add="addDep" @add-all="addDeps" />
      <div class="card p-5 grid gap-4 md:grid-cols-3">
        <div><label class="label">Paquets apt</label><textarea v-model="depsText.apt" class="input font-mono h-32" placeholder="rsync&#10;ffmpeg" /></div>
        <div><label class="label">Paquets pip (venv dédié)</label><textarea v-model="depsText.pip" class="input font-mono h-32" placeholder="requests>=2.31&#10;rich" /></div>
        <div><label class="label">Paquets npm (NODE_PATH)</label><textarea v-model="depsText.npm" class="input font-mono h-32" placeholder="axios@1&#10;dayjs" /></div>
        <p class="md:col-span-3 text-xs text-muted">L'environnement est (re)construit automatiquement quand la liste change, sans reconstruire l'image. Le script ne se lance que lorsqu'il est prêt.</p>
      </div>
      <div class="card p-5">
        <div class="label">Binaires téléchargés (ajoutés au PATH)</div>
        <div v-for="(b, i) in spec.deps.bin" :key="i" class="grid gap-2 md:grid-cols-[1fr_2fr_2fr_auto] mb-2">
          <input v-model="b.name" class="input font-mono" placeholder="nom" />
          <input v-model="b.url" class="input font-mono" placeholder="https://…" />
          <input v-model="b.sha256" class="input font-mono" placeholder="sha256 (facultatif)" />
          <button class="btn-icon btn-ghost text-muted hover:text-err" @click="spec.deps.bin.splice(i, 1)"><Trash2 class="h-4 w-4" /></button>
        </div>
        <button class="btn-soft" @click="spec.deps.bin.push({ name: '', url: '', sha256: '' })"><Plus class="h-4 w-4" /> Ajouter un binaire</button>
      </div>
    </div>

    <!-- Code -->
    <div v-show="tab === 'code'">
      <div class="flex items-center gap-2 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{{ spec.file }}<span class="flex-1" /><span v-if="code === null" class="normal-case tracking-normal font-normal">Laisser vide pour générer un squelette.</span></div>
      <CodeEditor :model-value="code ?? ''" :lang="lang" min-height="480px" @update:model-value="code = $event" />
    </div>

    <IconPicker v-if="pickingIcon" :current="spec.icon" :color="spec.color" @close="pickingIcon = false" @pick="(n) => { spec.icon = n; pickingIcon = false; }" />
    <FileBrowser v-if="browsing" :root="isNew ? undefined : slug" :start="isNew ? undefined : slug" @close="browsing = false" @pick="pickFile" />

    <!-- YAML -->
    <div v-show="tab === 'yaml'">
      <div class="flex items-center gap-2 mb-2 text-xs text-muted">
        <span>Édition avancée : enregistrer depuis cet onglet écrit le YAML tel quel.</span>
        <span class="flex-1" />
        <button class="btn-soft" @click="applyYamlToForm"><Wand2 class="h-4 w-4" /> Appliquer au formulaire</button>
      </div>
      <CodeEditor :model-value="yamlText" lang="yaml" min-height="480px" @update:model-value="yamlText = $event; yamlDirty = true" />
    </div>
  </div>
</template>
