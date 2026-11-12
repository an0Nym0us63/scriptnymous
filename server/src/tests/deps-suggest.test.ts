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
    const code = `#!/usr/bin/env bash\nset -e\nFOO=1 ffmpeg -i a.mp4 b.mkv | tee log\ncurl -s x | jq .\nsudo tesseract a.png out && pdftotext a.pdf -\n`;
    // ffmpeg, imagemagick, exiftool font partie du socle de l'image : jamais suggérés.
    expect(suggestFromCode('bash', code).map((x) => x.package).sort()).toEqual(['poppler-utils', 'tesseract-ocr']);
  });

  it('lit les erreurs d’un journal', () => {
    const log = `Traceback...\nModuleNotFoundError: No module named 'PIL'\nbash: ligne 3: tesseract: command not found\nError: Cannot find module 'dayjs'\n`;
    const s = suggestFromLog(log);
    expect(s.map((x) => `${x.kind}:${x.package}`).sort()).toEqual(['apt:tesseract-ocr', 'npm:dayjs', 'pip:pillow']);
    expect(s.every((x) => x.fromError)).toBe(true);
  });
});
