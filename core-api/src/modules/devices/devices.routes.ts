import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/transact';
import { recordAudit } from '../../db/audit';
import { getActorId } from '../../middleware/actor';

const STATUSES = ['active', 'inactive', 'missing', 'retired'];

const bodySchema = {
  type: 'object',
  required: ['site_id', 'device_type_id'],
  properties: {
    site_id: { type: 'integer' },
    workspace_id: { type: ['integer', 'null'] },
    floor_id: { type: ['integer', 'null'] },
    pos_x: { type: ['number', 'null'] },
    pos_y: { type: ['number', 'null'] },
    device_type_id: { type: 'integer' },
    name: { type: ['string', 'null'] },
    serial_number: { type: ['string', 'null'] },
    asset_tag: { type: ['string', 'null'] },
    mac_address: { type: ['string', 'null'] },
    status: { type: 'string', enum: STATUSES },
    rotated: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

interface DeviceBody {
  site_id: number;
  workspace_id?: number;
  floor_id?: number | null;
  pos_x?: number | null;
  pos_y?: number | null;
  device_type_id: number;
  name?: string | null;
  serial_number?: string | null;
  asset_tag?: string | null;
  mac_address?: string | null;
  status?: string;
  rotated?: boolean;
}

const devicesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request) => {
    const { site_id, workspace_id, floor_id } = request.query as {
      site_id?: string;
      workspace_id?: string;
      floor_id?: string;
    };
    const conditions: string[] = [];
    const values: number[] = [];
    if (site_id) {
      values.push(Number(site_id));
      conditions.push(`site_id = $${values.length}`);
    }
    if (workspace_id) {
      values.push(Number(workspace_id));
      conditions.push(`workspace_id = $${values.length}`);
    }
    if (floor_id) {
      values.push(Number(floor_id));
      conditions.push(`floor_id = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(`SELECT * FROM devices ${where} ORDER BY id`, values);
    return rows;
  });

  fastify.get('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const { rows } = await pool.query('SELECT * FROM devices WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Device not found' });
    return rows[0];
  });

  fastify.post('/', { schema: { body: bodySchema } }, async (request, reply) => {
    const body = request.body as DeviceBody;
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO devices (site_id, workspace_id, floor_id, pos_x, pos_y, device_type_id, name, serial_number, asset_tag, mac_address, status, rotated, last_seen_source, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'active'),COALESCE($12,false),'manual',now()) RETURNING *`,
        [
          body.site_id,
          body.workspace_id ?? null,
          body.floor_id ?? null,
          body.pos_x ?? null,
          body.pos_y ?? null,
          body.device_type_id,
          body.name ?? null,
          body.serial_number ?? null,
          body.asset_tag ?? null,
          body.mac_address ?? null,
          body.status ?? null,
          body.rotated ?? null,
        ]
      );
      await recordAudit(client, {
        siteId: body.site_id,
        entityType: 'device',
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
    const body = request.body as DeviceBody;
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM devices WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      const { rows } = await client.query(
        `UPDATE devices SET site_id=$1, workspace_id=$2, floor_id=$3, pos_x=$4, pos_y=$5, device_type_id=$6, name=$7, serial_number=$8,
           asset_tag=$9, mac_address=$10, status=COALESCE($11, status), rotated=COALESCE($12, rotated),
           last_seen_source='manual', last_seen_at=now(), updated_at=now() WHERE id=$13 RETURNING *`,
        [
          body.site_id,
          body.workspace_id ?? null,
          body.floor_id ?? null,
          body.pos_x ?? null,
          body.pos_y ?? null,
          body.device_type_id,
          body.name ?? null,
          body.serial_number ?? null,
          body.asset_tag ?? null,
          body.mac_address ?? null,
          body.status ?? null,
          body.rotated ?? null,
          id,
        ]
      );
      await recordAudit(client, {
        siteId: body.site_id,
        entityType: 'device',
        entityId: id,
        action: 'update',
        oldValues: existing[0],
        newValues: rows[0],
        actorId,
      });
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: 'Device not found' });
    return row;
  });

  fastify.delete('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const actorId = getActorId(request);
    const deleted = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM devices WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      await client.query('DELETE FROM devices WHERE id = $1', [id]);
      await recordAudit(client, {
        siteId: existing[0].site_id,
        entityType: 'device',
        entityId: id,
        action: 'delete',
        oldValues: existing[0],
        actorId,
      });
      return existing[0];
    });
    if (!deleted) return reply.code(404).send({ error: 'Device not found' });
    return reply.code(204).send();
  });
};

export default devicesRoutes;
