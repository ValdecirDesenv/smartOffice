import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/transact';
import { recordAudit } from '../../db/audit';
import { getActorId } from '../../middleware/actor';

const bodySchema = {
  type: 'object',
  required: ['site_id', 'name'],
  properties: {
    site_id: { type: 'integer' },
    name: { type: 'string', minLength: 1 },
    department: { type: 'string' },
  },
  additionalProperties: false,
} as const;

const teamsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request) => {
    const { site_id } = request.query as { site_id?: string };
    if (site_id) {
      const { rows } = await pool.query('SELECT * FROM teams WHERE site_id = $1 ORDER BY id', [Number(site_id)]);
      return rows;
    }
    const { rows } = await pool.query('SELECT * FROM teams ORDER BY id');
    return rows;
  });

  fastify.get('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const { rows } = await pool.query('SELECT * FROM teams WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Team not found' });
    return rows[0];
  });

  fastify.post('/', { schema: { body: bodySchema } }, async (request, reply) => {
    const body = request.body as { site_id: number; name: string; department?: string };
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO teams (site_id, name, department) VALUES ($1,$2,$3) RETURNING *`,
        [body.site_id, body.name, body.department ?? null]
      );
      await recordAudit(client, {
        siteId: body.site_id,
        entityType: 'team',
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
    const body = request.body as { site_id: number; name: string; department?: string };
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM teams WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      const { rows } = await client.query(
        `UPDATE teams SET site_id=$1, name=$2, department=$3, updated_at=now() WHERE id=$4 RETURNING *`,
        [body.site_id, body.name, body.department ?? null, id]
      );
      await recordAudit(client, {
        siteId: body.site_id,
        entityType: 'team',
        entityId: id,
        action: 'update',
        oldValues: existing[0],
        newValues: rows[0],
        actorId,
      });
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: 'Team not found' });
    return row;
  });

  fastify.delete('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const actorId = getActorId(request);
    const deleted = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM teams WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      await client.query('DELETE FROM teams WHERE id = $1', [id]);
      await recordAudit(client, {
        siteId: existing[0].site_id,
        entityType: 'team',
        entityId: id,
        action: 'delete',
        oldValues: existing[0],
        actorId,
      });
      return existing[0];
    });
    if (!deleted) return reply.code(404).send({ error: 'Team not found' });
    return reply.code(204).send();
  });
};

export default teamsRoutes;
