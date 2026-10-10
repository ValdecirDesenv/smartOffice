import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/transact';
import { getActorId } from '../../middleware/actor';

function canReview(user: { is_admin: boolean; can_edit: boolean }): boolean {
  return user.is_admin || user.can_edit;
}

// Generic review queue for change_proposals - any non-manual source (today: the MDM desk-
// location pipeline; later, Stage 3c's camera/AI service) lands here instead of writing
// directly, same pattern desk_requests already established for guest-submitted tickets.
const changeProposalsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    if (!canReview(request.user!)) return reply.code(403).send({ error: 'Admin or member access required' });
  });

  // Enriches a proposal with human-readable names for the two shapes the MDM pipeline actually
  // produces (device / workspace_assignment) - anything else (future camera/AI sources) just
  // falls back to its raw new_values/old_values JSON for the admin to read directly.
  fastify.get('/', async (request) => {
    const { status } = (request.query as { status?: string }) ?? {};
    const { rows } = await pool.query(
      `SELECT cp.*, s.name AS site_name FROM change_proposals cp
       LEFT JOIN sites s ON s.id = cp.site_id
       WHERE cp.status = $1
       ORDER BY cp.created_at ASC`,
      [status || 'pending']
    );

    const enriched = await Promise.all(
      rows.map(async (row) => {
        if (row.entity_type === 'workspace_assignment') {
          const { rows: lookups } = await pool.query(
            `SELECT
               (SELECT name FROM employees WHERE id = $1) AS employee_name,
               (SELECT code FROM workspaces WHERE id = $2) AS new_workspace_code,
               (SELECT code FROM workspaces WHERE id = $3) AS previous_workspace_code`,
            [row.new_values?.employee_id ?? null, row.new_values?.workspace_id ?? null, row.new_values?.previous_workspace_id ?? null]
          );
          return { ...row, ...lookups[0] };
        }
        if (row.entity_type === 'device') {
          const { rows: lookups } = await pool.query(`SELECT code FROM workspaces WHERE id = $1`, [
            row.new_values?.workspace_id ?? null,
          ]);
          return { ...row, new_workspace_code: lookups[0]?.code ?? null };
        }
        return row;
      })
    );
    return enriched;
  });

  fastify.post('/:id/approve', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const actorId = getActorId(request);
    const userId = Number(request.user!.id);
    const username = request.user!.username;

    type ApproveResult = { error: number; message: string } | { proposal: Record<string, any> };

    const result = await withTransaction(async (client): Promise<ApproveResult> => {
      const { rows: proposalRows } = await client.query('SELECT * FROM change_proposals WHERE id = $1 FOR UPDATE', [id]);
      const proposal = proposalRows[0];
      if (!proposal) return { error: 404, message: 'Proposal not found' };
      if (proposal.status !== 'pending') return { error: 409, message: `Proposal is already ${proposal.status}` };

      let resultingAuditLogId: number | null = null;

      if (proposal.entity_type === 'device') {
        const v = proposal.new_values;
        const { rows: created } = await client.query(
          `INSERT INTO devices (site_id, workspace_id, device_type_id, name, serial_number, status, last_seen_source, last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,'mdm',now()) RETURNING *`,
          [v.site_id, v.workspace_id ?? null, v.device_type_id, v.name ?? null, v.serial_number, v.status ?? 'active']
        );
        const { rows: auditRows } = await client.query(
          `INSERT INTO audit_logs (site_id, entity_type, entity_id, action, new_values, actor_id, source, change_proposal_id)
           VALUES ($1,'device',$2,'create',$3,$4,'proposal',$5) RETURNING id`,
          [v.site_id, created[0].id, created[0], actorId, id]
        );
        resultingAuditLogId = auditRows[0].id;
      } else if (proposal.entity_type === 'workspace_assignment') {
        const v = proposal.new_values;

        // Close the employee's prior assignment first, if the proposal recorded one and it's
        // still active (it may have been manually changed since this proposal was created -
        // the FOR UPDATE + re-check here guards against stepping on that).
        if (v.previous_assignment_id) {
          const { rows: prevRows } = await client.query(
            'SELECT * FROM workspace_assignments WHERE id = $1 AND unassigned_at IS NULL FOR UPDATE',
            [v.previous_assignment_id]
          );
          if (prevRows[0]) {
            const { rows: closed } = await client.query(
              `UPDATE workspace_assignments SET unassigned_at=now(), updated_at=now() WHERE id=$1 RETURNING *`,
              [v.previous_assignment_id]
            );
            await client.query(`UPDATE workspaces SET status='available', updated_at=now() WHERE id=$1`, [
              prevRows[0].workspace_id,
            ]);
            await client.query(
              `INSERT INTO audit_logs (site_id, entity_type, entity_id, action, old_values, new_values, actor_id, source, change_proposal_id)
               VALUES ($1,'workspace_assignment',$2,'update',$3,$4,$5,'proposal',$6)`,
              [proposal.site_id, v.previous_assignment_id, prevRows[0], closed[0], actorId, id]
            );
          }
        }

        const { rows: createdAssignment } = await client.query(
          `INSERT INTO workspace_assignments (workspace_id, employee_id) VALUES ($1,$2) RETURNING *`,
          [v.workspace_id, v.employee_id]
        );
        await client.query(`UPDATE workspaces SET status='assigned', updated_at=now() WHERE id=$1`, [v.workspace_id]);
        // The desktop physically moved along with the employee - its own authoritative
        // workspace_id only ever changes here, as part of this same approved/atomic write.
        if (v.desktop_device_id) {
          await client.query(`UPDATE devices SET workspace_id=$1, updated_at=now() WHERE id=$2`, [
            v.workspace_id,
            v.desktop_device_id,
          ]);
        }
        const { rows: auditRows } = await client.query(
          `INSERT INTO audit_logs (site_id, entity_type, entity_id, action, new_values, actor_id, source, change_proposal_id)
           VALUES ($1,'workspace_assignment',$2,'create',$3,$4,'proposal',$5) RETURNING id`,
          [proposal.site_id, createdAssignment[0].id, createdAssignment[0], actorId, id]
        );
        resultingAuditLogId = auditRows[0].id;
      } else {
        return { error: 400, message: `Don't know how to approve a "${proposal.entity_type}" proposal yet` };
      }

      const { rows: updated } = await client.query(
        `UPDATE change_proposals
         SET status='approved', reviewed_by=$1, reviewed_by_username=$2, reviewed_at=now(), resulting_audit_log_id=$3, updated_at=now()
         WHERE id=$4 RETURNING *`,
        [userId, username, resultingAuditLogId, id]
      );
      return { proposal: updated[0] };
    });

    if ('error' in result) return reply.code(result.error).send({ error: result.message });
    return result.proposal;
  });

  fastify.post('/:id/reject', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const { review_note } = (request.body as { review_note?: string }) ?? {};
    const userId = Number(request.user!.id);
    const username = request.user!.username;

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM change_proposals WHERE id = $1 FOR UPDATE', [id]);
      const proposal = rows[0];
      if (!proposal) return null;
      if (proposal.status !== 'pending') return { error: true, proposal };
      const { rows: updated } = await client.query(
        `UPDATE change_proposals
         SET status='rejected', reviewed_by=$1, reviewed_by_username=$2, reviewed_at=now(), review_note=$3, updated_at=now()
         WHERE id=$4 RETURNING *`,
        [userId, username, review_note?.trim() || null, id]
      );
      return { proposal: updated[0] };
    });

    if (!result) return reply.code(404).send({ error: 'Proposal not found' });
    if ('error' in result) return reply.code(409).send({ error: `Proposal is already ${result.proposal.status}` });
    return result.proposal;
  });
};

export default changeProposalsRoutes;
