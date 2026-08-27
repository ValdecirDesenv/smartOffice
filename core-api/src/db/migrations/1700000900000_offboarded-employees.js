/* eslint-disable */
exports.shorthands = undefined;

// A dedicated, separate archive of every HubSpot HubDB row whose status is "former_employee"
// (status.id "2") - deliberately independent of the main `employees` table (which keeps its own
// existing delete-if-unassigned / flag-if-assigned behavior unchanged). Populated on every
// HubSpot sync; how this data actually gets used/surfaced is not decided yet.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE offboarded_employees (
      id BIGSERIAL PRIMARY KEY,
      hubspot_row_id TEXT NOT NULL UNIQUE,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      job_title TEXT,
      department TEXT,
      start_date TEXT,
      termination_date TEXT,
      headshot_url TEXT,
      data JSONB NOT NULL,
      matched_employee_id BIGINT REFERENCES employees(id) ON DELETE SET NULL,
      first_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS offboarded_employees CASCADE;`);
};
