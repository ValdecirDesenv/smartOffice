import { FastifyPluginAsync } from 'fastify';
import { pool } from '../../db/pool';
import { env } from '../../config/env';
import { generateToken, hashToken } from '../../lib/tokens';
import { sendMail } from '../../lib/mailer';

const INVITE_DAYS = 7;

const inviteSchema = {
  type: 'object',
  required: ['email'],
  properties: {
    email: { type: 'string', minLength: 1 },
    canEdit: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

const roleSchema = {
  type: 'object',
  required: ['role'],
  properties: { role: { type: 'string', enum: ['admin', 'member', 'guest'] } },
  additionalProperties: false,
} as const;

// Registered after the global requireAuth hook (see app.ts), so every route here already
// requires a logged-in session; the admin-only ones additionally check request.user.is_admin.
const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    if (!request.user!.is_admin) return reply.code(403).send({ error: 'Admin access required' });
    const { rows } = await pool.query(
      'SELECT id, username, email, employee_id, is_admin, can_edit, created_at FROM users ORDER BY id'
    );
    return rows;
  });

  fastify.post('/invites', { schema: { body: inviteSchema } }, async (request, reply) => {
    if (!request.user!.is_admin) return reply.code(403).send({ error: 'Admin access required' });
    const { email, canEdit = true } = request.body as { email: string; canEdit?: boolean };
    const token = generateToken();
    const { rows } = await pool.query(
      `INSERT INTO invites (email, token_hash, created_by, expires_at, can_edit)
       VALUES ($1,$2,$3, now() + interval '${INVITE_DAYS} days', $4) RETURNING *`,
      [email, hashToken(token), request.user!.id, canEdit]
    );
    const link = `${env.publicBaseUrl}/accept-invite?token=${token}`;
    try {
      await sendMail({
        to: email,
        subject: "You've been invited to SmartOffice",
        text: `${request.user!.username} invited you to SmartOffice. Create your account (link expires in ${INVITE_DAYS} days): ${link}`,
      });
    } catch (err) {
      request.log.error({ err }, 'Failed to send invite email');
      return reply.code(502).send({ error: 'Invite created, but the invitation email failed to send.' });
    }
    return reply.code(201).send({ id: rows[0].id, email: rows[0].email });
  });

  fastify.patch('/:id/role', { schema: { body: roleSchema } }, async (request, reply) => {
    if (!request.user!.is_admin) return reply.code(403).send({ error: 'Admin access required' });
    const { id } = request.params as { id: string };
    const { role } = request.body as { role: 'admin' | 'member' | 'guest' };
    if (id === request.user!.id && role !== 'admin') {
      return reply.code(400).send({ error: "You can't remove your own admin access" });
    }
    const { rows } = await pool.query(
      `UPDATE users SET is_admin = $1, can_edit = $2 WHERE id = $3
       RETURNING id, username, email, employee_id, is_admin, can_edit, created_at`,
      [role === 'admin', role !== 'guest', id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'User not found' });
    return rows[0];
  });
};

export default usersRoutes;
