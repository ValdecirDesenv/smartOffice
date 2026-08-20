import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/transact';
import { recordAudit } from '../../db/audit';
import { getActorId } from '../../middleware/actor';
import { env } from '../../config/env';

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const BACKGROUNDS_SUBDIR = 'floor-backgrounds';

const bodySchema = {
  type: 'object',
  required: ['site_id', 'name'],
  properties: {
    site_id: { type: 'integer' },
    name: { type: 'string', minLength: 1 },
    level: { type: ['integer', 'null'] },
    background_image_path: { type: ['string', 'null'] },
  },
  additionalProperties: false,
} as const;

interface FloorBody {
  site_id: number;
  name: string;
  level?: number;
  background_image_path?: string | null;
}

const floorsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request) => {
    const { site_id } = request.query as { site_id?: string };
    if (site_id) {
      const { rows } = await pool.query('SELECT * FROM floors WHERE site_id = $1 ORDER BY id', [Number(site_id)]);
      return rows;
    }
    const { rows } = await pool.query('SELECT * FROM floors ORDER BY id');
    return rows;
  });

  fastify.get('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const { rows } = await pool.query('SELECT * FROM floors WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Floor not found' });
    return rows[0];
  });

  fastify.post('/', { schema: { body: bodySchema } }, async (request, reply) => {
    const body = request.body as FloorBody;
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO floors (site_id, name, level, background_image_path) VALUES ($1,$2,$3,$4) RETURNING *`,
        [body.site_id, body.name, body.level ?? null, body.background_image_path ?? null]
      );
      await recordAudit(client, {
        siteId: body.site_id,
        entityType: 'floor',
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
    const body = request.body as FloorBody;
    const actorId = getActorId(request);
    const row = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM floors WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      const { rows } = await client.query(
        `UPDATE floors SET site_id=$1, name=$2, level=$3, background_image_path=$4, updated_at=now() WHERE id=$5 RETURNING *`,
        [body.site_id, body.name, body.level ?? null, body.background_image_path ?? null, id]
      );
      await recordAudit(client, {
        siteId: body.site_id,
        entityType: 'floor',
        entityId: id,
        action: 'update',
        oldValues: existing[0],
        newValues: rows[0],
        actorId,
      });
      return rows[0];
    });
    if (!row) return reply.code(404).send({ error: 'Floor not found' });
    return row;
  });

  fastify.delete('/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const actorId = getActorId(request);
    const deleted = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT * FROM floors WHERE id = $1 FOR UPDATE', [id]);
      if (!existing[0]) return null;
      await client.query('DELETE FROM floors WHERE id = $1', [id]);
      await recordAudit(client, {
        siteId: existing[0].site_id,
        entityType: 'floor',
        entityId: id,
        action: 'delete',
        oldValues: existing[0],
        actorId,
      });
      return existing[0];
    });
    if (!deleted) return reply.code(404).send({ error: 'Floor not found' });
    return reply.code(204).send();
  });

  // Multipart upload for the floor plan background image. Reused as-is by Stage 6 (employee/workspace photos).
  fastify.post('/:id/background', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const actorId = getActorId(request);

    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'No file uploaded' });
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      return reply.code(400).send({ error: `Unsupported image type: ${file.mimetype}` });
    }

    const { rows: existing } = await pool.query('SELECT * FROM floors WHERE id = $1', [id]);
    if (!existing[0]) return reply.code(404).send({ error: 'Floor not found' });

    const ext = path.extname(file.filename) || '';
    const storedName = `${randomUUID()}${ext}`;
    const dir = path.join(env.uploadsDir, BACKGROUNDS_SUBDIR);
    await mkdir(dir, { recursive: true });
    await pipeline(file.file, createWriteStream(path.join(dir, storedName)));

    const relativePath = `${BACKGROUNDS_SUBDIR}/${storedName}`;
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE floors SET background_image_path=$1, updated_at=now() WHERE id=$2 RETURNING *`,
        [relativePath, id]
      );
      await recordAudit(client, {
        siteId: existing[0].site_id,
        entityType: 'floor',
        entityId: id,
        action: 'update',
        oldValues: existing[0],
        newValues: rows[0],
        actorId,
      });
      return rows[0];
    });
    return row;
  });
};

export default floorsRoutes;
