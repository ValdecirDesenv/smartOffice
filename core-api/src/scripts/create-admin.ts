// One-off bootstrap for the very first account: since signup is invite-only, nothing can invite
// the first admin. Run inside the core-api container, e.g.:
//   docker compose exec core-api node dist/scripts/create-admin.js --username val --email val@ofg.com --password 'xxxx'
// (or, in dev: npx tsx src/scripts/create-admin.ts --username ... --email ... --password ...)
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';

function readArg(name: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  const value = idx !== -1 ? process.argv[idx + 1] : undefined;
  if (!value) {
    console.error(`Missing required --${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const username = readArg('username');
  const email = readArg('email');
  const password = readArg('password');
  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    'INSERT INTO users (username, email, password_hash, is_admin) VALUES ($1,$2,$3,true) RETURNING id, username, email',
    [username, email, passwordHash]
  );
  console.log('Created admin user:', rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
