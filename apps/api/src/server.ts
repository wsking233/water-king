import Fastify from 'fastify';
const app = Fastify({ logger: true });
app.get('/health', async () => ({ status: 'ok', service: 'water-king-api' }));
// Business endpoints intentionally remain unavailable until authentication is implemented.
for (const path of ['/v1/activities', '/v1/me/summary', '/v1/leaderboard']) {
  app.get(path, async (_request, reply) => reply.code(501).send({ code: 'NOT_IMPLEMENTED' }));
}
const shutdown = async () => { await app.close(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
try { await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' }); }
catch (error) { app.log.error(error); process.exit(1); }
