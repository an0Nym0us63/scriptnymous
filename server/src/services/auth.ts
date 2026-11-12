// Authentification : un seul utilisateur. Mot de passe haché (scrypt) au premier démarrage depuis SN_PASSWORD,
// sessions par cookie signé, jeton d'API (haché en base, montré une seule fois).
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import type { Repo } from '../db/repo.js';

const SESSION_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export class AuthService {
  constructor(
    private readonly repo: Repo,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Initialise le mot de passe et le secret de session si besoin. */
  bootstrap(): void {
    const existing = this.repo.getSetting('password_hash');
    if (!existing || config.resetPassword) {
      if (!config.password) {
        if (!existing) this.log.error('SN_PASSWORD absent : aucun mot de passe défini, la connexion sera impossible');
      } else {
        this.repo.setSetting('password_hash', hashPassword(config.password));
        this.log.info(existing ? 'Mot de passe réinitialisé depuis SN_PASSWORD' : 'Mot de passe initialisé depuis SN_PASSWORD');
      }
    }
    if (!this.repo.getSetting('session_secret')) {
      this.repo.setSetting('session_secret', config.sessionSecret || randomBytes(32).toString('hex'));
    }
    this.repo.purgeSessions();
  }

  sessionSecret(): string {
    return this.repo.getSetting('session_secret')!;
  }

  hasPassword(): boolean {
    return !!this.repo.getSetting('password_hash');
  }

  login(password: string, userAgent: string | null): string | null {
    const stored = this.repo.getSetting('password_hash');
    if (!stored || !verifyPassword(password, stored)) return null;
    const id = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
    this.repo.createSession(id, expires, userAgent);
    return id;
  }

  logout(sessionId: string): void {
    this.repo.deleteSession(sessionId);
  }

  validSession(sessionId: string): boolean {
    return !!this.repo.getSession(sessionId);
  }

  changePassword(current: string, next: string): boolean {
    const stored = this.repo.getSetting('password_hash');
    if (!stored || !verifyPassword(current, stored)) return false;
    this.repo.setSetting('password_hash', hashPassword(next));
    return true;
  }

  /** Génère un nouveau jeton d'API (remplace l'ancien) et le renvoie en clair une seule fois. */
  rotateApiToken(): string {
    const token = `sn_${randomBytes(24).toString('base64url')}`;
    this.repo.setSetting('api_token_hash', sha256(token));
    this.repo.setSetting('api_token_prefix', token.slice(0, 8));
    return token;
  }

  revokeApiToken(): void {
    this.repo.deleteSetting('api_token_hash');
    this.repo.deleteSetting('api_token_prefix');
  }

  apiTokenInfo(): { set: boolean; prefix: string | null } {
    return { set: !!this.repo.getSetting('api_token_hash'), prefix: this.repo.getSetting('api_token_prefix') };
  }

  validApiToken(token: string): boolean {
    const stored = this.repo.getSetting('api_token_hash');
    if (!stored) return false;
    const a = Buffer.from(sha256(token));
    const b = Buffer.from(stored);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
