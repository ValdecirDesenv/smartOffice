import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/transact';
import { recordAudit } from '../../db/audit';
import { getActorId } from '../../middleware/actor';

const bodySchema = {
  type: 'object',
  required: ['code', 'label'],
  properties: {
    code: { type: 'string', minLength: 1 },
    label: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;

const workspaceTypesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    const { rows } = await pool.query('SELECT * FROM workspace_types ORDER BY id');
    return rows;
  });

  fastify.get('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const { rows } = await pool.query('SELECT * FROM workspace_types WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Workspace type not found' });
    return rows[0];
  });

  fastify.post('/', { schema: { body: bodySchema } }, async (request, reply) => {
    const body = request.body as { code: string; label: string };
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO workspace_types (code, label) VALUES ($1,$2) RETURNING *`,
        [body.code, body.label]
      );
      await recordAudit(client, {
        siteId: null,
        entityType: 'workspace_type',
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
    const body = request.body as { code: string; label: string };
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM workspace_types WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      const { rows } = await client.query(
        `UPDATE workspace_types SET code=$1, label=$2 WHERE id=$3 RETURNING *`,
        [body.code, body.label, id]
      );
      await recordAudit(client, {
        siteId: null,
        entityType: 'workspace_type',
        entityId: id,
        action: 'update',
        oldValues: existing[0],
        newValues: rows[0],
        actorId,
      });
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: 'Workspace type not found' });
    return row;
  });

  fastify.delete('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const actorId = getActorId(request);
    const deleted = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM workspace_types WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      await client.query('DELETE FROM workspace_types WHERE id = $1', [id]);
      await recordAudit(client, {
        siteId: null,
        entityType: 'workspace_type',
        entityId: id,
        action: 'delete',
        oldValues: existing[0],
        actorId,
      });
      return existing[0];
    });
    if (!deleted) return reply.code(404).send({ error: 'Workspace type not found' });
    return reply.code(204).send();
  });
};

export default workspaceTypesRoutes;
