import { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../db/pool';
import { hashToken } from '../lib/tokens';

export interface AuthedUser {
  id: string;
  username: string;
  email: string;
  employee_id: string | null;
  is_admin: boolean;
  can_edit: boolean;
  can_sync_hubspot: boolean;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

export const SESSION_COOKIE_NAME = 'sid';

// Shared by requireAuth below and GET /api/auth/me (which must stay reachable while logged out,
// so it can't rely on the requireAuth hook - it does its own lookup and just returns null).
export async function getSessionUser(request: FastifyRequest): Promise<AuthedUser | null> {
  const token = request.cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.email, u.employee_id, u.is_admin, u.can_edit, u.can_sync_hubspot
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)]
  );
  return rows[0] ?? null;
}

// Attached as a global onRequest hook in app.ts. Registered at the root of the Fastify instance,
// which (unlike a route-level hook) runs for every incoming request regardless of whether a
// route ends up matching - including ones that 404, like a direct browser hit on a client-side
// route (/login, /reset-password?token=...). Those must reach the SPA shell + notFoundHandler
// unauthenticated, so this checks the URL itself rather than relying on registration order to
// exclude them: only /api/* requests are gated, and /api/auth/* (+ the health check) stay public.
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.url.startsWith('/api/') || request.url.startsWith('/api/auth/') || request.url === '/api/health') {
    return;
  }

  const user = await getSessionUser(request);
  if (!user) {
    const hadCookie = Boolean(request.cookies[SESSION_COOKIE_NAME]);
    if (hadCookie) reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    reply.code(401).send({ error: hadCookie ? 'Session expired' : 'Not logged in' });
    return;
  }
  request.user = user;

  // Guests (can_edit: false) can view everything but not mutate it. Admins always bypass this -
  // is_admin implies edit rights regardless of the can_edit flag.
  //
  // One deliberate exception: submitting a desk-assignment ticket is the one write any logged-in
  // user (including a guest) is allowed to make - it doesn't touch the real directory/assignment
  // data, only a pending request an admin/member later reviews. Every other verb on
  // /api/desk-requests (list, approve, reject) stays behind its own is_admin/can_edit check
  // inside the route itself, same as every other admin-gated module.
  const isGuestTicketSubmission = request.method === 'POST' && request.url === '/api/desk-requests';
  if (!user.is_admin && !user.can_edit && MUTATING_METHODS.has(request.method) && !isGuestTicketSubmission) {
    reply.code(403).send({ error: 'Read-only access' });
  }
}
