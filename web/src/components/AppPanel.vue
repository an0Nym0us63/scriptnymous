<script setup lang="ts">
// Onglet « Suivi » générique d'un script : une section par table déclarée dans app.tables, rendue d'après sa `view`
// (titre, sous-titre, statut, date, vignette, groupe, lien). Filtres par statut et groupe, recherche, pagination.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { Search, ExternalLink, Trash2, RefreshCw, ChevronDown } from 'lucide-vue-next';
import { api } from '@/lib/api';
import { onWs } from '@/lib/ws';
import { fmtDateShort, relative, toneClasses } from '@/lib/format';
import { useApp } from '@/stores/app';

interface View { title?: string; subtitle?: string; status?: string; date?: string; thumbnail?: string; group?: string; link?: string; labels: Record<string, string> }
interface TableSpec { columns: Record<string, string>; key?: string; order?: string; view?: View; max_rows: number }
interface Stats { total: number; by_status: Record<string, number>; groups: { group: string; count: number }[]; last_update: string | null }

const props = defineProps<{ slug: string; app: { title?: string; tables: Record<string, TableSpec> } }>();
const appStore = useApp();
const now = ref(Date.now());
const stats = reactive<Record<string, Stats>>({});
const rows = reactive<Record<string, Record<string, unknown>[]>>({});
const totals = reactive<Record<string, number>>({});
const filters = reactive<Record<string, { status: string; group: string; q: string; limit: number }>>({});
let tick: number;
let unsub: (() => void) | null = null;
let timer: number | null = null;

const tables = computed(() => Object.entries(props.app.tables));
const STATUS_LABEL: Record<string, string> = { ok: 'OK', pending: 'En attente', warn: 'Attention', error: 'Erreur', info: 'Info' };
const STATUS_TONE: Record<string, string> = { ok: 'ok', pending: 'info', warn: 'warn', error: 'err', info: 'muted' };
const labelOf = (t: TableSpec, s: string) => t.view?.labels?.[s] ?? STATUS_LABEL[s] ?? s;

const base = () => `/api/scripts/${encodeURIComponent(props.slug)}`;
const field = (row: Record<string, unknown>, spec?: string): unknown => {
  if (!spec) return undefined;
  if (spec.startsWith('=')) return spec.slice(1);
  return row[spec];
};
const thumbUrl = (row: Record<string, unknown>, t: TableSpec): string | null => {
  const v = field(row, t.view?.thumbnail);
  if (!v || typeof v !== 'string') return null;
  if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v;
  return `${base()}/files/${v.split('/').map(encodeURIComponent).join('/')}`;
};
const statusOf = (row: Record<string, unknown>, t: TableSpec): string => String(field(row, t.view?.status) ?? 'ok');
const keyOf = (row: Record<string, unknown>, t: TableSpec): string => String(t.key ? row[t.key] : row._id);
/** Colonnes non couvertes par la vue : affichées en petits champs. */
const extraCols = (t: TableSpec): string[] => {
  const used = new Set(Object.values(t.view ?? {}).filter((v) => typeof v === 'string') as string[]);
  return Object.keys(t.columns).filter((c) => !used.has(c)).slice(0, 6);
};

async function loadTable(name: string): Promise<void> {
  const f = filters[name];
  const q = new URLSearchParams({ limit: String(f.limit) });
  if (f.q) q.set('q', f.q);
  const t = props.app.tables[name];
  if (f.status && t.view?.status && !t.view.status.startsWith('=')) q.set(t.view.status, f.status);
  if (f.group && t.view?.group) q.set(t.view.group, f.group);
  const [list, st] = await Promise.all([
    api.get<{ rows: Record<string, unknown>[]; total: number }>(`${base()}/db/${name}?${q}`),
    api.get<Stats>(`${base()}/db/${name}/stats`),
  ]);
  rows[name] = list.rows;
  totals[name] = list.total;
  stats[name] = st;
}
async function loadAll(): Promise<void> {
  await Promise.all(tables.value.map(([n]) => loadTable(n).catch(() => {})));
}
function scheduleLoad(): void {
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(() => void loadAll(), 400);
}
async function removeRow(name: string, row: Record<string, unknown>): Promise<void> {
  const t = props.app.tables[name];
  await api.del(`${base()}/db/${name}/${encodeURIComponent(keyOf(row, t))}`);
  await loadTable(name);
}
async function clearStatus(name: string, status: string): Promise<void> {
  const t = props.app.tables[name];
  if (!t.view?.status || t.view.status.startsWith('=')) return;
  if (!confirm(`Supprimer les ${stats[name]?.by_status[status] ?? 0} ligne(s) « ${labelOf(t, status)} » ?`)) return;
  await api.del(`${base()}/db/${name}?${t.view.status}=${encodeURIComponent(status)}`);
  await loadTable(name);
  appStore.toast('ok', 'Lignes supprimées');
}

for (const [n] of tables.value) filters[n] = { status: '', group: '', q: '', limit: 60 };
watch(filters, scheduleLoad, { deep: true });
onMounted(() => {
  void loadAll();
  tick = window.setInterval(() => (now.value = Date.now()), 30_000);
  unsub = onWs((m) => m.type === 'app:changed' && m.slug === props.slug && scheduleLoad());
});
onBeforeUnmount(() => {
  clearInterval(tick);
  unsub?.();
});
</script>

