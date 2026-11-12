-- Schéma initial de ScriptNymous.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Scripts connus (miroir de /scripts/<slug>/script.yaml, enrichi d'un état).
CREATE TABLE scripts (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  "group" TEXT,
  spec_json TEXT NOT NULL,          -- déclaration validée (JSON)
  spec_error TEXT,                  -- message si le YAML est invalide
  status TEXT NOT NULL DEFAULT 'ok',-- ok | invalid | missing
  env_status TEXT NOT NULL DEFAULT 'none', -- none | pending | installing | ready | error
  env_fingerprint TEXT,
  env_log TEXT,
  env_updated_at TEXT,
  yaml_mtime INTEGER,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  missing_since TEXT
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  script_slug TEXT NOT NULL,
  script_name TEXT NOT NULL,
  trigger TEXT NOT NULL,            -- manual | schedule | api | retry | queue
  schedule_id TEXT,
  params_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,             -- queued | running | success | failed | killed | timeout | lost | skipped
  exit_code INTEGER,
  signal TEXT,
  pid INTEGER,
  pgid INTEGER,
  proc_start_ticks TEXT,            -- champ starttime de /proc/<pid>/stat (détection de réutilisation du pid)
  attempt INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  parent_run_id TEXT,               -- run d'origine pour un retry
  queued_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  heartbeat_at TEXT,
  log_path TEXT,
  log_bytes INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX runs_script_idx ON runs (script_slug, created_at DESC);
CREATE INDEX runs_status_idx ON runs (status);
CREATE INDEX runs_created_idx ON runs (created_at DESC);

-- File d'attente persistante (politique `queue`) et retries différés.
CREATE TABLE queue (
  id TEXT PRIMARY KEY,
  script_slug TEXT NOT NULL,
  trigger TEXT NOT NULL,
  schedule_id TEXT,
  params_json TEXT NOT NULL DEFAULT '{}',
  attempt INTEGER NOT NULL DEFAULT 1,
  parent_run_id TEXT,
  not_before TEXT,                  -- ne pas lancer avant cette date (retry différé)
  created_at TEXT NOT NULL
);
CREATE INDEX queue_slug_idx ON queue (script_slug, created_at);

-- État des planifications : dernière occurrence traitée (pour le rattrapage).
CREATE TABLE schedule_state (
  script_slug TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  last_fired_at TEXT,
  next_at TEXT,
  PRIMARY KEY (script_slug, schedule_id)
);

-- Sessions de l'unique utilisateur.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

-- Journal des notifications envoyées (diagnostic).
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_slug TEXT,
  run_id TEXT,
  event TEXT NOT NULL,
  topic TEXT,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
