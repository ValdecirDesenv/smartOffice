function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required('DATABASE_URL'),
  uploadsDir: process.env.UPLOADS_DIR ?? '/data/uploads',
  sessionCookieSecret: required('SESSION_COOKIE_SECRET'),
  // Used to build absolute links in emails (reset-password, invite) - request.hostname alone
  // isn't reliable once traffic arrives through a Cloudflare Tunnel.
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`,
  // Optional: email sending is skipped (with a logged warning) until these are set, so login/
  // sessions/invites can be built and tested before Gmail SMTP credentials exist.
  gmailUser: process.env.GMAIL_USER,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
};
