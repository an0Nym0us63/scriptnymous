# Serveur MCP

ScriptNymous expose un serveur [MCP](https://modelcontextprotocol.io) (Model Context Protocol) intégré, pour piloter
l'outil depuis un assistant : lister et lire les scripts, les créer ou les modifier, les lancer, suivre les runs et
leurs journaux, gérer les planifications, les variables partagées et les réglages.

- **Adresse** : `https://<hôte>/api/mcp` (transport *Streamable HTTP*, POST uniquement, sans session).
- **Authentification** : la même que l'API, en-tête `Authorization: Bearer <jeton>` (jeton généré dans Réglages).
  Un client sur la même origine que l'interface peut aussi utiliser le cookie de session.

## Connexion

Claude Code :

```bash
claude mcp add --transport http scriptnymous https://scripts.exemple.fr/api/mcp \
  --header "Authorization: Bearer sn_xxx"
```

Claude Desktop (ou tout client acceptant une configuration JSON de serveurs HTTP) :

```json
{
  "mcpServers": {
    "scriptnymous": {
      "type": "http",
      "url": "https://scripts.exemple.fr/api/mcp",
      "headers": { "Authorization": "Bearer sn_xxx" }
    }
  }
}
```

## Outils

| Outil                    | Rôle                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `list_scripts`           | scripts avec état, paramètres, planifications, dernier run (filtre `group`)            |
| `get_script`             | spec complète, YAML, code, journal d'environnement, file d'attente                     |
| `save_script`            | crée ou modifie : `spec` (objet) ou `yaml` (texte), `code` facultatif                  |
| `delete_script`          | supprime le dossier et la déclaration (`confirm: true`)                                |
| `read_script_file` / `write_script_file` | fichiers annexes du dossier d'un script                                |
| `browse_scripts_dir`     | parcourt `/scripts` (dossiers déjà déclarés signalés)                                  |
| `reload_scripts`         | relit le dossier                                                                       |
| `run_script`             | lance avec `params`, respecte la politique de concurrence                              |
| `wait_run`               | attend la fin d'un run et renvoie son état et la fin du journal                        |
| `stop_run`               | arrêt (SIGTERM puis SIGKILL)                                                           |
| `list_runs` / `get_run` / `get_run_log` | historique, détail, journal (tail ou offset)                            |
| `get_activity`           | installations en cours, runs en cours, file d'attente                                  |
| `rebuild_env`            | reconstruit l'environnement de dépendances                                             |
| `suggest_dependencies`   | déduit pip/npm/apt d'un code ou d'un journal d'échec                                   |
| `list_schedules` / `preview_schedule` | planifications et prochaines occurrences d'un cron                        |
| `get_variables` / `set_variable` / `delete_variable` | fichier JSON partagé, par chemin pointé (`A.B.0.c`)        |
| `get_settings` / `update_settings` / `test_ntfy` | réglages globaux                                               |

Les secrets (paramètres `secret`, variables dont la clé évoque un mot de passe ou un jeton, jeton ntfy) sont masqués
dans les réponses sauf demande explicite (`get_variables` avec `reveal: true`).

## Exemple de dialogue

> « Crée un script bash `maison/arrosage` qui appelle l'API du programmateur avec un paramètre `zone` (choix : jardin,
> potager) et planifie-le tous les jours à 7 h sauf le dimanche, puis lance-le une fois sur la zone potager et montre-moi
> le journal. »

L'assistant enchaîne `save_script` (spec + code), `run_script`, `wait_run`, `get_run_log`.
