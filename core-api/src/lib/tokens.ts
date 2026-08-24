import { randomBytes, createHash } from 'crypto';

// Same principle as a password hash: the raw token only ever exists in a cookie or an emailed
// link. Only its SHA-256 hash is ever stored, so a database read alone can't impersonate anyone.
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
