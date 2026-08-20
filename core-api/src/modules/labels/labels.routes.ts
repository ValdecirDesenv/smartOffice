import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/transact';
import { recordAudit } from '../../db/audit';
import { getActorId } from '../../middleware/actor';

const bodySchema = {
  type: 'object',
  required: ['floor_id', 'text'],
  properties: {
    floor_id: { type: 'integer' },
    text: { type: 'string', minLength: 1 },
    pos_x: { type: 'number' },
    pos_y: { type: 'number' },
  },
  additionalProperties: false,
} as const;

interface LabelBody {
  floor_id: number;
  text: string;
  pos_x?: number;
  pos_y?: number;
}

async function siteIdForFloor(client: { query: typeof pool.query }, floorId: number): Promise<number | null> {
  const { rows } = await client.query('SELECT site_id FROM floors WHERE id = $1', [floorId]);
  return rows[0]?.site_id ?? null;
}

const labelsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request) => {
    const { floor_id } = request.query as { floor_id?: string };
    if (floor_id) {
      const { rows } = await pool.query('SELECT * FROM labels WHERE floor_id = $1 ORDER BY id', [Number(floor_id)]);
      return rows;
    }
    const { rows } = await pool.query('SELECT * FROM labels ORDER BY id');
    return rows;
  });

  fastify.get('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const { rows } = await pool.query('SELECT * FROM labels WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Label not found' });
    return rows[0];
  });

  fastify.post('/', { schema: { body: bodySchema } }, async (request, reply) => {
    const body = request.body as LabelBody;
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO labels (floor_id, text, pos_x, pos_y) VALUES ($1,$2,$3,$4) RETURNING *`,
        [body.floor_id, body.text, body.pos_x ?? null, body.pos_y ?? null]
      );
      await recordAudit(client, {
        siteId: await siteIdForFloor(client, body.floor_id),
        entityType: 'label',
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
    const body = request.body as LabelBody;
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM labels WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      const { rows } = await client.query(
        `UPDATE labels SET floor_id=$1, text=$2, pos_x=$3, pos_y=$4, updated_at=now() WHERE id=$5 RETURNING *`,
        [body.floor_id, body.text, body.pos_x ?? null, body.pos_y ?? null, id]
      );
      await recordAudit(client, {
        siteId: await siteIdForFloor(client, body.floor_id),
        entityType: 'label',
        entityId: id,
        action: 'update',
        oldValues: existing[0],
        newValues: rows[0],
        actorId,
      });
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: 'Label not found' });
    return row;
  });

  fastify.delete('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const actorId = getActorId(request);
    const deleted = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM labels WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      await client.query('DELETE FROM labels WHERE id = $1', [id]);
      await recordAudit(client, {
        siteId: await siteIdForFloor(client, existing[0].floor_id),
        entityType: 'label',
        entityId: id,
        action: 'delete',
        oldValues: existing[0],
        actorId,
      });
      return existing[0];
    });
    if (!deleted) return reply.code(404).send({ error: 'Label not found' });
    return reply.code(204).send();
  });
};

export default labelsRoutes;
