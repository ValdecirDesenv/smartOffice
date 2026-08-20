import { PoolClient } from 'pg';

export type AuditAction = 'create' | 'update' | 'delete';
export type AuditSource = 'manual' | 'spreadsheet' | 'proposal';

export interface AuditParams {
  siteId: number | null;
  entityType: string;
  entityId: number | null;
  action: AuditAction;
  oldValues?: unknown;
  newValues?: unknown;
  actorId?: number | null;
  source?: AuditSource;
}

/** Every direct write (manual or spreadsheet) records one audit_logs row in the same transaction as the entity change. */
export async function recordAudit(client: PoolClient, params: AuditParams): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (site_id, entity_type, entity_id, action, old_values, new_values, actor_id, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      params.siteId,
      params.entityType,
      params.entityId,
      params.action,
      params.oldValues ?? null,
      params.newValues ?? null,
      params.actorId ?? null,
      params.source ?? 'manual',
    ]
  );
}
