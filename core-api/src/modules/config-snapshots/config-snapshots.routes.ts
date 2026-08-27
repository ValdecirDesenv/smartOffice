import { FastifyPluginAsync } from 'fastify';
import { PoolClient } from 'pg';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/transact';
import { recordAudit } from '../../db/audit';
import { getActorId } from '../../middleware/actor';

// Layout/directory data only - deliberately excludes users/sessions/invites (account access,
// not "layout or features") and audit_logs (history that must never be rewritten by a restore).
// Parent tables come before the children that reference them; DELETE during restore runs this
// list in reverse so nothing is removed while still referenced.
const RESTORE_TABLES = [
  'workspace_types',
  'device_types',
  'sites',
  'teams',
  'floors',
  'workspaces',
  'employees',
  'devices',
  'labels',
  'workspace_assignments',
] as const;

const SNAPSHOT_LIMIT = 3;

async function captureConfig(client: PoolClient): Promise<Record<string, unknown>> {
  const parts = RESTORE_TABLES.map((t) => `'${t}', (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM ${t} t)`).join(
    ',\n'
  );
  const { rows } = await client.query(`SELECT jsonb_build_object(${parts}) AS data`);
  return rows[0].data;
}

// Plain DELETE (not TRUNCATE ... CASCADE) on purpose: employees is referenced by
// audit_logs.actor_id (ON DELETE SET NULL), and a CASCADE truncate would wipe audit history
// along with it. A row-by-row DELETE instead lets each table's own ON DELETE behavior run,
// which for audit_logs just nulls the actor reference rather than deleting the log entry.
async function restoreConfig(client: PoolClient, data: unknown): Promise<void> {
  const json = JSON.stringify(data);
  for (const table of [...RESTORE_TABLES].reverse()) {
    await client.query(`DELETE FROM ${table}`);
  }
  for (const table of RESTORE_TABLES) {
    await client.query(
      `INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(null::${table}, ($1::jsonb -> '${table}'))`,
      [json]
    );
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT MAX(id) FROM ${table}) IS NOT NULL)`
    );
  }
}

const LIST_COLUMNS = `
  id, name, created_by_username, created_at, updated_at,
  jsonb_array_length(data->'sites') AS sites_count,
  jsonb_array_length(data->'floors') AS floors_count,
  jsonb_array_length(data->'workspaces') AS workspaces_count,
  jsonb_array_length(data->'employees') AS employees_count
`;

const configSnapshotsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    if (!request.user!.is_admin) return reply.code(403).send({ error: 'Admin access required' });
  });

  fastify.get('/', async () => {
    const { rows } = await pool.query(`SELECT ${LIST_COLUMNS} FROM config_snapshots ORDER BY updated_at DESC`);
    return rows;
  });

  // Saves the current live configuration as a new snapshot, unless the 3-slot limit is already
  // reached - in that case the snapshot that was saved/overwritten longest ago is replaced
  // instead, rather than blocking the save or asking which one to pick.
  fastify.post('/', async (request, reply) => {
    const { name } = (request.body as { name?: string }) ?? {};
    if (!name || !name.trim()) return reply.code(400).send({ error: 'Name is required' });
    const actorId = getActorId(request);
    const userId = Number(request.user!.id);
    const username = request.user!.username;

    const row = await withTransaction(async (client) => {
      const data = JSON.stringify(await captureConfig(client));
      const { rows: existing } = await client.query(
        'SELECT id FROM config_snapshots ORDER BY updated_at ASC FOR UPDATE'
      );

      if (existing.length < SNAPSHOT_LIMIT) {
        const { rows } = await client.query(
          `INSERT INTO config_snapshots (name, data, created_by, created_by_username)
           VALUES ($1,$2,$3,$4) RETURNING ${LIST_COLUMNS}`,
          [name.trim(), data, userId, username]
        );
        await recordAudit(client, {
          siteId: null,
          entityType: 'config_snapshot',
          entityId: rows[0].id,
          action: 'create',
          newValues: { name: rows[0].name },
          actorId,
          source: 'manual',
        });
        return rows[0];
      }

      const oldestId = existing[0].id;
      const { rows } = await client.query(
        `UPDATE config_snapshots SET name=$1, data=$2, created_by=$3, created_by_username=$4, updated_at=now()
         WHERE id=$5 RETURNING ${LIST_COLUMNS}`,
        [name.trim(), data, userId, username, oldestId]
      );
      await recordAudit(client, {
        siteId: null,
        entityType: 'config_snapshot',
        entityId: oldestId,
        action: 'update',
        newValues: { name: rows[0].name, autoOverwroteOldest: true },
        actorId,
        source: 'manual',
      });
      return rows[0];
    });

    return reply.code(201).send(row);
  });

  // Explicit overwrite of one specific snapshot (independent of the 3-slot auto-eviction above).
  fastify.put('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const { name } = (request.body as { name?: string }) ?? {};
    if (!name || !name.trim()) return reply.code(400).send({ error: 'Name is required' });
    const actorId = getActorId(request);
    const userId = Number(request.user!.id);
    const username = request.user!.username;

    const row = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT id FROM config_snapshots WHERE id = $1 FOR UPDATE', [
        id,
      ]);
      if (!existing[0]) return null;
      const data = JSON.stringify(await captureConfig(client));
      const { rows } = await client.query(
        `UPDATE config_snapshots SET name=$1, data=$2, created_by=$3, created_by_username=$4, updated_at=now()
         WHERE id=$5 RETURNING ${LIST_COLUMNS}`,
        [name.trim(), data, userId, username, id]
      );
      await recordAudit(client, {
        siteId: null,
        entityType: 'config_snapshot',
        entityId: id,
        action: 'update',
        newValues: { name: rows[0].name },
        actorId,
        source: 'manual',
      });
      return rows[0];
    });

    if (!row) return reply.code(404).send({ error: 'Snapshot not found' });
    return row;
  });

  // The destructive load: replaces every current site/floor/desk/employee/assignment with what
  // this snapshot has on file.
  fastify.post('/:id/restore', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const actorId = getActorId(request);

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT id, name, data FROM config_snapshots WHERE id = $1 FOR UPDATE', [
        id,
      ]);
      if (!rows[0]) return null;
      await restoreConfig(client, rows[0].data);
      await recordAudit(client, {
        siteId: null,
        entityType: 'config_snapshot',
        entityId: id,
        action: 'update',
        newValues: { restored: true, name: rows[0].name },
        actorId,
        source: 'manual',
      });
      return { id: rows[0].id, name: rows[0].name };
    });

    if (!result) return reply.code(404).send({ error: 'Snapshot not found' });
    return result;
  });

  fastify.delete('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const actorId = getActorId(request);

    const deleted = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT id, name FROM config_snapshots WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) return null;
      await client.query('DELETE FROM config_snapshots WHERE id = $1', [id]);
      await recordAudit(client, {
        siteId: null,
        entityType: 'config_snapshot',
        entityId: id,
        action: 'delete',
        oldValues: { name: rows[0].name },
        actorId,
        source: 'manual',
      });
      return rows[0];
    });

    if (!deleted) return reply.code(404).send({ error: 'Snapshot not found' });
    return reply.code(204).send();
  });
};

export default configSnapshotsRoutes;
