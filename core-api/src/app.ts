import path from 'path';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
import { pool } from './db/pool';
import { env } from './config/env';
import { errorHandler } from './middleware/error-handler';
import { requireAuth } from './middleware/require-auth';

import authRoutes from './modules/auth/auth.routes';
import usersRoutes from './modules/users/users.routes';
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
import hubspotRoutes from './modules/hubspot/hubspot.routes';
import configSnapshotsRoutes from './modules/config-snapshots/config-snapshots.routes';

export function buildApp(): FastifyInstance {
  const fastify = Fastify({ logger: true });

  fastify.setErrorHandler(errorHandler);
  fastify.register(fastifyMultipart, { limits: { fileSize: 20 * 1024 * 1024 } });
  fastify.register(fastifyCookie, { secret: env.sessionCookieSecret });

  fastify.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  });

  // Public: must stay reachable while logged out (login itself, forgot/reset-password, invites).
  fastify.register(authRoutes, { prefix: '/api/auth' });

  // Public: the frontend's own static build. Anonymous visitors need this to receive the React
  // app shell at all, so it can render the login page - it must be registered before the auth
  // hook below. The SPA fallback (for client-side routes like /login, /reset-password) and the
  // /api/* 404 distinction are handled by setNotFoundHandler further down.
  fastify.register(fastifyStatic, {
    root: path.join(__dirname, 'static'),
    wildcard: false,
  });

  // Runs for every request (this is a root-level hook, so it applies even to ones that 404);
  // require-auth.ts itself only enforces on /api/* routes other than /api/auth/* and the health
  // check, so this placement is about readability (grouping public routes above it), not
  // correctness - see the comment in require-auth.ts for why it can't just rely on order.
  fastify.addHook('onRequest', requireAuth);

  fastify.register(usersRoutes, { prefix: '/api/users' });
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
  fastify.register(hubspotRoutes, { prefix: '/api/hubspot' });
  fastify.register(configSnapshotsRoutes, { prefix: '/api/config-snapshots' });

  // Uploaded files (floor backgrounds, employee/workspace photos), served read-only. Behind the
  // auth hook too - fine, the app only ever loads these while logged in anyway.
  fastify.register(fastifyStatic, {
    root: env.uploadsDir,
    prefix: '/uploads/',
    decorateReply: false,
  });

  // Falls back to index.html for client-side routing, except for unmatched /api/* requests,
  // which should 404 rather than receive HTML.
  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    reply.sendFile('index.html');
  });

  return fastify;
}
