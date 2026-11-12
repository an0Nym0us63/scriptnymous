import { randomBytes } from 'node:crypto';

// Identifiant court, lisible, trié par le temps : <base36(ms)>-<aléa>.
export function newId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
