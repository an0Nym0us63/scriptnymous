# Mini-app par script (onglet « Suivi »)

Chaque script peut avoir un espace persistant qui lui est propre : des **tables** déclarées dans son `script.yaml`,
un **dossier de fichiers** (vignettes, caches) et, au choix, une vue générique ou une **sous-app HTML** servie dans
l'onglet du script. ScriptNymous fournit le stockage, l'API et l'affichage ; le script ne fait qu'écrire ses données.

## Déclaration

```yaml
app:
  title: Suivi photos                 # nom de l'onglet (défaut : Suivi)
  # page: panel/index.html            # sous-app HTML facultative (voir plus bas)
  tables:
    medias:
      key: path                       # clé : insertion ou mise à jour par cette colonne
      order: -taken_at                # tri par défaut (- = décroissant)
      max_rows: 5000                  # rétention (0 = illimité)
      columns:
        path: text!                   # « ! » = obligatoire
        status: text                  # ok | pending | warn | error | info (libre)
        taken_at: datetime
        dest: text
        thumb: text                   # chemin relatif dans le dossier de fichiers, ou URL
        size: integer
        meta: json
      view:                           # comment la vue générique affiche une ligne
        title: path
        subtitle: dest
        status: status
        date: taken_at
        thumbnail: thumb
        labels: { ok: Rangée, pending: À traiter, error: Échec }
    leftovers:
      key: path
      columns: { path: text!, reason: text, seen_at: datetime }
      view: { title: path, subtitle: reason, status: "=pending", date: seen_at }
```

Types : `text`, `integer`, `real`, `boolean`, `datetime` (ISO 8601), `json`. Les tables sont créées au chargement du
YAML ; une colonne ajoutée ensuite est créée, une colonne retirée est laissée en place. Chaque ligne porte en plus
`_id`, `_created_at`, `_updated_at`, `_run_id`.

## Ce que reçoit le script

| Variable        | Contenu                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `SN_APP_DB`     | `/data/apps/<slug>/app.db` : base SQLite du script (tables ci-dessus)   |
| `SN_APP_DATA`   | `/data/apps/<slug>/files` : dossier libre, servi sous `…/files/`        |
| `SN_APP_API`    | `http://127.0.0.1:8080/api/scripts/<slug>` : base de l'API du script    |
| `SN_RUN_TOKEN`  | jeton du run, accepté par l'API du script et par les notifications      |

Deux façons d'écrire, au choix :

**1. SQLite directement** (Python, même machine) — simple et rapide :

```python
import os, sqlite3
db = sqlite3.connect(os.environ["SN_APP_DB"])
db.execute("INSERT INTO medias (path, status, taken_at, dest, thumb, _created_at, _updated_at) VALUES (?,?,?,?,?,datetime('now'),datetime('now'))"
           " ON CONFLICT(path) DO UPDATE SET status=excluded.status, dest=excluded.dest, _updated_at=excluded._updated_at",
           (p, "ok", dt.isoformat(), dest, "thumbs/x.jpg"))
db.commit()
```

**2. L'API** (bash, Node, machine distante) :

```bash
curl -s -X POST "$SN_APP_API/db/medias" -H "Authorization: Bearer $SN_RUN_TOKEN" -H "Content-Type: application/json" \
  -d '[{"path":"/photohome/a.jpg","status":"ok","taken_at":"2024-07-14T10:30:00","dest":"2024/07-juillet"}]'
curl -s -X PUT "$SN_APP_API/files/thumbs/a.jpg" -H "Authorization: Bearer $SN_RUN_TOKEN" -H "Content-Type: image/jpeg" --data-binary @/tmp/a.jpg
```

## API

Toutes sous `/api/scripts/<slug>/`, avec session, jeton d'API ou jeton de run (limité au script du run) :

| Méthode | Route                         | Description                                                                 |
| ------- | ----------------------------- | --------------------------------------------------------------------------- |
| GET     | `app`                         | configuration de la mini-app et statistiques de chaque table                 |
| GET     | `db/<table>`                  | `?<colonne>=valeur&q=texte&sort=-col&limit=&offset=` → `{ rows, total }`     |
| GET     | `db/<table>/stats`            | total, par statut, par groupe, dernière mise à jour                          |
| GET     | `db/<table>/<clé>`            | une ligne                                                                    |
| POST    | `db/<table>`                  | objet, liste ou `{ rows }` : insertion ou mise à jour par clé                |
| PATCH   | `db/<table>/<clé>`            | mise à jour partielle                                                        |
| DELETE  | `db/<table>/<clé>`            | suppression d'une ligne                                                      |
| DELETE  | `db/<table>?<colonne>=valeur` | suppression par filtre (sans filtre : vide la table)                         |
| GET     | `files/<chemin>`              | fichier du dossier de données (vignettes…)                                   |
| PUT     | `files/<chemin>`              | dépôt d'un fichier (corps brut, 50 Mo max)                                   |
| GET     | `app/page/`                   | la sous-app HTML si `app.page` est déclaré                                   |

Le MCP expose `app_tables`, `app_query`, `app_upsert`, `app_delete`.

## Vue générique

Sans `page`, l'onglet affiche une section par table : compteurs par statut (cliquables pour filtrer), filtre par
groupe, recherche, cartes avec vignette, titre, sous-titre, date, groupe et les autres colonnes en petit. Les
statuts `ok`, `pending`, `warn`, `error`, `info` ont des couleurs ; `labels` permet de les renommer. La carte du
script sur le tableau de bord affiche les compteurs « en attente » et « en erreur » de la première table.

## Sous-app dédiée

Avec `page: panel/index.html`, le dossier `panel/` du script est servi tel quel (HTML, JS, CSS, images) et affiché
dans l'onglet, en même origine que l'interface : la page appelle l'API ci-dessus avec la session en cours, sans jeton.
Elle reçoit `?theme=dark|light&slug=<slug>` dans son URL. Exemple minimal :

```html
<!doctype html><meta charset="utf-8">
<script type="module">
  const slug = new URLSearchParams(location.search).get('slug');
  const r = await fetch(`/api/scripts/${encodeURIComponent(slug)}/db/medias?status=pending`);
  const { rows } = await r.json();
  document.body.innerHTML = rows.map(m => `<p>${m.path}</p>`).join('');
</script>
```

La page peut aussi lancer le script (`POST …/run`), lire les runs et leurs journaux : tout ce que l'interface sait faire.
