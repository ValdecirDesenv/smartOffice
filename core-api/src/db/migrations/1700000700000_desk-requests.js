/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE desk_requests (
      id BIGSERIAL PRIMARY KEY,
      site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      floor_id BIGINT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
      workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      employee_id BIGINT REFERENCES employees(id) ON DELETE SET NULL,
      requested_first_name TEXT,
      requested_last_name TEXT,
      requested_email TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      requested_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requested_by_username TEXT NOT NULL,
      reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_by_username TEXT,
      reviewed_at TIMESTAMPTZ,
      review_note TEXT,
      resulting_employee_id BIGINT REFERENCES employees(id) ON DELETE SET NULL,
      resulting_assignment_id BIGINT REFERENCES workspace_assignments(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT desk_requests_person_check CHECK (
        employee_id IS NOT NULL OR (requested_first_name IS NOT NULL AND requested_last_name IS NOT NULL)
      )
    );
    CREATE INDEX desk_requests_status_idx ON desk_requests (status);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS desk_requests CASCADE;`);
};
