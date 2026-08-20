import { buildApp } from './app';
import { env } from './config/env';

const fastify = buildApp();

fastify
  .listen({ port: env.port, host: '0.0.0.0' })
  .catch((err) => {
    fastify.log.error(err);
    process.exit(1);
  });
