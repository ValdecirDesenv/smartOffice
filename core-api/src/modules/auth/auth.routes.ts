import bcrypt from 'bcryptjs';
import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/transact';
import { env } from '../../config/env';
import { generateToken, hashToken } from '../../lib/tokens';
import { sendMail } from '../../lib/mailer';
import { getSessionUser, SESSION_COOKIE_NAME } from '../../middleware/require-auth';

const SESSION_DAYS = 30;
const RESET_TOKEN_HOURS = 1;

const loginSchema = {
  type: 'object',
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 1 },
    password: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;

const forgotPasswordSchema = {
  type: 'object',
  required: ['email'],
  properties: { email: { type: 'string', minLength: 1 } },
  additionalProperties: false,
} as const;

const resetPasswordSchema = {
  type: 'object',
  required: ['token', 'password'],
  properties: {
    token: { type: 'string', minLength: 1 },
    password: { type: 'string', minLength: 8 },
  },
  additionalProperties: false,
} as const;

const acceptInviteSchema = {
  type: 'object',
  required: ['token', 'username', 'password'],
  properties: {
    token: { type: 'string', minLength: 1 },
    username: { type: 'string', minLength: 1 },
    password: { type: 'string', minLength: 8 },
  },
  additionalProperties: false,
} as const;

function publicUser(row: {
  id: string;
  username: string;
  email: string;
  employee_id: string | null;
  is_admin: boolean;
  can_edit: boolean;
}) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    employee_id: row.employee_id,
    is_admin: row.is_admin,
    can_edit: row.can_edit,
  };
}

async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2, now() + interval '${SESSION_DAYS} days')`,
    [hashToken(token), userId]
  );
  return token;
}

// The app is reachable both over plain HTTP on the LAN and over HTTPS via the Cloudflare Tunnel
// (which terminates TLS at Cloudflare's edge and forwards to core-api over plain HTTP). A cookie
// marked Secure is silently dropped by the browser on an insecure connection, so this must reflect
// how *this* request actually arrived - env.publicBaseUrl alone would wrongly mark every cookie
// Secure once it's set to the tunnel's https:// URL, breaking LAN logins entirely.
function isSecureRequest(request: FastifyRequest): boolean {
  return request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https';
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/login', { schema: { body: loginSchema } }, async (request, reply) => {
    const { username, password } = request.body as { username: string; password: string };
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return reply.code(401).send({ error: 'Invalid username or password' });
    }
    const token = await createSession(user.id);
    reply.setCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecureRequest(request),
      path: '/',
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
    return publicUser(user);
  });

  fastify.post('/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });

  fastify.get('/me', async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ error: 'Not logged in' });
    return user;
  });

  fastify.post('/forgot-password', { schema: { body: forgotPasswordSchema } }, async (request, reply) => {
    const { email } = request.body as { email: string };
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    // Always 200 regardless of whether the email is registered, so this can't be used to
    // discover which emails have accounts.
    if (user) {
      const token = generateToken();
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '${RESET_TOKEN_HOURS} hours')`,
        [user.id, hashToken(token)]
      );
      const link = `${env.publicBaseUrl}/reset-password?token=${token}`;
      try {
        await sendMail({
          to: user.email,
          subject: 'SmartOffice password reset',
          text: `Reset your password by visiting this link (expires in ${RESET_TOKEN_HOURS} hour): ${link}\n\nIf you didn't request this, you can ignore this email.`,
        });
      } catch (err) {
        request.log.error({ err }, 'Failed to send password reset email');
      }
    }
    return reply.code(200).send({ ok: true });
  });

  fastify.post('/reset-password', { schema: { body: resetPasswordSchema } }, async (request, reply) => {
    const { token, password } = request.body as { token: string; password: string };
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
        [hashToken(token)]
      );
      const resetRow = rows[0];
      if (!resetRow) return null;
      const passwordHash = await bcrypt.hash(password, 12);
      await client.query('UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2', [passwordHash, resetRow.user_id]);
      await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE id=$1', [resetRow.id]);
      // Force re-login everywhere - whoever just proved control of the mailbox is the only one
      // who should stay logged in, on whatever device they used to click the link.
      await client.query('DELETE FROM sessions WHERE user_id = $1', [resetRow.user_id]);
      return resetRow;
    });
    if (!row) return reply.code(400).send({ error: 'This reset link is invalid or has expired' });
    return reply.code(200).send({ ok: true });
  });

  fastify.get('/invites/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const { rows } = await pool.query(
      'SELECT email FROM invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
      [hashToken(token)]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'This invite link is invalid or has expired' });
    return { email: rows[0].email };
  });

  fastify.post('/accept-invite', { schema: { body: acceptInviteSchema } }, async (request, reply) => {
    const { token, username, password } = request.body as { token: string; username: string; password: string };
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE',
        [hashToken(token)]
      );
      const invite = rows[0];
      if (!invite) return null;
      const passwordHash = await bcrypt.hash(password, 12);
      const { rows: created } = await client.query(
        'INSERT INTO users (username, email, password_hash, can_edit) VALUES ($1,$2,$3,$4) RETURNING *',
        [username, invite.email, passwordHash, invite.can_edit]
      );
      await client.query('UPDATE invites SET used_at=now() WHERE id=$1', [invite.id]);
      return created[0];
    });
    // A duplicate username throws inside the transaction above (unique constraint) and is
    // handled by the global error handler as a 409, before reaching this null check.
    if (!result) return reply.code(400).send({ error: 'This invite link is invalid or has expired' });
    const sessionToken = await createSession(result.id);
    reply.setCookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecureRequest(request),
      path: '/',
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
    return reply.code(201).send(publicUser(result));
  });
};

export default authRoutes;
