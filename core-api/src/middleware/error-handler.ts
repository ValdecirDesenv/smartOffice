import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';

interface PgError extends Error {
  code?: string;
  detail?: string;
}

export function errorHandler(error: FastifyError | PgError, request: FastifyRequest, reply: FastifyReply): void {
  const validation = (error as FastifyError).validation;
  if (validation) {
    reply.code(400).send({ error: 'Validation failed', details: validation });
    return;
  }

  const pgCode = (error as PgError).code;
  if (pgCode === PG_UNIQUE_VIOLATION) {
    reply.code(409).send({ error: 'Conflicts with an existing record', detail: (error as PgError).detail });
    return;
  }
  if (pgCode === PG_FOREIGN_KEY_VIOLATION) {
    reply.code(409).send({ error: 'References a record that does not exist', detail: (error as PgError).detail });
    return;
  }
  if (pgCode === PG_CHECK_VIOLATION) {
    reply.code(400).send({ error: 'Invalid value', detail: (error as PgError).detail });
    return;
  }

  request.log.error(error);
  reply.code(500).send({ error: 'Internal server error' });
}
