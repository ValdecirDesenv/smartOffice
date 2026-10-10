import { FastifyPluginAsync } from 'fastify';
import { withTransaction } from '../../db/transact';
import { recordAudit } from '../../db/audit';
import { env } from '../../config/env';

// Time-boxed fleet bootstrap window (MDM_BOOTSTRAP_UNTIL, an ISO date). While active, a
// never-before-seen monitor/desktop is trusted and registered directly at the logged-in
// user's current desk assignment - see the two bootstrap branches below. An invalid date
// string is treated as "not active" rather than throwing, so a typo in .env fails safe.
function isBootstrapActive(): boolean {
  if (!env.mdmBootstrapUntil) return false;
  const until = Date.parse(env.mdmBootstrapUntil);
  return !Number.isNaN(until) && Date.now() < until;
}

// Mac console/system accounts that never represent a real employee actually sitting at a desk -
// e.g. the "opt"/"admin" provisioning account created on every Mac Mini before a real profile
// exists for whoever it gets assigned to (see mosyle/README.md), plus macOS's own login-window/
// setup placeholder accounts, which represent the same "nobody is really using this desk" state.
// Matching is case-insensitive and strips spaces/underscores/dashes/dots, so "Opt Admin",
// "opt_admin", "OptAdmin" etc. all normalize to the same key.
const EXCLUDED_ACCOUNTS = new Set(
  ['opt', 'admin', 'optadmin', 'root', 'mbsetupuser', 'loginwindow'].map(normalizeAccountKey)
);

function normalizeAccountKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_.-]+/g, '');
}

// Only name + serial - that's all detection needs (Mac mini serial identifies the desktop,
// monitor serial identifies the desk). vendor/resolution/is_main were dropped from the
// collector's payload entirely - they weren't needed, and were the fields that led the
// collector script into a real bug (see mosyle/collect-desk-info.sh's comments on the
// Studio Display's two near-identical serial-ish keys).
interface MonitorReport {
  name?: string | null;
  serial?: string | null;
}

interface IngestBody {
  desktop_serial: string;
  device_name?: string | null;
  logged_in_user: string;
  ip_address?: string | null;
  collected_at?: string | null;
  monitors?: MonitorReport[];
  monitor_info_raw?: string | null;
}

// Prefers the first monitor that actually reported a serial, else just the first one - still
// used below for display purposes even though (per the confirmed design) only a monitor with a
// real serial can anchor detection. No "main display" preference anymore (dropped along with
// is_main) - most desks only have one monitor anyway, and ties just fall to list order.
function pickReportedMonitor(monitors: MonitorReport[] | undefined): MonitorReport | null {
  if (!Array.isArray(monitors) || monitors.length === 0) return null;
  const withSerial = monitors.find((m) => m?.serial && String(m.serial).trim());
  if (withSerial) return withSerial;
  return monitors[0] ?? null;
}

const bodySchema = {
  type: 'object',
  required: ['desktop_serial', 'logged_in_user'],
  properties: {
    desktop_serial: { type: 'string', minLength: 1 },
    device_name: { type: ['string', 'null'] },
    logged_in_user: { type: 'string', minLength: 1 },
    ip_address: { type: ['string', 'null'] },
    collected_at: { type: ['string', 'null'] },
    monitors: { type: 'array' },
    monitor_info_raw: { type: ['string', 'null'] },
  },
  additionalProperties: true,
} as const;

