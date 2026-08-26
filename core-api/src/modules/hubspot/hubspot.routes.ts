import { FastifyPluginAsync } from 'fastify';
import { PoolClient } from 'pg';
import { withTransaction } from '../../db/transact';
import { recordAudit } from '../../db/audit';
import { getActorId } from '../../middleware/actor';
import { fetchHubspotEmployees, isHubspotConfigured } from '../../lib/hubspot';

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// HubDB's status field is a SELECT-type property: {id, name, label, ...}. id "2"/name
// "former_employee" means the person has left; anything else (including a missing status) is
// treated as current.
function isFormerEmployeeStatus(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  return (v as { id?: unknown }).id === '2';
}

interface SyncResult {
  via: 'email' | 'name' | 'created' | 'skippedNoName' | 'skippedFormerNoMatch' | null;
  removed?: boolean;
  flagged?: boolean;
}

async function hasActiveAssignment(client: PoolClient, employeeId: string): Promise<boolean> {
  const { rows } = await client.query(
    'SELECT 1 FROM workspace_assignments WHERE employee_id = $1 AND unassigned_at IS NULL LIMIT 1',
    [employeeId]
  );
  return rows.length > 0;
}

// department comes back from HubSpot already formatted like a team name ("Investment Team",
// "Operations Team") rather than a broader category, so it's matched/created directly against
// the existing teams.name column - no new table, and no attempt to also populate teams.department
// (that field is for a finer-grained grouping we don't have real data for here).
async function findOrCreateTeamId(client: PoolClient, siteId: number, teamName: string): Promise<number> {
  const { rows: existing } = await client.query('SELECT id FROM teams WHERE site_id = $1 AND lower(name) = lower($2)', [
    siteId,
    teamName,
  ]);
  if (existing[0]) return existing[0].id;
  const { rows: created } = await client.query('INSERT INTO teams (site_id, name) VALUES ($1,$2) RETURNING id', [
    siteId,
    teamName,
  ]);
  return created[0].id;
}

// HubSpot rows with no matching local employee land here rather than one of the real offices,
// since nothing in the synced fields says which office a person actually belongs to - a human
// moves them to the correct office later via the People page.
async function findOrCreateUnassignedSiteId(client: PoolClient): Promise<number> {
  const { rows: existing } = await client.query("SELECT id FROM sites WHERE name = 'Unassigned'");
  if (existing[0]) return existing[0].id;
  const { rows: created } = await client.query("INSERT INTO sites (name) VALUES ('Unassigned') RETURNING id");
  return created[0].id;
}

const hubspotRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/sync-employees', async (request, reply) => {
    if (!request.user!.is_admin) return reply.code(403).send({ error: 'Admin access required' });
    if (!isHubspotConfigured()) {
      return reply.code(503).send({ error: 'HUBSPOT_ACCESS_TOKEN is not configured' });
    }

    const actorId = getActorId(request);
    const rows = await fetchHubspotEmployees();

    let matchedByEmail = 0;
    let matchedByName = 0;
    let created = 0;
    let skippedNoIdentifier = 0;
    let skippedNoName = 0;
    let removedFormerEmployees = 0;
    let flaggedFormerEmployees = 0;
    let skippedFormerNoMatch = 0;

    for (const row of rows) {
      const email = asNonEmptyString(row.values.email)?.toLowerCase() ?? null;
      // Name and job title are merged from HubSpot whenever it has a value (HubSpot is treated
      // as the source of truth for these going forward); a field HubSpot has nothing for leaves
      // the existing local value alone rather than blanking it out.
      const firstName = asNonEmptyString(row.values.first_name);
      const lastName = asNonEmptyString(row.values.last_name);
      const fullName = firstName || lastName ? [firstName, lastName].filter(Boolean).join(' ') : null;
      const jobTitle = asNonEmptyString(row.values.role);
      const department = asNonEmptyString(row.values.department);
      const isFormer = isFormerEmployeeStatus(row.values.status);

      if (!email && !fullName) {
        skippedNoIdentifier += 1;
        continue;
      }

      const matchedBy = await withTransaction(async (client): Promise<SyncResult> => {
        let existing = null as Record<string, any> | null;
        let via: 'email' | 'name' | null = null;

        if (email) {
          const { rows: byEmail } = await client.query(
            'SELECT * FROM employees WHERE lower(email) = lower($1) FOR UPDATE',
            [email]
          );
          if (byEmail[0]) {
            existing = byEmail[0];
            via = 'email';
          }
        }

        // Fallback for the many local employees that have no email on file: match by exact
        // full name, but only against employees who *also* have no email locally (never
        // reassign someone who already has a different verified email), and only when exactly
        // one local employee has that name (an ambiguous match is safer left as unmatched than
        // guessed at).
        if (!existing && fullName) {
          const { rows: byName } = await client.query(
            `SELECT * FROM employees WHERE lower(name) = lower($1) AND (email IS NULL OR email = '') FOR UPDATE`,
            [fullName]
          );
          if (byName.length === 1) {
            existing = byName[0];
            via = 'name';
          }
        }

        if (existing) {
          // A former employee with no active desk is no longer relevant to the directory - remove
          // them outright. One who's still occupying a desk is left in place but flagged
          // (status='inactive') so the Floor Map can call out that their desk needs to be freed,
          // rather than silently deleting someone with a live assignment.
          if (isFormer && !(await hasActiveAssignment(client, existing.id))) {
            await client.query('DELETE FROM employees WHERE id = $1', [existing.id]);
            await recordAudit(client, {
              siteId: existing.site_id,
              entityType: 'employee',
              entityId: existing.id,
              action: 'delete',
              oldValues: existing,
              actorId,
              source: 'hubspot_sync',
            });
            return { via, removed: true };
          }

          const teamId = department ? await findOrCreateTeamId(client, existing.site_id, department) : null;
          const status = isFormer ? 'inactive' : 'active';

          const { rows: updatedRows } = await client.query(
            `UPDATE employees SET
               name=COALESCE($1, name),
               email=COALESCE($2, email),
               job_title=COALESCE($3, job_title),
               team_id=COALESCE($4, team_id),
               status=$5,
               hubspot_row_id=$6, hubspot_data=$7, hubspot_synced_at=now(), updated_at=now()
             WHERE id=$8 RETURNING *`,
            [fullName, email, jobTitle, teamId, status, row.id, JSON.stringify(row.values), existing.id]
          );
          await recordAudit(client, {
            siteId: existing.site_id,
            entityType: 'employee',
            entityId: existing.id,
            action: 'update',
            oldValues: existing,
            newValues: updatedRows[0],
            actorId,
            source: 'hubspot_sync',
          });
          return { via, flagged: isFormer };
        }

        // No local match at all. Per the "skip if no name" rule, only create when HubSpot
        // actually gave us a name to create with - an email-only row with no name isn't enough
        // to add someone to the directory. A former employee with no existing local record isn't
        // worth adding just to immediately be a departed-person entry either.
        if (!fullName) return { via: 'skippedNoName' as const };
        if (isFormer) return { via: 'skippedFormerNoMatch' as const };

        const unassignedSiteId = await findOrCreateUnassignedSiteId(client);
        const teamId = department ? await findOrCreateTeamId(client, unassignedSiteId, department) : null;

        const { rows: createdRows } = await client.query(
          `INSERT INTO employees (site_id, team_id, name, email, job_title, status, hubspot_row_id, hubspot_data, hubspot_synced_at)
           VALUES ($1,$2,$3,$4,$5,'active',$6,$7,now()) RETURNING *`,
          [unassignedSiteId, teamId, fullName, email, jobTitle, row.id, JSON.stringify(row.values)]
        );
        await recordAudit(client, {
          siteId: unassignedSiteId,
          entityType: 'employee',
          entityId: createdRows[0].id,
          action: 'create',
          newValues: createdRows[0],
          actorId,
          source: 'hubspot_sync',
        });
        return { via: 'created' as const };
      });

      if (matchedBy.via === 'skippedFormerNoMatch') {
        skippedFormerNoMatch += 1;
      } else if (matchedBy.removed) {
        removedFormerEmployees += 1;
      } else if (matchedBy.via === 'email' || matchedBy.via === 'name') {
        if (matchedBy.via === 'email') matchedByEmail += 1;
        else matchedByName += 1;
        if (matchedBy.flagged) flaggedFormerEmployees += 1;
      } else if (matchedBy.via === 'created') {
        created += 1;
      } else {
        skippedNoName += 1;
      }
    }

    const updated = matchedByEmail + matchedByName;
    return {
      matched: updated,
      updated,
      matchedByEmail,
      matchedByName,
      created,
      skippedNoIdentifier,
      skippedNoName,
      removedFormerEmployees,
      flaggedFormerEmployees,
      skippedFormerNoMatch,
    };
  });
};

export default hubspotRoutes;
