import { describe, expect, it } from 'vitest';
import { suggestFromCode, suggestFromLog } from '../core/deps-suggest.js';

describe('suggestions de dépendances', () => {
  it('déduit les paquets pip des imports Python, sans la bibliothèque standard', () => {
    const code = `import os, sys\nimport requests\nfrom PIL import Image\nfrom datetime import datetime\nimport yaml\nfrom bs4 import BeautifulSoup\n`;
    const s = suggestFromCode('python3', code);
    expect(s.map((x) => x.package).sort()).toEqual(['beautifulsoup4', 'pillow', 'pyyaml', 'requests']);
    expect(s.every((x) => x.kind === 'pip')).toBe(true);
  });

  it('déduit les paquets npm des imports Node, sans les modules intégrés', () => {
    const code = `import fs from 'node:fs';\nconst axios = require('axios');\nimport { x } from '@scope/pkg/sub';\nimport './local.js';\nconst p = require('path');\n`;
    expect(suggestFromCode('node', code).map((x) => x.package).sort()).toEqual(['@scope/pkg', 'axios']);
  });

  it('déduit les paquets apt des commandes bash, sans le socle de l’image', () => {
    const code = `#!/usr/bin/env bash\nset -e\nFOO=1 ffmpeg -i a.mp4 b.mkv | tee log\ncurl -s x | jq .\nsudo exiftool -all= *.jpg && convert a.png b.jpg\n`;
    expect(suggestFromCode('bash', code).map((x) => x.package).sort()).toEqual(['ffmpeg', 'imagemagick', 'libimage-exiftool-perl']);
  });

  it('lit les erreurs d’un journal', () => {
    const log = `Traceback...\nModuleNotFoundError: No module named 'PIL'\nbash: ligne 3: ffmpeg: command not found\nError: Cannot find module 'dayjs'\n`;
    const s = suggestFromLog(log);
    expect(s.map((x) => `${x.kind}:${x.package}`).sort()).toEqual(['apt:ffmpeg', 'npm:dayjs', 'pip:pillow']);
    expect(s.every((x) => x.fromError)).toBe(true);
  });
});
