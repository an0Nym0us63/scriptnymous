# Format de déclaration d'un script (`script.yaml`)

Chaque script vit dans son propre dossier sous `/scripts/` :

```
/scripts/
└── sauvegarde-nocturne/        ← le nom du dossier est l'identifiant (slug) du script
    ├── script.yaml             ← la déclaration décrite ici
    ├── backup.sh               ← le fichier du script (nom libre, déclaré dans `file`)
    └── …                       ← tout autre fichier utile (le dossier est le répertoire de travail par défaut)
```

L'identifiant (slug) est le chemin du dossier relatif à `/scripts`. Les sous-dossiers sont autorisés jusqu'à 4 niveaux
(`Photos/tri-doublons`), ainsi que les majuscules et les espaces : on peut adopter une arborescence existante sans la
renommer. Interdits : `..`, les noms commençant par un point, les caractères `\ : * ? " < > |`. Un dossier déclaré
(contenant `script.yaml`) n'est pas exploré plus bas : ses sous-dossiers lui appartiennent. Le bit d'exécution n'est pas
nécessaire : ScriptNymous appelle toujours l'interpréteur déclaré avec le fichier en argument.

Le dossier est surveillé (inotify) et relu périodiquement (toutes les 60 s par défaut, utile sur SMB/NFS où inotify ne
fonctionne pas). Un fichier modifié est pris en compte sans redémarrage. L'édition depuis l'interface réécrit
`script.yaml` et le fichier du script dans ce même dossier (les commentaires du YAML ne sont pas conservés).

## Exemple complet

```yaml
name: Sauvegarde nocturne            # obligatoire : nom affiché
description: rsync des documents vers le NAS puis rotation.
group: Maison                        # facultatif, libre : regroupe les cartes du tableau de bord
icon: hard-drive                     # nom d'icône lucide (terminal par défaut)
color: "#22c55e"                     # couleur d'accent de la carte

interpreter: bash                    # bash | sh | python3 | node — OU `command` (voir plus bas)
# command: php -f                    # commande libre ; le fichier est ajouté en dernier argument
file: backup.sh                      # obligatoire : fichier relatif au dossier du script
workdir: .                           # facultatif : répertoire de travail, relatif au dossier du script
env:                                 # variables d'environnement supplémentaires
  RSYNC_RSH: ssh -o BatchMode=yes
timeout_seconds: 3600                # 0 = aucun délai maximum ; sinon SIGTERM puis SIGKILL après 10 s de grâce
enabled: true                        # false = planifications suspendues (lancement manuel toujours possible)

params:
  - name: cible                      # obligatoire, identifiant (lettres, chiffres, _ -)
    label: Destination               # libellé affiché
    description: Où envoyer la sauvegarde.
    type: choice                     # text | number | boolean | choice | multichoice | file | secret
    choices: [nas, cloud]            # requis pour choice / multichoice
    default: nas
    required: true
    pass: positional                 # positional (défaut) | option | env
  - name: dry_run
    label: Simulation
    type: boolean
    pass: option                     # booléen en option : ajoute `--dry-run` seulement si vrai
    as: dry-run                      # nom de l'option (ou de la variable d'environnement) ; défaut : `name`
  - name: jours
    type: number
    default: 7
    min: 1
    max: 90
    pass: option                     # → --jours 7
  - name: token
    type: secret                     # masqué dans l'interface et dans l'historique
    pass: env                        # → variable TOKEN
  - name: liste
    type: file                       # fichier téléversé ; le script reçoit son chemin
  - name: categories
    type: multichoice
    choices: [photos, documents, musique]
    pass: option                     # → --categories photos --categories documents

concurrency: skip                    # skip (défaut) | queue | kill | parallel

retry:
  attempts: 3                        # nombre total d'essais (1 = pas de retry)
  delay_seconds: 60                  # délai avant le 2e essai
  factor: 2                          # multiplicateur à chaque essai suivant (60 s, 120 s, 240 s…)
  max_delay_seconds: 3600
  retry_on: []                       # si non vide : seuls ces codes de sortie sont retentés
  no_retry_on: [2]                   # ces codes ne sont jamais retentés

schedules:
  - id: nuit                         # facultatif mais recommandé (stable à travers les éditions) ; défaut s1, s2…
    name: Chaque nuit
    cron: "30 2 * * *"               # 5 champs : min heure jour mois jour-de-semaine
    timezone: Europe/Paris           # défaut : fuseau global (TZ / page Réglages)
    enabled: true
    jitter_seconds: 300              # décalage aléatoire de 0 à 300 s ajouté à chaque occurrence
    window: "01:00-06:00"            # occurrences hors de la fenêtre ignorées (peut passer minuit : 22:00-06:00)
    exclude_days: [sun, 2026-12-25]  # jours de semaine (mon…sun) ou dates ISO
    catch_up: true                   # rejoue une occurrence manquée pendant un arrêt du service (une seule fois)
    params:                          # valeurs des paramètres pour ce passage
      cible: nas
      jours: 14

notify:
  topic: maison-alertes              # défaut : sujet global
  # server: https://ntfy.exemple.fr  # défaut : serveur global
  # token: tk_xxx                    # défaut : jeton global (préférer la page Réglages ou SN_NTFY_TOKEN)
  events: [failure, final_failure, missing, lost]
  # start | success | failure | final_failure | already_running | missing | lost
  priority: 4                        # 1 (min) à 5 (urgent)
  tags: [floppy_disk]                # émojis/étiquettes ntfy

deps:
  apt: [rsync]                       # installés dans le conteneur (au démarrage, et à chaud à l'ajout)
  pip: [requests>=2.31]              # venv dédié : /data/envs/<slug>/venv (uv)
  npm: [dayjs@1]                     # /data/envs/<slug>/node, NODE_PATH posé au lancement
  bin:                               # binaires téléchargés dans /data/bin, ajoutés au PATH
    - name: rclone
      url: https://exemple.fr/rclone-linux-amd64
      sha256: 0123…                  # facultatif mais recommandé (64 hexadécimaux)
```

