// Routes d'authentification : connexion, déconnexion, état, changement de mot de passe, jeton d'API.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE } from '../app.js';
import { config } from '../config.js';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { auth } = app.services;

  app.get('/api/auth/status', async (req) => {
    const raw = req.cookies[SESSION_COOKIE];
    let authenticated = false;
    if (raw) {
      const u = req.unsignCookie(raw);
      authenticated = !!(u.valid && u.value && auth.validSession(u.value));
    }
    return { authenticated, passwordConfigured: auth.hasPassword() };
  });

  app.post('/api/auth/login', { config: { rateLimit: true } }, async (req, reply) => {
    const body = z.object({ password: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Mot de passe requis' });
    // Petit délai constant : freine la force brute sans dépendance supplémentaire.
    await new Promise((r) => setTimeout(r, 300));
    const sid = auth.login(body.data.password, req.headers['user-agent'] ?? null);
    if (!sid) return reply.code(401).send({ error: 'Mot de passe incorrect' });
    reply.setCookie(SESSION_COOKIE, sid, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: !config.isDev && (req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https'),
      signed: true,
      maxAge: 30 * 86400,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionId) auth.logout(req.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/password', async (req, reply) => {
    const body = z.object({ current: z.string(), next: z.string().min(8) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères' });
    if (!auth.changePassword(body.data.current, body.data.next)) return reply.code(403).send({ error: 'Mot de passe actuel incorrect' });
    return { ok: true };
  });

  app.get('/api/auth/token', async () => auth.apiTokenInfo());
  app.post('/api/auth/token', async (req, reply) => {
    if (req.authKind !== 'session') return reply.code(403).send({ error: 'Réservé à la session navigateur' });
    return { token: auth.rotateApiToken() };
  });
  app.delete('/api/auth/token', async (req, reply) => {
    if (req.authKind !== 'session') return reply.code(403).send({ error: 'Réservé à la session navigateur' });
    auth.revokeApiToken();
    return { ok: true };
  });
}
