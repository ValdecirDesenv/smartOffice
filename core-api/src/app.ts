import path from 'path';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { pool } from './db/pool';
import { env } from './config/env';
import { errorHandler } from './middleware/error-handler';

import sitesRoutes from './modules/sites/sites.routes';
import floorsRoutes from './modules/floors/floors.routes';
import workspaceTypesRoutes from './modules/workspace-types/workspace-types.routes';
import workspacesRoutes from './modules/workspaces/workspaces.routes';
import labelsRoutes from './modules/labels/labels.routes';
import employeesRoutes from './modules/employees/employees.routes';
import teamsRoutes from './modules/teams/teams.routes';
import deviceTypesRoutes from './modules/device-types/device-types.routes';
import devicesRoutes from './modules/devices/devices.routes';
import assignmentsRoutes from './modules/assignments/assignments.routes';

export function buildApp(): FastifyInstance {
  const fastify = Fastify({ logger: true });

  fastify.setErrorHandler(errorHandler);
  fastify.register(fastifyMultipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  fastify.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  });

  fastify.register(sitesRoutes, { prefix: '/api/sites' });
  fastify.register(floorsRoutes, { prefix: '/api/floors' });
  fastify.register(workspaceTypesRoutes, { prefix: '/api/workspace-types' });
  fastify.register(workspacesRoutes, { prefix: '/api/workspaces' });
  fastify.register(labelsRoutes, { prefix: '/api/labels' });
  fastify.register(employeesRoutes, { prefix: '/api/employees' });
  fastify.register(teamsRoutes, { prefix: '/api/teams' });
  fastify.register(deviceTypesRoutes, { prefix: '/api/device-types' });
  fastify.register(devicesRoutes, { prefix: '/api/devices' });
  fastify.register(assignmentsRoutes, { prefix: '/api/assignments' });

  // Uploaded files (floor backgrounds, later employee/workspace photos), served read-only.
  fastify.register(fastifyStatic, {
    root: env.uploadsDir,
    prefix: '/uploads/',
    decorateReply: false,
  });

  // Serves the frontend's static build. Falls back to index.html for client-side routing,
  // except for unmatched /api/* requests, which should 404 rather than receive HTML.
  fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'static'),
    wildcard: false,
  });
  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    reply.sendFile('index.html');
  });

  return fastify;
}
