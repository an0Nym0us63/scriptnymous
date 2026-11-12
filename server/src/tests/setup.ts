// Isole chaque exécution de tests dans un dossier temporaire (scripts + data) avant tout import de config.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptnymous-test-'));
process.env.SN_SCRIPTS_DIR = path.join(root, 'scripts');
process.env.SN_DATA_DIR = path.join(root, 'data');
process.env.SN_KILL_GRACE_SECONDS = '1';
process.env.TZ = 'Europe/Paris';
fs.mkdirSync(process.env.SN_SCRIPTS_DIR, { recursive: true });
fs.mkdirSync(process.env.SN_DATA_DIR, { recursive: true });
