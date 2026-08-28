import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/transact';
import { recordAudit } from '../../db/audit';
import { getActorId } from '../../middleware/actor';

const bodySchema = {
  type: 'object',
  required: ['workspace_id', 'employee_id'],
  properties: {
    workspace_id: { type: 'integer' },
    employee_id: { type: 'integer' },
  },
  additionalProperties: false,
} as const;

interface AssignmentBody {
  workspace_id: number;
  employee_id: number;
}

async function siteIdForWorkspace(client: { query: typeof pool.query }, workspaceId: number): Promise<number | null> {
  const { rows } = await client.query('SELECT site_id FROM workspaces WHERE id = $1', [workspaceId]);
  return rows[0]?.site_id ?? null;
}

const assignmentsRoutes: FastifyPluginAsync = async (fastify) => {
  // Active assignments by default; ?all=true includes history (past unassignments too).
  fastify.get('/', async (request) => {
    const { workspace_id, employee_id, all } = request.query as { workspace_id?: string; employee_id?: string; all?: string };
    const conditions: string[] = [];
    const values: number[] = [];
    if (all !== 'true') {
      conditions.push('unassigned_at IS NULL');
    }
    if (workspace_id) {
      values.push(Number(workspace_id));
      conditions.push(`workspace_id = $${values.length}`);
    }
    if (employee_id) {
      values.push(Number(employee_id));
      conditions.push(`employee_id = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(`SELECT * FROM workspace_assignments ${where} ORDER BY id`, values);
    return rows;
  });

  // Assign an employee to a workspace. Fails with 409 if either already has an active assignment
  // (one active desk per employee, one active employee per desk) - unassign first to reassign.
  // The employee picker in the UI now offers everyone app-wide, not just people already in this
  // site, so assigning someone from a different office (or someone HubSpot synced with no office
  // at all - site_id NULL) sets/moves their employee record's site to this desk's office too -
  // "seated here" and "belongs to this office" have to agree. Their old team doesn't carry over
  // (teams are per-site), so it's cleared rather than left pointing at a team from elsewhere.
  fastify.post('/', { schema: { body: bodySchema } }, async (request, reply) => {
    const body = request.body as AssignmentBody;
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const workspaceSiteId = await siteIdForWorkspace(client, body.workspace_id);

      const { rows: employeeRows } = await client.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [
        body.employee_id,
      ]);
      const employee = employeeRows[0];
      if (employee && workspaceSiteId != null && employee.site_id !== workspaceSiteId) {
        const { rows: movedRows } = await client.query(
          `UPDATE employees SET site_id=$1, team_id=NULL, updated_at=now() WHERE id=$2 RETURNING *`,
          [workspaceSiteId, body.employee_id]
        );
        await recordAudit(client, {
          siteId: workspaceSiteId,
          entityType: 'employee',
          entityId: body.employee_id,
          action: 'update',
          oldValues: employee,
          newValues: movedRows[0],
          actorId,
        });
      }

      const { rows } = await client.query(
        `INSERT INTO workspace_assignments (workspace_id, employee_id) VALUES ($1,$2) RETURNING *`,
        [body.workspace_id, body.employee_id]
      );
      await client.query(`UPDATE workspaces SET status='assigned', updated_at=now() WHERE id = $1`, [body.workspace_id]);
      await recordAudit(client, {
        siteId: workspaceSiteId,
        entityType: 'workspace_assignment',
        entityId: rows[0].id,
        action: 'create',
        newValues: rows[0],
        actorId,
      });
      return rows[0];
    });
    return reply.code(201).send(row);
  });

  // Unassign: sets unassigned_at rather than deleting the row, preserving assignment history.
  fastify.delete('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const actorId = getActorId(request);
    const updated = await withTransaction(async (client) => {
      const { rows: existing } = await client.query(
        'SELECT * FROM workspace_assignments WHERE id = $1 AND unassigned_at IS NULL FOR UPDATE',
        [id]
      );
      if (!existing[0]) return null;
      const { rows } = await client.query(
        `UPDATE workspace_assignments SET unassigned_at=now(), updated_at=now() WHERE id=$1 RETURNING *`,
        [id]
      );
      await client.query(`UPDATE workspaces SET status='available', updated_at=now() WHERE id = $1`, [existing[0].workspace_id]);
      await recordAudit(client, {
        siteId: await siteIdForWorkspace(client, existing[0].workspace_id),
        entityType: 'workspace_assignment',
        entityId: id,
        action: 'update',
        oldValues: existing[0],
        newValues: rows[0],
        actorId,
      });
      return rows[0];
    });
    if (!updated) return reply.code(404).send({ error: 'Active assignment not found' });
    return updated;
  });
};

export default assignmentsRoutes;
