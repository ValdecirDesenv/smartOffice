import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/transact';
import { recordAudit } from '../../db/audit';
import { getActorId } from '../../middleware/actor';

const STATUSES = ['available', 'occupied', 'reserved', 'assigned', 'inactive'];

const bodySchema = {
  type: 'object',
  required: ['site_id', 'floor_id', 'workspace_type_id', 'code'],
  properties: {
    site_id: { type: 'integer' },
    floor_id: { type: 'integer' },
    workspace_type_id: { type: 'integer' },
    code: { type: 'string', minLength: 1 },
    pos_x: { type: 'number' },
    pos_y: { type: 'number' },
    status: { type: 'string', enum: STATUSES },
  },
  additionalProperties: false,
} as const;

interface WorkspaceBody {
  site_id: number;
  floor_id: number;
  workspace_type_id: number;
  code: string;
  pos_x?: number;
  pos_y?: number;
  status?: string;
}

const workspacesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request) => {
    const { site_id, floor_id } = request.query as { site_id?: string; floor_id?: string };
    const conditions: string[] = [];
    const values: number[] = [];
    if (site_id) {
      values.push(Number(site_id));
      conditions.push(`site_id = $${values.length}`);
    }
    if (floor_id) {
      values.push(Number(floor_id));
      conditions.push(`floor_id = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(`SELECT * FROM workspaces ${where} ORDER BY id`, values);
    return rows;
  });

  fastify.get('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const { rows } = await pool.query('SELECT * FROM workspaces WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Workspace not found' });
    return rows[0];
  });

  fastify.post('/', { schema: { body: bodySchema } }, async (request, reply) => {
    const body = request.body as WorkspaceBody;
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO workspaces (site_id, floor_id, workspace_type_id, code, pos_x, pos_y, status)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'available')) RETURNING *`,
        [body.site_id, body.floor_id, body.workspace_type_id, body.code, body.pos_x ?? null, body.pos_y ?? null, body.status ?? null]
      );
      await recordAudit(client, {
        siteId: body.site_id,
        entityType: 'workspace',
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
    const body = request.body as WorkspaceBody;
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM workspaces WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      const { rows } = await client.query(
        `UPDATE workspaces SET site_id=$1, floor_id=$2, workspace_type_id=$3, code=$4,
           pos_x=$5, pos_y=$6, status=COALESCE($7, status), updated_at=now() WHERE id=$8 RETURNING *`,
        [body.site_id, body.floor_id, body.workspace_type_id, body.code, body.pos_x ?? null, body.pos_y ?? null, body.status ?? null, id]
      );
      await recordAudit(client, {
        siteId: body.site_id,
        entityType: 'workspace',
        entityId: id,
        action: 'update',
        oldValues: existing[0],
        newValues: rows[0],
        actorId,
      });
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: 'Workspace not found' });
    return row;
  });

  fastify.delete('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const actorId = getActorId(request);
    const deleted = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM workspaces WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      await client.query('DELETE FROM workspaces WHERE id = $1', [id]);
      await recordAudit(client, {
        siteId: existing[0].site_id,
        entityType: 'workspace',
        entityId: id,
        action: 'delete',
        oldValues: existing[0],
        actorId,
      });
      return existing[0];
    });
    if (!deleted) return reply.code(404).send({ error: 'Workspace not found' });
    return reply.code(204).send();
  });
};

export default workspacesRoutes;