## Passage des paramètres

| `pass`       | Résultat                                                          |
| ------------ | ----------------------------------------------------------------- |
| `positional` | ajouté dans l'ordre de déclaration : `script.sh nas`              |
| `option`     | `--nom valeur` ; booléen : `--nom` seulement si vrai ; multichoice : option répétée |
| `env`        | variable d'environnement `NOM` (ou `as` en majuscules)            |

Quel que soit le mode, chaque valeur est aussi exposée dans `SN_PARAM_<NOM>`. Le lanceur pose en plus :
`SN_RUN_ID`, `SN_SCRIPT`, `SN_TRIGGER` (`manual`, `schedule`, `api`, `retry`, `catch_up`), `SN_ATTEMPT`,
`SN_DATA_DIR`, `SN_SCRIPTS_DIR`, `SN_CONFIG_FILE` (chemin de `/scripts/config.json`, les variables partagées éditables
depuis la page Variables), `PYTHONUNBUFFERED=1`.

Un paramètre `secret` est passé tel quel au script mais stocké masqué (`••••••`) dans l'historique.
Un paramètre `file` reçoit le chemin du fichier téléversé (`/data/uploads/<id>/<nom>`).

## Mini-app et tables par script

Une section `app:` déclare des tables SQLite propres au script, un dossier de fichiers et un onglet « Suivi » (vue
générique ou sous-app HTML). Voir [app.md](app.md).

## Notifier depuis un script

Un script n'a pas besoin de connaître ntfy : ScriptNymous lui fournit un canal prêt à l'emploi pendant le run, avec le
sujet, le serveur et le jeton configurés (globaux, ou surchargés dans `notify:` du script).

| Variable          | Contenu                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `SN_NOTIFY_URL`   | `http://127.0.0.1:8080/api/runs/<run>/notify`                      |
| `SN_RUN_TOKEN`    | jeton jetable, valable pendant le run (et 15 s après sa fin)       |

Corps JSON : `title`, `message`, `tags` (liste), `priority` (1-5), `file` (chemin d'un fichier à joindre, lu par le
serveur, 15 Mo max), `click` (URL). Tout est facultatif sauf `message`.

```bash
curl -s -X POST "$SN_NOTIFY_URL" -H "Authorization: Bearer $SN_RUN_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Sauvegarde","message":"42 fichiers copiés","tags":["floppy_disk"],"priority":3}'
```

```python
import json, os, urllib.request
req = urllib.request.Request(os.environ["SN_NOTIFY_URL"], method="POST",
    data=json.dumps({"title": "Photo traitée", "message": "IMG_0001.jpg", "file": "/tmp/vignette.jpg"}).encode(),
    headers={"Authorization": f"Bearer {os.environ['SN_RUN_TOKEN']}", "Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=30)
```

Les notifications envoyées ainsi apparaissent dans le journal des notifications (Réglages) comme les autres.

## Politique de concurrence

| Valeur     | Si une instance tourne encore…                                  |
| ---------- | --------------------------------------------------------------- |
| `skip`     | la nouvelle demande est ignorée (run `skipped` tracé, événement `already_running`) |
| `queue`    | elle attend en file persistante et démarre à la fin de l'instance |
| `kill`     | l'instance en cours est arrêtée (SIGTERM puis SIGKILL) puis la nouvelle démarre |
| `parallel` | elle démarre immédiatement                                      |

## Retry

Un essai supplémentaire est programmé quand le run échoue (`failed`, `timeout`, `lost`), jamais après un arrêt manuel
(`killed`). Le délai suit `delay_seconds × factor^(n-2)` plafonné par `max_delay_seconds`. Les essais sont liés au run
d'origine (`parent_run_id`) et visibles dans l'historique avec le déclencheur « Nouvel essai ».

## Statuts d'un run

`running`, `success`, `failed`, `timeout` (délai maximum dépassé), `killed` (arrêt demandé), `lost` (processus disparu
pendant un arrêt du service), `skipped` (ignoré par la politique de concurrence).

## Validation

Le YAML est validé strictement : une clé inconnue, un type incorrect ou une expression cron invalide mettent le script
en état « déclaration invalide » (visible sur la carte, lancement refusé) sans toucher aux autres scripts.
