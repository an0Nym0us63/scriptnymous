// Base SQLite par script : création des tables, évolution, upsert par clé, filtres, statistiques, rétention.
import { describe, expect, it } from 'vitest';
import { AppDbManager, AppDbError } from '../core/appdb.js';
import { parseSpec } from '../core/spec.js';

const YAML = `
name: Test app
interpreter: bash
file: a.sh
app:
  title: Suivi
  tables:
    medias:
      key: path
      order: -taken_at
      max_rows: 3
      columns: { path: text!, status: text, taken_at: datetime, size: integer, ok: boolean, meta: json, channel: text }
      view: { title: path, status: status, date: taken_at, group: channel }
    leftovers:
      columns: { path: text!, reason: text }
      view: { title: path, status: "=pending" }
`;

describe('mini-app : base par script', () => {
  const mgr = new AppDbManager();
  const spec = parseSpec(YAML);
  const slug = 'test-app-' + Date.now().toString(36);

  it('crée les tables et insère/met à jour par clé', () => {
    mgr.ensure(slug, spec.app);
    const r = mgr.upsert(slug, spec.app, 'medias', [
      { path: '/a.jpg', status: 'ok', taken_at: '2024-01-01T10:00:00Z', size: 10, ok: true, meta: { x: 1 }, channel: 'A' },
      { path: '/b.jpg', status: 'pending', taken_at: '2024-02-01T10:00:00Z', size: 20, ok: false, channel: 'B' },
    ], 'run1');
    expect(r.upserted).toBe(2);
    mgr.upsert(slug, spec.app, 'medias', [{ path: '/a.jpg', status: 'error' }], 'run2');
    const a = mgr.get(slug, spec.app, 'medias', '/a.jpg')!;
    expect(a.status).toBe('error');
    expect(a.size).toBe(10); // champ absent du second upsert : conservé
    expect(a.ok).toBe(true);
    expect(a.meta).toEqual({ x: 1 });
    expect(mgr.list(slug, spec.app, 'medias').total).toBe(2);
  });

  it('filtre, cherche, trie et calcule les statistiques', () => {
    expect(mgr.list(slug, spec.app, 'medias', { filters: { status: 'pending' } }).rows.map((r) => r.path)).toEqual(['/b.jpg']);
    expect(mgr.list(slug, spec.app, 'medias', { q: 'b.jp' }).total).toBe(1);
    expect(mgr.list(slug, spec.app, 'medias').rows.map((r) => r.path)).toEqual(['/b.jpg', '/a.jpg']); // -taken_at
    const st = mgr.stats(slug, spec.app, 'medias');
    expect(st.total).toBe(2);
    expect(st.by_status).toEqual({ error: 1, pending: 1 });
    expect(st.groups).toEqual([{ group: 'A', count: 1 }, { group: 'B', count: 1 }]);
    expect(mgr.stats(slug, spec.app, 'leftovers').by_status).toEqual({ pending: 0 });
  });

  it('refuse les colonnes inconnues, les champs obligatoires manquants et les tables inconnues', () => {
    expect(() => mgr.upsert(slug, spec.app, 'medias', [{ path: '/c', foo: 1 }], null)).toThrow(AppDbError);
    expect(() => mgr.upsert(slug, spec.app, 'medias', [{ status: 'ok' }], null)).toThrow(/obligatoire/);
    expect(() => mgr.list(slug, spec.app, 'nope')).toThrow(/Table inconnue/);
    expect(() => mgr.list(slug, spec.app, 'medias', { sort: 'hack' })).toThrow(/tri/);
  });

  it('applique la rétention max_rows et la mise à jour partielle', () => {
    mgr.upsert(slug, spec.app, 'medias', [{ path: '/c.jpg' }, { path: '/d.jpg' }], null);
    expect(mgr.list(slug, spec.app, 'medias').total).toBe(3);
    expect(mgr.patch(slug, spec.app, 'medias', '/d.jpg', { status: 'ok' })).toBe(true);
    expect(mgr.get(slug, spec.app, 'medias', '/d.jpg')!.status).toBe('ok');
    expect(mgr.delete(slug, spec.app, 'medias', '/d.jpg')).toBe(true);
    expect(mgr.deleteWhere(slug, spec.app, 'medias', { status: 'pending' })).toBeGreaterThanOrEqual(0);
  });

  it('ajoute une colonne quand la déclaration évolue', () => {
    const evolved = parseSpec(YAML.replace('channel: text }', 'channel: text, note: text }'));
    mgr.ensure(slug, evolved.app);
    mgr.upsert(slug, evolved.app, 'medias', [{ path: '/e.jpg', note: 'nouvelle colonne' }], null);
    expect(mgr.get(slug, evolved.app, 'medias', '/e.jpg')!.note).toBe('nouvelle colonne');
    mgr.close(slug);
  });

  it('rejette une section app incohérente au niveau du YAML', () => {
    expect(() => parseSpec(YAML.replace('key: path', 'key: nope'))).toThrow(/clé/);
    expect(() => parseSpec(YAML.replace('title: path, status', 'title: zzz, status'))).toThrow(/colonne inconnue/);
  });
});
