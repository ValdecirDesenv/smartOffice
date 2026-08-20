import { FastifyRequest } from 'fastify';

/**
 * Stage 9 (auth) doesn't exist yet, so there's no logged-in user to attribute writes to.
 * Until then, callers may optionally pass the acting employee's id via this header;
 * audit_logs.actor_id stays null otherwise rather than guessing.
 */
export function getActorId(request: FastifyRequest): number | null {
  const header = request.headers['x-actor-id'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}