const ingestionRoutes: FastifyPluginAsync = async (fastify) => {
  // No session cookie here - this is machine-to-machine (a script running unattended on every
  // managed Mac), not a browser. Authenticated by a shared secret instead; see require-auth.ts
  // for the exemption that keeps this route out of the normal session-cookie gate.
  fastify.post('/mosyle', { schema: { body: bodySchema } }, async (request, reply) => {
    if (!env.mdmCollectorToken) {
      return reply.code(503).send({ error: 'MDM_COLLECTOR_TOKEN is not configured' });
    }
    const provided = request.headers['x-collector-token'];
    if (provided !== env.mdmCollectorToken) {
      return reply.code(401).send({ error: 'Invalid or missing X-Collector-Token' });
    }

    const body = request.body as IngestBody;
    const desktopSerial = body.desktop_serial.trim();
    const loggedInUserRaw = body.logged_in_user.trim();
    const reportedMonitor = pickReportedMonitor(body.monitors);

    const result = await withTransaction(async (client) => {
      // Always log the raw payload first, before any interpretation - this is the durable
      // record of what the collector actually sent, independent of whether anything below can
      // act on it. site_id starts NULL and is filled in below once/if it's actually known.
      const { rows: eventRows } = await client.query(
        `INSERT INTO ingestion_events (site_id, source_type, source_detail, payload_kind, raw_payload, processing_status)
         VALUES (NULL, 'mdm', 'mosyle', 'desk_location_snapshot', $1, 'received') RETURNING id`,
        [body]
      );
      const eventId = eventRows[0].id;

      async function finish(status: 'processed' | 'ignored' | 'error', note: string, siteId: number | null = null) {
        await client.query(
          `UPDATE ingestion_events
           SET processing_status=$1, processed_at=now(), error_detail=$2, site_id=COALESCE($3, site_id)
           WHERE id=$4`,
          [status, note, siteId, eventId]
        );
      }

      const accountKey = normalizeAccountKey(loggedInUserRaw);
      if (EXCLUDED_ACCOUNTS.has(accountKey)) {
        await finish('ignored', `Admin/system account "${loggedInUserRaw}" - not a real occupant`);
        return { summary: 'ignored: system/admin account' };
      }

      const { rows: typeRows } = await client.query(`SELECT code, id FROM device_types WHERE code IN ('monitor','desktop')`);
      const monitorTypeId = typeRows.find((r) => r.code === 'monitor')?.id;
      const desktopTypeId = typeRows.find((r) => r.code === 'desktop')?.id;
      if (!monitorTypeId || !desktopTypeId) {
        await finish('error', 'monitor/desktop device_types missing - run migrations');
        return { summary: 'error: device types missing' };
      }

      // Confirmed design decision: a monitor without a real reported serial cannot anchor
      // detection at all (vendor/model/resolution alone can't tell two identical-model monitors
      // at different desks apart) - that desk simply stays manual-only, same as today.
      const reportedSerial = reportedMonitor?.serial ? String(reportedMonitor.serial).trim() : '';
      if (!reportedSerial) {
        await finish('ignored', 'No monitor serial reported - automatic detection unavailable for this desk');
        return { summary: 'ignored: no monitor serial' };
      }

      // Identity match: OS username -> employee, by email-prefix heuristic (confirmed approach -
      // logged_in_user is a short macOS username, not a full name or email). Only active
      // employees are matched - never auto-propose/bootstrap seating someone already flagged
      // inactive. Resolved early (rather than only once a known desktop exists, as before) since
      // the bootstrap branches below need it too; a null result here doesn't stop anything by
      // itself - it's checked where it actually matters, further down.
      //
      // Three patterns, tried in order - confirmed real conventions across different machines
      // in this fleet, not guessed:
      //   1. Exact match against the email's full local part (email is UNIQUE, so this can
      //      never be ambiguous).
      //   2. Separator-normalized full match: OS username = "firstname_lastname" (underscore)
      //      against an email local part of "firstname.lastname" (dot) - same two name parts,
      //      different join character. Strips both "." and "_" from each side before comparing
      //      so either convention matches the other. Could theoretically collide two distinct
      //      real emails that only differ by separator choice, so (like pattern 3) only
      //      accepted when it resolves to exactly one employee.
      //   3. First-name-only fallback: OS username = first name only (e.g. "valdecir") against
      //      a "firstname.lastname" email local part - matches on just the first dot-separated
      //      token. Could be ambiguous (two employees sharing a first name), so likewise only
      //      accepted when it resolves to exactly one employee - multiple hits are treated as
      //      no match at all rather than guessing which one.
      const { rows: exactMatches } = await client.query(
        `SELECT * FROM employees WHERE status='active' AND email IS NOT NULL
           AND lower(split_part(email, '@', 1)) = lower($1)`,
        [loggedInUserRaw]
      );
      let employee = exactMatches[0];
      if (!employee) {
        const { rows: normalizedMatches } = await client.query(
          `SELECT * FROM employees WHERE status='active' AND email IS NOT NULL
             AND lower(regexp_replace(split_part(email, '@', 1), '[._]', '', 'g'))
                 = lower(regexp_replace($1, '[._]', '', 'g'))`,
          [loggedInUserRaw]
        );
        if (normalizedMatches.length === 1) employee = normalizedMatches[0];
      }
      if (!employee) {
        const { rows: firstNameMatches } = await client.query(
          `SELECT * FROM employees WHERE status='active' AND email IS NOT NULL
             AND lower(split_part(split_part(email, '@', 1), '.', 1)) = lower($1)`,
          [loggedInUserRaw]
        );
        if (firstNameMatches.length === 1) employee = firstNameMatches[0];
      }
      let currentAssignment: any = null;
      if (employee) {
        const { rows: activeAssignmentRows } = await client.query(
          `SELECT * FROM workspace_assignments WHERE employee_id=$1 AND unassigned_at IS NULL`,
          [employee.id]
        );
        currentAssignment = activeAssignmentRows[0] ?? null;
      }
      // Only usable as a bootstrap anchor when it resolves to a specific, already-seated desk -
      // an employee match with no current desk gives nothing to bootstrap onto.
      const bootstrapWorkspaceId: number | null =
        isBootstrapActive() && employee && currentAssignment ? currentAssignment.workspace_id : null;

      let monitorDevice: any;
      const { rows: monitorRows } = await client.query(`SELECT * FROM devices WHERE device_type_id=$1 AND serial_number=$2`, [
        monitorTypeId,
        reportedSerial,
      ]);
      monitorDevice = monitorRows[0];
      if (!monitorDevice) {
        if (bootstrapWorkspaceId) {
          // Fleet bootstrap: trust that this monitor is wherever its logged-in employee is
          // already seated in SmartOffice, rather than requiring an admin to pre-register
          // every monitor by hand first. Direct write (not a proposal) - see the migration
          // comment for why this is treated as a human-directed bulk-trust operation.
          const { rows: workspaceRows } = await client.query('SELECT site_id FROM workspaces WHERE id = $1', [
            bootstrapWorkspaceId,
          ]);
          const siteId = workspaceRows[0]?.site_id ?? null;
          const { rows: created } = await client.query(
            `INSERT INTO devices (site_id, workspace_id, device_type_id, serial_number, status, last_seen_source, last_seen_at)
             VALUES ($1,$2,$3,$4,'active','mdm',now()) RETURNING *`,
            [siteId, bootstrapWorkspaceId, monitorTypeId, reportedSerial]
          );
          monitorDevice = created[0];
          await recordAudit(client, {
            siteId,
            entityType: 'device',
            entityId: monitorDevice.id,
            action: 'create',
            newValues: monitorDevice,
            source: 'mdm_bootstrap',
          });
        } else {
          await finish('ignored', `Monitor serial "${reportedSerial}" is not registered as a device yet`);
          return { summary: 'ignored: unregistered monitor' };
        }
      }
      if (!monitorDevice.workspace_id) {
        await finish('ignored', `Monitor device ${monitorDevice.id} isn't placed at any desk yet`, monitorDevice.site_id);
        return { summary: 'ignored: monitor not placed at a desk' };
      }

      // Multi-monitor desks: during the bootstrap window, also register every OTHER reported
      // monitor serial at this same now-confirmed desk, not just the primary one used for
      // detection above - otherwise a dual-monitor desk would only ever get its first-in-array
      // monitor registered, leaving the second permanently "unregistered" even though it's
      // clearly sitting at the same desk as the first. Harmless to run even when the primary
      // monitor was already pre-registered (not freshly bootstrapped this call) - the desk is
      // confirmed either way.
      if (isBootstrapActive() && Array.isArray(body.monitors)) {
        const otherSerials = new Set(
          body.monitors.map((m) => (m?.serial ? String(m.serial).trim() : '')).filter((s) => s && s !== reportedSerial)
        );
        for (const serial of otherSerials) {
          const { rows: existing } = await client.query(`SELECT id FROM devices WHERE device_type_id=$1 AND serial_number=$2`, [
            monitorTypeId,
            serial,
          ]);
          if (existing[0]) continue;
          const { rows: created } = await client.query(
            `INSERT INTO devices (site_id, workspace_id, device_type_id, serial_number, status, last_seen_source, last_seen_at)
             VALUES ($1,$2,$3,$4,'active','mdm',now()) RETURNING *`,
            [monitorDevice.site_id, monitorDevice.workspace_id, monitorTypeId, serial]
          );
          await recordAudit(client, {
            siteId: monitorDevice.site_id,
            entityType: 'device',
            entityId: created[0].id,
            action: 'create',
            newValues: created[0],
            source: 'mdm_bootstrap',
          });
        }
      }

      let desktopDevice: any;
      const { rows: desktopRows } = await client.query(
        `SELECT * FROM devices WHERE device_type_id=$1 AND serial_number=$2 FOR UPDATE`,
        [desktopTypeId, desktopSerial]
      );
      desktopDevice = desktopRows[0];

      if (!desktopDevice) {
        if (bootstrapWorkspaceId) {
          // Same bulk-trust bootstrap as the monitor above, for the desktop itself.
          const { rows: created } = await client.query(
            `INSERT INTO devices (site_id, workspace_id, device_type_id, serial_number, name, status, last_seen_source, last_seen_at, last_seen_os_username, paired_monitor_device_id)
             VALUES ($1,$2,$3,$4,$5,'active','mdm',now(),$6,$7) RETURNING *`,
            [
              monitorDevice.site_id,
              monitorDevice.workspace_id,
              desktopTypeId,
              desktopSerial,
              body.device_name ?? null,
              loggedInUserRaw,
              monitorDevice.id,
            ]
          );
          desktopDevice = created[0];
          await recordAudit(client, {
            siteId: monitorDevice.site_id,
            entityType: 'device',
            entityId: desktopDevice.id,
            action: 'create',
            newValues: desktopDevice,
            source: 'mdm_bootstrap',
          });
        } else {
          // Brand-new desktop never registered. Per the system's own design rule (non-manual
          // sources never write directly to an authoritative table, 'device' included outside
          // the bootstrap window above), this proposes registering it rather than inserting it
          // outright - an admin approves it once, then every later poll for this serial takes
          // the (existing desktop) branch below.
          const newValues = {
            site_id: monitorDevice.site_id,
            device_type_id: desktopTypeId,
            serial_number: desktopSerial,
            name: body.device_name ?? null,
            workspace_id: monitorDevice.workspace_id,
            status: 'active',
          };
          await client.query(
            `INSERT INTO change_proposals (site_id, entity_type, entity_id, action, new_values, source_type, source_event_id, reason, status)
             VALUES ($1,'device',NULL,'create',$2,'mdm',$3,$4,'pending')`,
            [
              monitorDevice.site_id,
              newValues,
              eventId,
              `New desktop detected via MDM collector (user "${loggedInUserRaw}"), not yet registered as a device`,
            ]
          );
          await finish('processed', 'New desktop - registration proposal created', monitorDevice.site_id);
          return { summary: 'proposal: new desktop device' };
        }
      } else {
        // Passive tracking metadata - not gated behind a proposal, same as last_seen_source/
        // last_seen_at already were for every other ingestion source. The desktop's own
        // *workspace_id* (the authoritative "where is this device" field) is deliberately left
        // untouched here - it only changes as part of an approved workspace_assignment proposal
        // below (or the bootstrap branch above, for a brand-new desktop), so both update
        // atomically with the employee's own assignment rather than drifting independently.
        await client.query(
          `UPDATE devices
           SET last_seen_source='mdm', last_seen_at=now(), last_seen_os_username=$1, paired_monitor_device_id=$2, updated_at=now()
           WHERE id=$3`,
          [loggedInUserRaw, monitorDevice.id, desktopDevice.id]
        );
      }

      if (!employee) {
        // Surfaced via ingestion_events (processing_status='error') for now rather than its own
        // review UI - a known, deliberately deferred gap, not an oversight.
        await finish(
          'error',
          `Logged-in user "${loggedInUserRaw}" didn't match any active employee by email prefix`,
          monitorDevice.site_id
        );
        return { summary: 'error: unmatched user' };
      }

      if (currentAssignment && currentAssignment.workspace_id === monitorDevice.workspace_id) {
        await finish('processed', 'No move detected - already at this desk', monitorDevice.site_id);
        return { summary: 'no change' };
      }

      // Don't spam a fresh proposal every ~15-30 min poll before an admin gets to the first one.
      const { rows: existingPending } = await client.query(
        `SELECT id FROM change_proposals
         WHERE entity_type='workspace_assignment' AND status='pending' AND source_type='mdm'
           AND (new_values->>'employee_id')::bigint = $1
           AND (new_values->>'workspace_id')::bigint = $2`,
        [employee.id, monitorDevice.workspace_id]
      );
      if (existingPending[0]) {
        await finish(
          'processed',
          `Already has a pending move proposal (#${existingPending[0].id})`,
          monitorDevice.site_id
        );
        return { summary: 'duplicate of pending proposal' };
      }

      const newValues = {
        employee_id: employee.id,
        workspace_id: monitorDevice.workspace_id,
        previous_assignment_id: currentAssignment?.id ?? null,
        previous_workspace_id: currentAssignment?.workspace_id ?? null,
        desktop_device_id: desktopDevice.id,
      };
      await client.query(
        `INSERT INTO change_proposals (site_id, entity_type, entity_id, action, old_values, new_values, source_type, source_event_id, reason, status)
         VALUES ($1,'workspace_assignment',NULL,'create',$2,$3,'mdm',$4,$5,'pending')`,
        [
          monitorDevice.site_id,
          currentAssignment ?? null,
          newValues,
          eventId,
          `Detected via MDM: desktop ${desktopSerial} (user "${loggedInUserRaw}") now paired with a monitor at a different desk`,
        ]
      );
      await finish('processed', 'Move proposal created', monitorDevice.site_id);
      return { summary: 'proposal: desk move' };
    });

    return reply.code(202).send(result);
  });
};

export default ingestionRoutes;
