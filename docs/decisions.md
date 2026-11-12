# Décisions techniques

Format : contexte → décision → conséquences. Les dates sont celles de la décision.

## 2026-11-12 — Pile : Node 22 + TypeScript, Fastify, Vue 3 + Vite + Tailwind

Un seul service, un seul langage côté serveur et client, écosystème riche pour les websockets et le cron.
Fastify pour les performances et les plugins (cookie, multipart, websocket, static).

## 2026-11-12 — SQLite via `node:sqlite` plutôt que `better-sqlite3`

**Contexte.** `better-sqlite3` est un module natif : il doit être compilé ou télécharger un binaire pour la version de Node
exacte. Sur la machine de développement (Node 26) aucun binaire n'existait et la compilation échouait faute d'outils.
**Décision.** Utiliser le module intégré `node:sqlite` (`DatabaseSync`), stable depuis Node 22.13 / 23.4, API synchrone
très proche de better-sqlite3 (`prepare`, `run`, `get`, `all`).
**Conséquences.** Aucune compilation native, image Docker plus simple (pas de python/gcc dans l'étape de build), pas de
risque d'ABI au changement de version de Node. Node 22 affiche un `ExperimentalWarning` : désactivé par
`--no-warnings=ExperimentalWarning` dans le `CMD` de l'image. Les paramètres SQL sont positionnels.

## 2026-11-12 — Un dossier par script, YAML + fichier, pas de bit d'exécution

Le partage NAS (SMB) ne conserve pas toujours les permissions Unix. Le lanceur appelle toujours
`<interpréteur> <fichier> <args>` ; une commande libre (`command`) couvre les autres cas (php, perl, un binaire).

## 2026-11-12 — Surveillance du dossier : chokidar **et** relecture périodique

inotify ne fonctionne pas sur SMB/NFS. On garde chokidar (réactif en local) et une relecture complète toutes les
60 s (`SN_SCRIPTS_POLL_SECONDS`) qui compare le `mtime` du YAML pour ne recharger que ce qui a changé.

## 2026-11-12 — Partage absent : « introuvable », jamais de suppression

Si `/scripts` est démonté ou vide, les scripts connus passent en `missing`, leurs planifications sont désarmées, une
notification `missing` part. Rien n'est effacé en base ; au retour du partage tout se réarme. Supprimer un script est une
action explicite de l'utilisateur (bouton Supprimer) qui retire le dossier et la ligne, en gardant les runs passés.

## 2026-11-12 — Processus détachés dans leur propre groupe

`spawn(..., { detached: true })` donne au script son propre groupe de processus (pgid = pid). L'arrêt (manuel, délai
maximum, politique `kill`) envoie SIGTERM au groupe `-pgid`, puis SIGKILL après `SN_KILL_GRACE_SECONDS` (10 s). À la fin
d'un run, un SIGKILL de sécurité est envoyé au groupe pour les enfants qui auraient survécu. Sous Windows (dev) on
utilise `taskkill /T`.

## 2026-11-12 — Rapprochement au démarrage et fantômes

Chaque run enregistre `pid`, `pgid` et le champ `starttime` de `/proc/<pid>/stat` (détection de réutilisation du pid).
Au démarrage : un run « en cours » sans processus vivant correspondant passe en `lost` (et peut être retenté) ; un
processus encore vivant est tué (`orphan_policy = kill`, défaut) ou suivi jusqu'à sa fin (`adopt`, code de sortie alors
inconnu). Toutes les 30 s, les pids encore présents dans le groupe d'un run terminé depuis moins de 24 h sont tués.

## 2026-11-12 — Planificateur maison sur `croner`

`croner` calcule les occurrences avec fuseau. Autour : fenêtre horaire, jours exclus, décalage aléatoire (réarmé à partir
de l'occurrence théorique pour ne pas en sauter), état persistant (`schedule_state`) pour le rattrapage : si `catch_up`
est vrai et qu'une occurrence est passée entre le dernier tir connu et le démarrage, elle est rejouée une seule fois.

## 2026-11-12 — File d'attente et retries persistants

La table `queue` porte les lancements différés (`queue` de concurrence, retries avec `not_before`). Un redémarrage ne
perd rien. Les valeurs réelles des paramètres d'un retry (secrets compris) sont conservées en mémoire du processus et
réinjectées ; en base, l'historique ne stocke que les valeurs masquées.

## 2026-11-12 — Dépendances dans `/data`, pas dans l'image

pip : venv par script créé avec `uv` (repli `python -m venv` + pip), recréé seulement si l'empreinte des dépendances
change. npm : `package.json` généré + `npm install`, `NODE_PATH` posé. apt : union installée par l'entrypoint au
démarrage (cache `/data/apt-cache`), puis à chaud quand un script ajoute un paquet (via `sudo -n apt-get` limité quand
PUID ≠ 0). Binaires : téléchargés une fois, SHA-256 vérifié si fourni, `/data/bin` en tête du PATH du run.

## 2026-11-12 — Authentification minimale mais propre

Un utilisateur. `SN_PASSWORD` haché (scrypt) au premier démarrage et stocké en base ; changer la variable ensuite ne
change pas le mot de passe (sauf `SN_RESET_PASSWORD=1`). Session par cookie signé `HttpOnly`, 30 jours. Jeton d'API
`sn_…` haché en base, affiché une seule fois. Aucun secret dans le dépôt.

## 2026-11-12 — Interface : Tailwind v4 avec jetons CSS

Les couleurs sont des variables CSS (`--bg`, `--surface`, `--accent`…) exposées à Tailwind via `@theme inline`, ce qui
permet le basculement sombre/clair à l'exécution par `data-theme` sans recompiler. Sombre par défaut.
