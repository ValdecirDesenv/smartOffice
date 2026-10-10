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
  // Optional: the HubSpot employee sync route returns a clear error until this is set, rather
  // than the app failing to start.
  hubspotAccessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  // Optional: shared secret the MDM desk-location collector script must send as
  // X-Collector-Token. The ingestion route returns a clear error until this is set, rather
  // than the app failing to start - same pattern as hubspotAccessToken above.
  mdmCollectorToken: process.env.MDM_COLLECTOR_TOKEN,
  // Optional: an ISO date (e.g. "2026-10-16"). While set and in the future, a never-seen
  // monitor or desktop reported by the MDM collector is trusted and registered directly at
  // the logged-in user's current desk assignment, instead of needing manual
  // pre-registration/approval - a deliberate, time-boxed bulk-trust window for the initial
  // fleet rollout. Unset (or past) reverts to the normal behavior: ignore/propose, never
  // write directly.
  mdmBootstrapUntil: process.env.MDM_BOOTSTRAP_UNTIL,
};
