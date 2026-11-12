# Cadrage

## Pourquoi

ScriptNymous remplace [script-server](https://github.com/bugy/script-server) pour un usage personnel : déclarer des scripts,
les lancer à la main avec ou sans paramètres, suivre leur sortie en direct, les planifier finement, et le tout dans une
interface agréable, utilisable sur téléphone (PWA). Reproches faits à script-server : interface datée, peu conviviale,
planification limitée, gestion des instances concurrentes et des processus fantômes insuffisante.

## Périmètre

- **Scripts** déclarés en YAML dans un partage NAS (`/scripts`), un dossier par script, modifiables depuis l'interface.
- **Lancement** manuel (formulaire généré), par API (jeton), par planification (cron) ; paramètres typés.
- **Suivi** : sortie en direct (websocket), journaux conservés (`/data/logs`), historique filtrable, purge réglable.
- **Planification** : cron, fuseau par script, décalage aléatoire, fenêtre horaire, jours exclus, rattrapage.
- **Robustesse** : politiques de concurrence (`skip`, `queue`, `kill`, `parallel`), retries exponentiels, délai maximum,
  rapprochement avec `/proc` au démarrage, balayage des fantômes par groupe de processus.
- **Dépendances** sans reconstruire l'image : apt (à chaud), pip (venv `uv`), npm, binaires.
- **Notifications** ntfy par événement, avec lien vers le run.
- **Un seul utilisateur** : mot de passe par variable d'environnement, session cookie, jeton d'API.
- **Déploiement** : une image Docker, un compose, deux volumes, derrière Nginx Proxy Manager.

## Hors périmètre (pour l'instant)

- Multi-utilisateurs, rôles, SSO.
- Exécution distante (agents sur d'autres machines).
- Dépendances entre scripts (enchaînements conditionnels) : faisable via un script qui appelle l'API.
- Métriques Prometheus.

## Architecture

```
┌──────────────────────────── conteneur scriptnymous ────────────────────────────┐
│  Fastify (API REST /api, websocket /api/ws, statique web/dist)                 │
│   ├─ Registry      lit /scripts/*/script.yaml, chokidar + relecture périodique │
│   ├─ Orchestrator  concurrence, file persistante, retries, notifications       │
│   ├─ Runner        spawn détaché (groupe de processus), journal, timeout       │
│   ├─ Scheduler     croner, jitter, fenêtre, exclusions, rattrapage             │
│   ├─ Reaper        rapprochement /proc au démarrage, balayage des fantômes     │
│   ├─ EnvManager    uv venv / npm / apt / binaires dans /data                   │
│   └─ Notifier      ntfy                                                        │
│  SQLite (node:sqlite) dans /data/scriptnymous.db                               │
└────────────────────────────────────────────────────────────────────────────────┘
   /scripts (NAS, lecture/écriture)                 /data (local, persistant)
```

Voir [decisions.md](decisions.md) pour les choix techniques et [format-script.md](format-script.md) pour le YAML.
