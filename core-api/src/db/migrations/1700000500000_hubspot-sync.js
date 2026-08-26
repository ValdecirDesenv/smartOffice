/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE employees ADD COLUMN hubspot_row_id TEXT;
    ALTER TABLE employees ADD COLUMN hubspot_data JSONB;
    ALTER TABLE employees ADD COLUMN hubspot_synced_at TIMESTAMPTZ;

    ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_source_check;
    ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_source_check
      CHECK (source IN ('manual','spreadsheet','proposal','hubspot_sync'));
  `);
};
