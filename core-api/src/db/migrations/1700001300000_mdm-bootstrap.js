/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Time-boxed fleet bootstrap (MDM_BOOTSTRAP_UNTIL env var): during the initial rollout,
    -- a never-before-seen monitor or desktop is trusted and registered directly at whatever
    -- desk the logged-in user is ALREADY assigned to in SmartOffice, instead of needing an
    -- admin to pre-register every monitor or approve every new-desktop proposal by hand. This
    -- is a deliberate, human-directed bulk-trust operation (same trust tier as a spreadsheet
    -- import) rather than an inferred one, so it writes directly - but it needs its own
    -- audit_logs source value, distinct from 'manual' and 'proposal', so these bulk-created
    -- rows stay clearly traceable to how they actually got there.
    ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_source_check;
    ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_source_check
      CHECK (source IN ('manual','spreadsheet','proposal','hubspot_sync','mdm_bootstrap'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_source_check;
    ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_source_check
      CHECK (source IN ('manual','spreadsheet','proposal','hubspot_sync'));
  `);
};
