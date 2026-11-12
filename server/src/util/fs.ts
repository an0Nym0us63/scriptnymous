import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += (await fsp.stat(p)).size;
        } catch {
          /* fichier disparu entre-temps */
        }
      }
    }
  }
  return total;
}

export function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}
