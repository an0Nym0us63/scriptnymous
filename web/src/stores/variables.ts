// Variables partagées (/scripts/config.json) : document JSON éditable par chemin, suivi des modifications.
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { api, ApiError } from '@/lib/api';

export type Path = (string | number)[];
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export const SECRET_RE = /(pass|pwd|mdp|secret|token|api[_-]?key|apikey|_key$|_api$|auth|credential|private)/i;
export const isSecretKey = (k: string | number) => typeof k === 'string' && SECRET_RE.test(k);

export function typeOf(v: JsonValue): 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as 'string' | 'number' | 'boolean' | 'object';
}

function getAt(root: JsonValue, path: Path): JsonValue {
  let cur: JsonValue = root;
  for (const k of path) cur = (cur as Record<string, JsonValue>)[k as string];
  return cur;
}

export const useVariables = defineStore('variables', () => {
  // shallowRef : le type récursif JsonValue fait exploser l'inférence de `ref` ; les mutations remplacent l'objet entier.
  const doc = shallowRef<JsonValue>({});
  const original = ref('{}');
  const mtime = ref(0);
  const exists = ref(false);
  const filePath = ref('');
  const parseError = ref<string | null>(null);
  const rawText = ref('');
  const loading = ref(false);
  const revealed = ref(new Set<string>());

  const dirty = computed(() => JSON.stringify(doc.value) !== original.value);

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const r = await api.get<{ exists: boolean; data: JsonValue | null; raw: string; mtime: number; error: string | null; path: string }>('/api/variables');
      exists.value = r.exists;
      mtime.value = r.mtime;
      filePath.value = r.path;
      parseError.value = r.error;
      rawText.value = r.raw || '{}\n';
      doc.value = r.data ?? {};
      original.value = JSON.stringify(doc.value);
    } finally {
      loading.value = false;
    }
  }

  /** Enregistre le document (ou le texte brut). Lève ApiError 409 si le fichier a changé entre-temps. */
  async function save(opts: { raw?: string; force?: boolean } = {}): Promise<void> {
    const body = opts.raw !== undefined ? { raw: opts.raw, mtime: mtime.value, force: opts.force } : { data: doc.value, mtime: mtime.value, force: opts.force };
    try {
      const r = await api.put<{ mtime: number; data: JsonValue }>('/api/variables', body);
      mtime.value = r.mtime;
      doc.value = r.data;
      original.value = JSON.stringify(doc.value);
      rawText.value = JSON.stringify(doc.value, null, 2) + '\n';
      exists.value = true;
      parseError.value = null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) throw e;
      throw e;
    }
  }

  // ---- mutations par chemin (copie-sur-écriture pour garder la réactivité simple) ----
  function mutate(fn: (root: JsonValue) => void): void {
    const copy = JSON.parse(JSON.stringify(doc.value)) as JsonValue;
    fn(copy);
    doc.value = copy;
  }
  function set(path: Path, value: JsonValue): void {
    if (!path.length) return void (doc.value = value);
    mutate((root) => {
      const parent = getAt(root, path.slice(0, -1)) as Record<string, JsonValue>;
      parent[path[path.length - 1] as string] = value;
    });
  }
  function remove(path: Path): void {
    mutate((root) => {
      const parent = getAt(root, path.slice(0, -1));
      const key = path[path.length - 1];
      if (Array.isArray(parent)) parent.splice(key as number, 1);
      else delete (parent as Record<string, JsonValue>)[key as string];
    });
  }
  /** Ajoute une clé dans un objet (ou un élément dans une liste si `key` est omis). */
  function add(path: Path, key: string | null, value: JsonValue): boolean {
    let ok = true;
    mutate((root) => {
      const target = getAt(root, path);
      if (Array.isArray(target)) target.push(value);
      else if (key !== null && target && typeof target === 'object') {
        if (key in (target as object)) ok = false;
        else (target as Record<string, JsonValue>)[key] = value;
      }
    });
    return ok;
  }
  /** Renomme une clé en conservant l'ordre. */
  function rename(path: Path, newKey: string): boolean {
    const oldKey = path[path.length - 1] as string;
    if (newKey === oldKey) return true;
    let ok = true;
    mutate((root) => {
      const parent = getAt(root, path.slice(0, -1)) as Record<string, JsonValue>;
      if (newKey in parent) return void (ok = false);
      const entries = Object.entries(parent).map(([k, v]) => [k === oldKey ? newKey : k, v] as const);
      for (const k of Object.keys(parent)) delete parent[k];
      for (const [k, v] of entries) parent[k] = v;
    });
    return ok;
  }
  function toggleReveal(key: string): void {
    const s = new Set(revealed.value);
    if (s.has(key)) s.delete(key);
    else s.add(key);
    revealed.value = s;
  }
  function discard(): void {
    doc.value = JSON.parse(original.value) as JsonValue;
  }

  return { doc, original, mtime, exists, filePath, parseError, rawText, loading, revealed, dirty, load, save, set, remove, add, rename, toggleReveal, discard };
});
