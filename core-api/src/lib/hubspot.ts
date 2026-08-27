import { Client } from '@hubspot/api-client';
import { env } from '../config/env';

// Mirrors the fetching logic from the sibling OptServer project (server/src/routes/reports.js),
// adapted to this codebase's conventions: the client is built lazily per-call rather than as a
// module-level singleton, so a missing token doesn't crash server boot - it only fails the sync
// route itself. Table id and properties are copied verbatim from reports.js.
const EMPLOYEE_TABLE_ID = '131850672';
const EMPLOYEE_PROPERTIES = [
  'first_name',
  'last_name',
  'preferred_name',
  'email',
  'role',
  'department',
  'status',
  'mobile_phone_number',
  'start_date',
  'termination_date',
  'registered',
  'headshot_url',
];

export interface HubspotEmployeeRow {
  id?: string;
  values: Record<string, unknown>;
}

export function isHubspotConfigured(): boolean {
  return Boolean(env.hubspotAccessToken);
}

export async function fetchHubspotEmployees(): Promise<HubspotEmployeeRow[]> {
  if (!env.hubspotAccessToken) {
    throw new Error('HUBSPOT_ACCESS_TOKEN is not configured');
  }
  const client = new Client({ accessToken: env.hubspotAccessToken });
  const { results } = await client.cms.hubdb.rowsApi.getTableRows(
    EMPLOYEE_TABLE_ID,
    undefined,
    undefined,
    undefined,
    EMPLOYEE_PROPERTIES
  );
  return results as unknown as HubspotEmployeeRow[];
}
