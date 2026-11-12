// Point d'entrée MCP : /api/mcp en Streamable HTTP, mode sans session (une instance par requête).
// L'authentification est celle de /api (jeton Bearer recommandé pour les clients MCP).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from '../mcp/server.js';

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  const handle = async (req: FastifyRequest, reply: FastifyReply) => {
    const server = buildMcpServer(app.services);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (e) {
      app.log.error({ err: e }, 'Erreur MCP');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
        reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Erreur interne' }, id: null }));
      }
    }
  };
  app.post('/api/mcp', handle);
  // Sans session, GET (flux SSE) et DELETE n'ont pas d'objet : 405 explicite.
  app.get('/api/mcp', async (_req, reply) => reply.code(405).send({ error: 'Méthode non autorisée : le serveur MCP fonctionne sans session (POST uniquement)' }));
  app.delete('/api/mcp', async (_req, reply) => reply.code(405).send({ error: 'Méthode non autorisée' }));
}
