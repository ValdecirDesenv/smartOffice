import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool';

// Read-only visibility into the raw MDM collector log (ingestion_events) - the same table
// that's been queried by hand via psql throughout the fleet rollout, now exposed as a real
// admin page instead of needing a direct DB connection. Admin-only (not the broader
// admin-or-member canEdit gate most review pages use) since every row includes a real
// person's current IP address and OS login - more sensitive than a pending desk ticket.
function isAdmin(user: { is_admin: boolean }): boolean {
  return user.is_admin;
}

const LIST_COLUMNS = `
  id, received_at, processed_at, processing_status, error_detail, site_id,
  raw_payload->>'desktop_serial' AS desktop_serial,
  raw_payload->>'device_name' AS device_name,
  raw_payload->>'logged_in_user' AS logged_in_user,
  raw_payload->>'ip_address' AS ip_address,
  raw_payload->>'collected_at' AS collected_at,
  raw_payload->'monitors' AS monitors,
  raw_payload->>'monitor_info_raw' AS monitor_info_raw
`;

const ingestionEventsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    if (!isAdmin(request.user!)) return reply.code(403).send({ error: 'Admin access required' });
  });

  fastify.get('/', async (request) => {
    const { status, q, limit, offset } = request.query as {
      status?: string;
      q?: string;
      limit?: string;
      offset?: string;
    };

    const conditions: string[] = [`source_type = 'mdm'`];
    const values: unknown[] = [];
    if (status) {
      values.push(status);
      conditions.push(`processing_status = $${values.length}`);
    }
    if (q?.trim()) {
      values.push(`%${q.trim()}%`);
      const idx = values.length;
      conditions.push(
        `(raw_payload->>'desktop_serial' ILIKE $${idx} OR raw_payload->>'logged_in_user' ILIKE $${idx} OR raw_payload->>'device_name' ILIKE $${idx})`
      );
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    // Capped at 5000 regardless of what's requested - this is a debug/analysis log, not a
    // paginated-forever feed; the export action on the frontend asks for this cap directly
    // rather than paging through everything.
    const safeLimit = Math.min(Number(limit) || 50, 5000);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT ${LIST_COLUMNS} FROM ingestion_events ${where} ORDER BY id DESC LIMIT $${values.length + 1} OFFSET $${
          values.length + 2
        }`,
        [...values, safeLimit, safeOffset]
      ),
      pool.query(`SELECT count(*) FROM ingestion_events ${where}`, values),
    ]);

    return { rows, total: Number(countRows[0].count) };
  });

  // Seat-centric view: one row per currently-assigned desk, with its registered monitor/
  // desktop serials (if any) alongside who's actually assigned there - the inverse of the
  // "assigned people with no devices yet" check done by hand via psql throughout the
  // rollout, now a standing page instead of an ad-hoc query. string_agg (not a plain JOIN)
  // deliberately avoids row fan-out for a dual-monitor desk - a straight LEFT JOIN against
  // devices would otherwise duplicate the row once per monitor.
  fastify.get('/seats', async () => {
    const { rows } = await pool.query(`
      SELECT
        s.name AS site_name,
        f.name AS floor_name,
        w.code AS seat_location,
        w.id AS workspace_id,
        (SELECT string_agg(d.serial_number, ', ' ORDER BY d.serial_number) FROM devices d
           WHERE d.workspace_id = w.id AND d.device_type_id = (SELECT id FROM device_types WHERE code = 'monitor')
        ) AS monitor_serial,
        (SELECT string_agg(d.serial_number, ', ' ORDER BY d.serial_number) FROM devices d
           WHERE d.workspace_id = w.id AND d.device_type_id = (SELECT id FROM device_types WHERE code = 'desktop')
        ) AS computer_serial,
        e.id AS employee_id,
        e.name AS assigned_to,
        e.email AS assigned_email
      FROM workspace_assignments wa
      JOIN employees e ON e.id = wa.employee_id
      JOIN workspaces w ON w.id = wa.workspace_id
      JOIN floors f ON f.id = w.floor_id
      JOIN sites s ON s.id = w.site_id
      WHERE wa.unassigned_at IS NULL
      ORDER BY s.name, f.name, w.code
    `);
    return rows;
  });
};

export default ingestionEventsRoutes;