<template>
  <div class="space-y-6">
    <section v-for="[name, t] in tables" :key="name" class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="font-semibold capitalize">{{ name }}</h2>
        <span class="text-xs text-muted">{{ stats[name]?.total ?? 0 }} ligne{{ (stats[name]?.total ?? 0) > 1 ? 's' : '' }}<span v-if="stats[name]?.last_update"> · mis à jour {{ relative(stats[name].last_update, now) }}</span></span>
        <span class="flex-1" />
        <button class="btn-icon btn-ghost" title="Rafraîchir" @click="loadTable(name)"><RefreshCw class="h-4 w-4" /></button>
      </div>

      <!-- Statuts -->
      <div v-if="stats[name] && Object.keys(stats[name].by_status).length" class="flex flex-wrap gap-2">
        <button
          v-for="(n, s) in stats[name].by_status"
          :key="s"
          class="chip border px-3 py-1.5 transition"
          :class="filters[name].status === s ? 'border-accent bg-accent-soft text-accent-2' : `border-transparent ${toneClasses(STATUS_TONE[s] ?? 'muted')}`"
          @click="filters[name].status = filters[name].status === s ? '' : String(s)"
        >
          <span class="font-semibold">{{ n }}</span> {{ labelOf(t, String(s)) }}
        </button>
        <button v-if="filters[name].status && t.view?.status && !t.view.status.startsWith('=')" class="chip bg-surface-2 text-muted hover:text-err border border-border" @click="clearStatus(name, filters[name].status)"><Trash2 class="h-3 w-3" /> vider « {{ labelOf(t, filters[name].status) }} »</button>
      </div>

      <!-- Groupes + recherche -->
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative">
          <Search class="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input v-model="filters[name].q" class="input pl-9 !w-64" placeholder="Rechercher…" />
        </div>
        <select v-if="stats[name]?.groups.length" v-model="filters[name].group" class="input !w-auto">
          <option value="">Tous les groupes</option>
          <option v-for="g in stats[name].groups" :key="g.group" :value="g.group">{{ g.group }} ({{ g.count }})</option>
        </select>
      </div>

      <!-- Lignes -->
      <div v-if="!rows[name]?.length" class="card p-6 text-sm text-muted text-center">Rien pour l'instant.</div>
      <div v-else class="grid gap-2" :class="t.view?.thumbnail ? 'sm:grid-cols-2 xl:grid-cols-3' : ''">
        <div v-for="row in rows[name]" :key="keyOf(row, t)" class="card group/row p-3 flex gap-3 items-start">
          <a v-if="thumbUrl(row, t)" :href="(field(row, t.view?.link) as string) || thumbUrl(row, t)!" target="_blank" rel="noopener" class="shrink-0">
            <img :src="thumbUrl(row, t)!" alt="" class="h-20 w-28 object-cover rounded-lg bg-surface-2" loading="lazy" />
          </a>
          <div class="min-w-0 flex-1">
            <div class="flex items-start gap-2">
              <div class="min-w-0 flex-1">
                <div class="font-medium text-sm truncate" :title="String(field(row, t.view?.title) ?? keyOf(row, t))">{{ field(row, t.view?.title) ?? keyOf(row, t) }}</div>
                <div v-if="field(row, t.view?.subtitle)" class="text-xs text-text-2 truncate" :title="String(field(row, t.view?.subtitle))">{{ field(row, t.view?.subtitle) }}</div>
              </div>
              <span class="chip shrink-0" :class="toneClasses(STATUS_TONE[statusOf(row, t)] ?? 'muted')">{{ labelOf(t, statusOf(row, t)) }}</span>
            </div>
            <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
              <span v-if="field(row, t.view?.group)" class="font-medium text-text-2">{{ field(row, t.view?.group) }}</span>
              <span v-if="field(row, t.view?.date)" :title="String(field(row, t.view?.date))">{{ fmtDateShort(String(field(row, t.view?.date))) }}</span>
              <span v-for="c in extraCols(t)" :key="c" v-show="row[c] !== null && row[c] !== undefined && row[c] !== ''" class="font-mono"><span class="opacity-60">{{ c }}=</span>{{ typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c] }}</span>
            </div>
          </div>
          <div class="flex flex-col gap-1 opacity-0 group-hover/row:opacity-100 transition">
            <a v-if="field(row, t.view?.link)" :href="String(field(row, t.view?.link))" target="_blank" rel="noopener" class="btn-icon btn-ghost p-1" title="Ouvrir"><ExternalLink class="h-3.5 w-3.5" /></a>
            <button class="btn-icon btn-ghost p-1 text-muted hover:text-err" title="Supprimer" @click="removeRow(name, row)"><Trash2 class="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>
      <div v-if="(totals[name] ?? 0) > (rows[name]?.length ?? 0)" class="text-center">
        <button class="btn-soft" @click="filters[name].limit += 60"><ChevronDown class="h-4 w-4" /> Afficher plus ({{ totals[name] - rows[name].length }} restantes)</button>
      </div>
    </section>
  </div>
</template>
