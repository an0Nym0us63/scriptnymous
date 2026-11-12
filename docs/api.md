# API

Base : `/api`. Authentification : cookie de session (navigateur) ou en-tête `Authorization: Bearer <jeton>` (jeton généré
dans Réglages). Toutes les réponses sont en JSON ; une erreur renvoie `{ "error": "message" }`.

## Santé

| Méthode | Route      | Description                                                    |
| ------- | ---------- | -------------------------------------------------------------- |
| GET     | `/healthz` | Sans authentification : `{ ok, scriptsDir, running, uptime }`  |

## Authentification

| Méthode | Route                 | Corps / réponse                                         |
| ------- | --------------------- | ------------------------------------------------------- |
| GET     | `/api/auth/status`    | `{ authenticated, passwordConfigured }`                 |
| POST    | `/api/auth/login`     | `{ password }` → cookie de session                      |
| POST    | `/api/auth/logout`    |                                                         |
| POST    | `/api/auth/password`  | `{ current, next }`                                     |
| GET     | `/api/auth/token`     | `{ set, prefix }`                                       |
| POST    | `/api/auth/token`     | (session seulement) → `{ token }` affiché une seule fois |
| DELETE  | `/api/auth/token`     | révoque le jeton                                        |

## Scripts

| Méthode | Route                               | Description                                                                 |
| ------- | ----------------------------------- | --------------------------------------------------------------------------- |
| GET     | `/api/scripts`                      | liste enrichie (dernier run, en cours, prochains passages, environnement)   |
| POST    | `/api/scripts/reload`               | relit le dossier des scripts                                                |
| GET     | `/api/scripts/:slug`                | détail + `yaml`, `code`, `env_log`, `queue`                                 |
| PUT     | `/api/scripts/:slug`                | crée/modifie : `{ spec }` (objet) ou `{ yaml }` (texte), `code` facultatif  |
| DELETE  | `/api/scripts/:slug`                | supprime le dossier et la déclaration (runs conservés)                      |
| POST    | `/api/scripts/:slug/run`            | lance : `{ params: {...} }` ou multipart (champs + fichiers)                |
| POST    | `/api/scripts/:slug/env/rebuild`    | reconstruit l'environnement de dépendances                                  |
| DELETE  | `/api/scripts/:slug/queue`          | vide la file d'attente du script                                            |
| GET     | `/api/groups`                       | `{ groups: [...] }`                                                         |

Réponses de `POST …/run` :

- `201 { outcome: "started", run }`
- `202 { outcome: "queued", queueId }` (politique `queue`)
- `200 { outcome: "skipped", reason, run }` (politique `skip`)
- `409 { error, outcome: "rejected" }` (script introuvable/invalide, environnement non prêt, paramètre invalide, politique `kill` en cours d'arrêt)

Exemple :

```bash
curl -X POST https://scripts.exemple.fr/api/scripts/hello-bash/run \
  -H "Authorization: Bearer sn_xxx" -H "Content-Type: application/json" \
  -d '{"params": {"prenom": "api", "compte": 3}}'
```

## Planifications

| Méthode | Route                      | Description                                                   |
| ------- | -------------------------- | ------------------------------------------------------------- |
| GET     | `/api/schedules`           | toutes les planifications avec `next_at`, `last_fired_at`     |
| POST    | `/api/schedules/preview`   | corps = une planification → `{ next: [5 dates ISO] }`         |

## Runs

| Méthode | Route                          | Description                                                        |
| ------- | ------------------------------ | ------------------------------------------------------------------ |
| GET     | `/api/runs`                    | `?slug&status&trigger&limit&offset` → `{ runs, total }`            |
| GET     | `/api/runs/:id`                | `{ run, script }`                                                  |
| GET     | `/api/runs/:id/log`            | `?from=<octets>` (suite) ou `?tail=1` → `{ text, offset, size, status }` |
| GET     | `/api/runs/:id/log/download`   | journal complet en `text/plain`                                    |
| POST    | `/api/runs/:id/stop`           | SIGTERM puis SIGKILL après le délai de grâce                       |
| DELETE  | `/api/runs/:id`                | supprime le run et son journal                                     |
| GET     | `/api/queue`                   | file d'attente globale                                             |
| DELETE  | `/api/queue/:id`               | retire un élément de la file                                       |

## Réglages

| Méthode | Route                        | Description                                                   |
| ------- | ---------------------------- | ------------------------------------------------------------- |
| GET     | `/api/settings`              | `{ settings, system }` (le jeton ntfy n'est jamais renvoyé)   |
| PUT     | `/api/settings`              | champs : `ntfy_server`, `ntfy_topic`, `ntfy_token` (`null` efface), `public_url`, `log_retention_days`, `log_max_mb`, `orphan_policy`, `timezone` |
| POST    | `/api/settings/ntfy/test`    | envoie une notification de test                               |
| POST    | `/api/settings/purge`        | purge immédiate des journaux                                  |
| GET     | `/api/notifications`         | 50 dernières notifications envoyées (diagnostic)              |

## Websocket `/api/ws`

Même authentification (cookie). Messages serveur → client (JSON, champ `type`) :
`hello { running: [ids] }`, `run:created|run:started|run:finished|run:updated { run }`,
`run:output { runId, slug, chunk, stream }`, `script:changed { slug }`, `env:changed { slug, status }`,
`queue:changed { slug }`, `schedule:armed { slug, scheduleId, nextAt }`, `scripts:reloaded { count }`.

Messages client → serveur : `{ op: "subscribe", runId }`, `{ op: "unsubscribe", runId }`, `{ op: "subscribe_all" }`,
`{ op: "ping" }`. La sortie (`run:output`) n'est envoyée que pour les runs souscrits.
