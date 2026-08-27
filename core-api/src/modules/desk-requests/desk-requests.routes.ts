import { FastifyPluginAsync } from 'fastify';
import { withTransaction } from '../../db/transact';
import { recordAudit } from '../../db/audit';
import { getActorId } from '../../middleware/actor';

interface CreateBody {
  workspace_id: number;
  employee_id?: number;
  requested_first_name?: string;
  requested_last_name?: string;
  requested_email?: string;
  note?: string;
}

interface ApproveBody {
  workspace_id?: number;
  employee_id?: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  job_title?: string;
  team_id?: number;
}

function canReview(user: { is_admin: boolean; can_edit: boolean }): boolean {
  return user.is_admin || user.can_edit;
}

const LIST_COLUMNS = `
  dr.id, dr.status, dr.note, dr.requested_email, dr.requested_first_name, dr.requested_last_name,
  dr.requested_by_username, dr.created_at,
  dr.reviewed_by_username, dr.reviewed_at, dr.review_note,
  dr.site_id, s.name AS site_name,
  dr.floor_id, f.name AS floor_name,
  dr.workspace_id, w.code AS workspace_code,
  dr.employee_id, e.name AS employee_name
`;

const deskRequestsRoutes: FastifyPluginAsync = async (fastify) => {
  // Open to any logged-in user, including a guest - this is the one write a guest is allowed to
  // make (see the exemption in middleware/require-auth.ts). It only ever creates a pending
  // request, never touches the real directory/assignment data.
  fastify.post('/', async (request, reply) => {
    const body = (request.body as CreateBody) ?? ({} as CreateBody);
    if (!body.workspace_id) {
      return reply.code(400).send({ error: 'workspace_id is required' });
    }
    if (!body.employee_id && !(body.requested_first_name?.trim() && body.requested_last_name?.trim())) {
      return reply
        .code(400)
        .send({ error: 'Select an existing person, or provide both a first and last name' });
    }

    const { rows: wsRows } = await withTransaction((client) =>
      client.query('SELECT site_id, floor_id FROM workspaces WHERE id = $1', [body.workspace_id])
    );
    if (!wsRows[0]) return reply.code(404).send({ error: 'Desk not found' });

    const actorId = getActorId(request);
    const userId = Number(request.user!.id);
    const username = request.user!.username;

    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO desk_requests
           (site_id, floor_id, workspace_id, employee_id, requested_first_name, requested_last_name,
            requested_email, note, requested_by, requested_by_username)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          wsRows[0].site_id,
          wsRows[0].floor_id,
          body.workspace_id,
          body.employee_id ?? null,
          body.requested_first_name?.trim() || null,
          body.requested_last_name?.trim() || null,
          body.requested_email?.trim() || null,
          body.note?.trim() || null,
          userId,
          username,
        ]
      );
      await recordAudit(client, {
        siteId: wsRows[0].site_id,
        entityType: 'desk_request',
        entityId: rows[0].id,
        action: 'create',
        newValues: rows[0],
        actorId,
        source: 'manual',
      });
      return rows[0];
    });

    return reply.code(201).send(row);
  });

  // Everything below is review/management - restricted to admins and members (can_edit), not
  // guests. GETs aren't blocked by the global requireAuth hook, so this needs its own check.
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.method === 'POST' && request.url === '/api/desk-requests') return;
    if (!canReview(request.user!)) return reply.code(403).send({ error: 'Admin or member access required' });
  });

  fastify.get('/', async (request) => {
    const { status } = (request.query as { status?: string }) ?? {};
    const { rows } = await withTransaction((client) =>
      client.query(
        `SELECT ${LIST_COLUMNS} FROM desk_requests dr
         JOIN sites s ON s.id = dr.site_id
         JOIN floors f ON f.id = dr.floor_id
         JOIN workspaces w ON w.id = dr.workspace_id
         LEFT JOIN employees e ON e.id = dr.employee_id
         WHERE dr.status = $1
         ORDER BY dr.created_at ASC`,
        [status || 'pending']
      )
    );
    return rows;
  });

  fastify.post('/:id/approve', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = (request.body as ApproveBody) ?? {};
    const actorId = getActorId(request);
    const userId = Number(request.user!.id);
    const username = request.user!.username;

    type ApproveResult = { error: number; message: string } | { ticket: Record<string, any> };

    const result = await withTransaction(async (client): Promise<ApproveResult> => {
      const { rows: ticketRows } = await client.query('SELECT * FROM desk_requests WHERE id = $1 FOR UPDATE', [id]);
      const ticket = ticketRows[0];
      if (!ticket) return { error: 404, message: 'Request not found' };
      if (ticket.status !== 'pending') return { error: 409, message: `Request is already ${ticket.status}` };

      const workspaceId = body.workspace_id ?? ticket.workspace_id;
      const { rows: occupantRows } = await client.query(
        `SELECT e.name FROM workspace_assignments wa
         JOIN employees e ON e.id = wa.employee_id
         WHERE wa.workspace_id = $1 AND wa.unassigned_at IS NULL`,
        [workspaceId]
      );
      if (occupantRows[0]) {
        return { error: 409, message: `This desk is already occupied by ${occupantRows[0].name}` };
      }

      let employeeId = body.employee_id ?? ticket.employee_id;
      if (employeeId) {
        const { rows: existing } = await client.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [
          employeeId,
        ]);
        if (!existing[0]) return { error: 404, message: 'Employee not found' };
        const { rows: updated } = await client.query(
          `UPDATE employees SET
             email=COALESCE($1, email), job_title=COALESCE($2, job_title), team_id=COALESCE($3, team_id),
             updated_at=now()
           WHERE id=$4 RETURNING *`,
          [body.email ?? null, body.job_title ?? null, body.team_id ?? null, employeeId]
        );
        await recordAudit(client, {
          siteId: existing[0].site_id,
          entityType: 'employee',
          entityId: employeeId,
          action: 'update',
          oldValues: existing[0],
          newValues: updated[0],
          actorId,
          source: 'manual',
        });
      } else {
        const firstName = body.first_name?.trim() || ticket.requested_first_name;
        const lastName = body.last_name?.trim() || ticket.requested_last_name;
        const name = [firstName, lastName].filter(Boolean).join(' ');
        const email = body.email?.trim() || ticket.requested_email;
        const { rows: created } = await client.query(
          `INSERT INTO employees (site_id, team_id, name, email, job_title, status)
           VALUES ($1,$2,$3,$4,$5,'active') RETURNING *`,
          [ticket.site_id, body.team_id ?? null, name, email || null, body.job_title ?? null]
        );
        employeeId = created[0].id;
        await recordAudit(client, {
          siteId: ticket.site_id,
          entityType: 'employee',
          entityId: employeeId,
          action: 'create',
          newValues: created[0],
          actorId,
          source: 'manual',
        });
      }

      const { rows: assignmentRows } = await client.query(
        `INSERT INTO workspace_assignments (workspace_id, employee_id) VALUES ($1,$2) RETURNING *`,
        [workspaceId, employeeId]
      );
      await client.query(`UPDATE workspaces SET status='assigned', updated_at=now() WHERE id = $1`, [workspaceId]);
      await recordAudit(client, {
        siteId: ticket.site_id,
        entityType: 'workspace_assignment',
        entityId: assignmentRows[0].id,
        action: 'create',
        newValues: assignmentRows[0],
        actorId,
        source: 'manual',
      });

      const { rows: updatedTicket } = await client.query(
        `UPDATE desk_requests SET
           status='approved', reviewed_by=$1, reviewed_by_username=$2, reviewed_at=now(),
           resulting_employee_id=$3, resulting_assignment_id=$4, updated_at=now()
         WHERE id=$5 RETURNING *`,
        [userId, username, employeeId, assignmentRows[0].id, id]
      );
      await recordAudit(client, {
        siteId: ticket.site_id,
        entityType: 'desk_request',
        entityId: id,
        action: 'update',
        oldValues: ticket,
        newValues: updatedTicket[0],
        actorId,
        source: 'manual',
      });

      return { ticket: updatedTicket[0] };
    });

    if ('error' in result) return reply.code(result.error).send({ error: result.message });
    return result.ticket;
  });

  fastify.post('/:id/reject', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const { review_note } = (request.body as { review_note?: string }) ?? {};
    const actorId = getActorId(request);
    const userId = Number(request.user!.id);
    const username = request.user!.username;

    const result = await withTransaction(async (client) => {
      const { rows: ticketRows } = await client.query('SELECT * FROM desk_requests WHERE id = $1 FOR UPDATE', [id]);
      const ticket = ticketRows[0];
      if (!ticket) return null;
      if (ticket.status !== 'pending') return { error: true, ticket };

      const { rows: updated } = await client.query(
        `UPDATE desk_requests SET
           status='rejected', reviewed_by=$1, reviewed_by_username=$2, reviewed_at=now(), review_note=$3, updated_at=now()
         WHERE id=$4 RETURNING *`,
        [userId, username, review_note?.trim() || null, id]
      );
      await recordAudit(client, {
        siteId: ticket.site_id,
        entityType: 'desk_request',
        entityId: id,
        action: 'update',
        oldValues: ticket,
        newValues: updated[0],
        actorId,
        source: 'manual',
      });
      return { ticket: updated[0] };
    });

    if (!result) return reply.code(404).send({ error: 'Request not found' });
    if ('error' in result) return reply.code(409).send({ error: `Request is already ${result.ticket.status}` });
    return result.ticket;
  });
};

export default deskRequestsRoutes;
