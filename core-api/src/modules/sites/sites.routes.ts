import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/transact';
import { recordAudit } from '../../db/audit';
import { getActorId } from '../../middleware/actor';

const bodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1 },
    address: { type: 'string' },
    timezone: { type: 'string' },
  },
  additionalProperties: false,
} as const;

const sitesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    const { rows } = await pool.query('SELECT * FROM sites ORDER BY id');
    return rows;
  });

  fastify.get('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const { rows } = await pool.query('SELECT * FROM sites WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Site not found' });
    return rows[0];
  });

  fastify.post('/', { schema: { body: bodySchema } }, async (request, reply) => {
    const body = request.body as { name: string; address?: string; timezone?: string };
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO sites (name, address, timezone) VALUES ($1,$2,$3) RETURNING *`,
        [body.name, body.address ?? null, body.timezone ?? null]
      );
      await recordAudit(client, {
        siteId: rows[0].id,
        entityType: 'site',
        entityId: rows[0].id,
        action: 'create',
        newValues: rows[0],
        actorId,
      });
      return rows[0];
    });
    return reply.code(201).send(row);
  });

  fastify.put('/:id', { schema: { body: bodySchema } }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as { name: string; address?: string; timezone?: string };
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM sites WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      const { rows } = await client.query(
        `UPDATE sites SET name=$1, address=$2, timezone=$3, updated_at=now() WHERE id=$4 RETURNING *`,
        [body.name, body.address ?? null, body.timezone ?? null, id]
      );
      await recordAudit(client, {
        siteId: id,
        entityType: 'site',
        entityId: id,
        action: 'update',
        oldValues: existing[0],
        newValues: rows[0],
        actorId,
      });
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: 'Site not found' });
    return row;
  });

  fastify.delete('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const actorId = getActorId(request);
    const deleted = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM sites WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      // Audit row must be written before the DELETE: it references this same site_id,
      // and the FK would fail if the row it's citing no longer exists (even mid-transaction).
      // audit_logs.site_id is ON DELETE SET NULL, so it (and any older rows for this site)
      // correctly end up with a null site_id once the DELETE below commits.
      await recordAudit(client, {
        siteId: id,
        entityType: 'site',
        entityId: id,
        action: 'delete',
        oldValues: existing[0],
        actorId,
      });
      await client.query('DELETE FROM sites WHERE id = $1', [id]);
      return existing[0];
    });
    if (!deleted) return reply.code(404).send({ error: 'Site not found' });
    return reply.code(204).send();
  });
};

export default sitesRoutes;
