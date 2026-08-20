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
    team_id: { type: ['integer', 'null'] },
    name: { type: 'string', minLength: 1 },
    email: { type: 'string' },
    job_title: { type: 'string' },
    status: { type: 'string', enum: ['active', 'inactive'] },
  },
  additionalProperties: false,
} as const;

interface EmployeeBody {
  site_id: number;
  team_id?: number;
  name: string;
  email?: string;
  job_title?: string;
  status?: 'active' | 'inactive';
}

const employeesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request) => {
    const { site_id, team_id } = request.query as { site_id?: string; team_id?: string };
    const conditions: string[] = [];
    const values: number[] = [];
    if (site_id) {
      values.push(Number(site_id));
      conditions.push(`site_id = $${values.length}`);
    }
    if (team_id) {
      values.push(Number(team_id));
      conditions.push(`team_id = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(`SELECT * FROM employees ${where} ORDER BY id`, values);
    return rows;
  });

  fastify.get('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const { rows } = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Employee not found' });
    return rows[0];
  });

  fastify.post('/', { schema: { body: bodySchema } }, async (request, reply) => {
    const body = request.body as EmployeeBody;
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO employees (site_id, team_id, name, email, job_title, status)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,'active')) RETURNING *`,
        [body.site_id, body.team_id ?? null, body.name, body.email ?? null, body.job_title ?? null, body.status ?? null]
      );
      await recordAudit(client, {
        siteId: body.site_id,
        entityType: 'employee',
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
    const body = request.body as EmployeeBody;
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      const { rows } = await client.query(
        `UPDATE employees SET site_id=$1, team_id=$2, name=$3, email=$4, job_title=$5,
           status=COALESCE($6, status), updated_at=now() WHERE id=$7 RETURNING *`,
        [body.site_id, body.team_id ?? null, body.name, body.email ?? null, body.job_title ?? null, body.status ?? null, id]
      );
      await recordAudit(client, {
        siteId: body.site_id,
        entityType: 'employee',
        entityId: id,
        action: 'update',
        oldValues: existing[0],
        newValues: rows[0],
        actorId,
      });
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: 'Employee not found' });
    return row;
  });

  fastify.delete('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const actorId = getActorId(request);
    const deleted = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      await client.query('DELETE FROM employees WHERE id = $1', [id]);
      await recordAudit(client, {
        siteId: existing[0].site_id,
        entityType: 'employee',
        entityId: id,
        action: 'delete',
        oldValues: existing[0],
        actorId,
      });
      return existing[0];
    });
    if (!deleted) return reply.code(404).send({ error: 'Employee not found' });
    return reply.code(204).send();
  });
};

export default employeesRoutes;
