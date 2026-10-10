/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- MDM-based desk-location tracking: a periodic collector (currently a Mosyle-deployed
    -- script, see mosyle/collect-desk-info.sh - but nothing here is Mosyle-specific, hence
    -- the generic 'mdm' source_type rather than naming the vendor) reports which desktop a
    -- logged-in user is currently on and which monitor that desktop is paired with.
    --
    -- A monitor is just an ordinary 'devices' row (device_type='monitor') whose workspace_id
    -- is the fixed desk it lives at - that link already exists, no new column needed for it.
    -- A desktop is also a 'devices' row, but its own workspace_id only reflects where the
    -- system last believed it to be. The two columns below capture what the MOST RECENT
    -- collector run actually observed for that desktop - a mismatch between
    -- paired_monitor_device_id's own workspace_id and the desktop's current workspace_id is
    -- what signals a possible move (handled in application code, not here).
    ALTER TABLE devices ADD COLUMN last_seen_os_username TEXT;
    ALTER TABLE devices ADD COLUMN paired_monitor_device_id BIGINT REFERENCES devices(id) ON DELETE SET NULL;

    ALTER TABLE devices DROP CONSTRAINT devices_last_seen_source_check;
    ALTER TABLE devices ADD CONSTRAINT devices_last_seen_source_check
      CHECK (last_seen_source IN ('manual','spreadsheet','camera','ai_service','mdm'));

    -- Raw per-poll collector payloads land here before interpretation, same table the
    -- original plan always intended for multi-source ingestion (docs/PROJECT_PLAN.md) - just
    -- a new source_type. site_id is relaxed to nullable: a payload about a desktop and/or
    -- monitor neither one yet registered has no site to attribute it to until an admin
    -- resolves it, but the raw observation should still be captured, not discarded for that.
    ALTER TABLE ingestion_events ALTER COLUMN site_id DROP NOT NULL;
    ALTER TABLE ingestion_events DROP CONSTRAINT ingestion_events_source_type_check;
    ALTER TABLE ingestion_events ADD CONSTRAINT ingestion_events_source_type_check
      CHECK (source_type IN ('spreadsheet','camera','mdm'));

    ALTER TABLE change_proposals DROP CONSTRAINT change_proposals_source_type_check;
    ALTER TABLE change_proposals ADD CONSTRAINT change_proposals_source_type_check
      CHECK (source_type IN ('camera','ai_service','mdm'));

    -- change_proposals.reviewed_by predates Stage 9 (auth) and still points at employees(id),
    -- the old pre-auth actor model - desk_requests (built after auth existed) established the
    -- correct pattern instead: FK to the logged-in users(id), plus a plain username column so
    -- review history reads fine even if that user/employee link later changes. Bringing
    -- change_proposals in line with that now that it's finally getting a real reviewer (the
    -- change-proposals admin review queue) rather than carrying the old assumption forward.
    ALTER TABLE change_proposals DROP CONSTRAINT change_proposals_reviewed_by_fkey;
    ALTER TABLE change_proposals ADD CONSTRAINT change_proposals_reviewed_by_fkey
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE change_proposals ADD COLUMN reviewed_by_username TEXT;

    INSERT INTO device_types (code, label) VALUES ('desktop', 'Computer')
      ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM device_types WHERE code = 'desktop';

    ALTER TABLE change_proposals DROP COLUMN IF EXISTS reviewed_by_username;
    ALTER TABLE change_proposals DROP CONSTRAINT change_proposals_reviewed_by_fkey;
    ALTER TABLE change_proposals ADD CONSTRAINT change_proposals_reviewed_by_fkey
      FOREIGN KEY (reviewed_by) REFERENCES employees(id) ON DELETE SET NULL;

    ALTER TABLE change_proposals DROP CONSTRAINT change_proposals_source_type_check;
    ALTER TABLE change_proposals ADD CONSTRAINT change_proposals_source_type_check
      CHECK (source_type IN ('camera','ai_service'));

    ALTER TABLE ingestion_events DROP CONSTRAINT ingestion_events_source_type_check;
    ALTER TABLE ingestion_events ADD CONSTRAINT ingestion_events_source_type_check
      CHECK (source_type IN ('spreadsheet','camera'));
    ALTER TABLE ingestion_events ALTER COLUMN site_id SET NOT NULL;

    ALTER TABLE devices DROP CONSTRAINT devices_last_seen_source_check;
    ALTER TABLE devices ADD CONSTRAINT devices_last_seen_source_check
      CHECK (last_seen_source IN ('manual','spreadsheet','camera','ai_service'));

    ALTER TABLE devices DROP COLUMN IF EXISTS paired_monitor_device_id;
    ALTER TABLE devices DROP COLUMN IF EXISTS last_seen_os_username;
  `);
};
