/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- ===== Lookup tables (global, not site-scoped) =====
    CREATE TABLE workspace_types (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE device_types (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ===== Core site-scoped entities =====
    CREATE TABLE sites (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      timezone TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE floors (
      id BIGSERIAL PRIMARY KEY,
      site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      level INTEGER,
      background_image_path TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX floors_site_idx ON floors (site_id);

    CREATE TABLE workspaces (
      id BIGSERIAL PRIMARY KEY,
      site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      floor_id BIGINT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
      workspace_type_id BIGINT NOT NULL REFERENCES workspace_types(id),
      code TEXT NOT NULL,
      pos_x NUMERIC(6,3),
      pos_y NUMERIC(6,3),
      status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available','occupied','reserved','assigned','inactive')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (floor_id, code)
    );
    CREATE INDEX workspaces_site_idx ON workspaces (site_id);
    CREATE INDEX workspaces_floor_idx ON workspaces (floor_id);

    CREATE TABLE labels (
      id BIGSERIAL PRIMARY KEY,
      floor_id BIGINT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      pos_x NUMERIC(6,3),
      pos_y NUMERIC(6,3),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX labels_floor_idx ON labels (floor_id);

    CREATE TABLE teams (
      id BIGSERIAL PRIMARY KEY,
      site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      department TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX teams_site_idx ON teams (site_id);

    CREATE TABLE employees (
      id BIGSERIAL PRIMARY KEY,
      site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      job_title TEXT,
      photo_id BIGINT, -- FK to photos(id) added after photos exists (see below)
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX employees_site_idx ON employees (site_id);
    CREATE INDEX employees_team_idx ON employees (team_id);

    CREATE TABLE workspace_assignments (
      id BIGSERIAL PRIMARY KEY,
      workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      unassigned_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX workspace_assignments_active_workspace_uq
      ON workspace_assignments (workspace_id) WHERE unassigned_at IS NULL;
    CREATE UNIQUE INDEX workspace_assignments_active_employee_uq
      ON workspace_assignments (employee_id) WHERE unassigned_at IS NULL;

    CREATE TABLE bookings (
      id BIGSERIAL PRIMARY KEY,
      workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      booking_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'booked'
        CHECK (status IN ('held','booked','checked_in','expired','cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX bookings_workspace_idx ON bookings (workspace_id);
    CREATE INDEX bookings_employee_idx ON bookings (employee_id);
    CREATE INDEX bookings_date_idx ON bookings (booking_date);

    CREATE TABLE photos (
      id BIGSERIAL PRIMARY KEY,
      site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('employee','workspace','device')),
      entity_id BIGINT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX photos_entity_idx ON photos (entity_type, entity_id);

    ALTER TABLE employees ADD CONSTRAINT employees_photo_fk
      FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE SET NULL;

    CREATE TABLE import_logs (
      id BIGSERIAL PRIMARY KEY,
      site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      import_kind TEXT NOT NULL DEFAULT 'employee_directory'
        CHECK (import_kind IN ('employee_directory','devices','occupancy_snapshot')),
      filename TEXT,
      status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded','pending','committed','failed')),
      row_count INTEGER,
      error_count INTEGER,
      errors JSONB,
      created_by BIGINT REFERENCES employees(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX import_logs_site_idx ON import_logs (site_id);

    CREATE TABLE devices (
      id BIGSERIAL PRIMARY KEY,
      site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      workspace_id BIGINT REFERENCES workspaces(id) ON DELETE SET NULL,
      device_type_id BIGINT NOT NULL REFERENCES device_types(id),
      name TEXT,
      serial_number TEXT,
      asset_tag TEXT,
      mac_address TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','inactive','missing','retired')),
      last_seen_source TEXT CHECK (last_seen_source IN ('manual','spreadsheet','camera','ai_service')),
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX devices_site_idx ON devices (site_id);
    CREATE INDEX devices_workspace_idx ON devices (workspace_id);
    CREATE UNIQUE INDEX devices_serial_number_uq ON devices (serial_number) WHERE serial_number IS NOT NULL;
    CREATE UNIQUE INDEX devices_asset_tag_uq ON devices (asset_tag) WHERE asset_tag IS NOT NULL;

    -- ===== Multi-source ingestion + AI/camera review queue =====
    CREATE TABLE ingestion_events (
      id BIGSERIAL PRIMARY KEY,
      site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('spreadsheet','camera')),
      source_detail TEXT,
      import_log_id BIGINT REFERENCES import_logs(id) ON DELETE SET NULL,
      external_batch_id TEXT,
      payload_kind TEXT NOT NULL,
      raw_payload JSONB NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      processing_status TEXT NOT NULL DEFAULT 'received'
        CHECK (processing_status IN ('received','processed','ignored','error')),
      processed_at TIMESTAMPTZ,
      error_detail TEXT
    );
    CREATE INDEX ingestion_events_status_idx ON ingestion_events (processing_status, source_type);
    CREATE INDEX ingestion_events_import_log_idx ON ingestion_events (import_log_id);

    CREATE TABLE change_proposals (
      id BIGSERIAL PRIMARY KEY,
      site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL
        CHECK (entity_type IN ('workspace','employee','device','workspace_assignment','label')),
      entity_id BIGINT,
      action TEXT NOT NULL CHECK (action IN ('create','update','delete')),
      old_values JSONB,
      new_values JSONB NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('camera','ai_service')),
      source_event_id BIGINT REFERENCES ingestion_events(id) ON DELETE SET NULL,
      confidence NUMERIC(4,3),
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected','expired','superseded')),
      expires_at TIMESTAMPTZ,
      reviewed_by BIGINT REFERENCES employees(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      review_note TEXT,
      resulting_audit_log_id BIGINT, -- FK to audit_logs(id) added after audit_logs exists (see below)
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT entity_id_required_unless_create CHECK (action = 'create' OR entity_id IS NOT NULL)
    );
    CREATE INDEX change_proposals_pending_idx ON change_proposals (status, entity_type, entity_id)
      WHERE status = 'pending';
    CREATE INDEX change_proposals_expiry_idx ON change_proposals (expires_at) WHERE status = 'pending';
    CREATE INDEX change_proposals_source_event_idx ON change_proposals (source_event_id);

    CREATE TABLE audit_logs (
      id BIGSERIAL PRIMARY KEY,
      site_id BIGINT REFERENCES sites(id) ON DELETE SET NULL, -- nullable: global lookups (workspace_types/device_types) aren't site-scoped
      entity_type TEXT NOT NULL,
      entity_id BIGINT,
      action TEXT NOT NULL CHECK (action IN ('create','update','delete')),
      old_values JSONB,
      new_values JSONB,
      actor_id BIGINT REFERENCES employees(id) ON DELETE SET NULL,
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','spreadsheet','proposal')),
      change_proposal_id BIGINT REFERENCES change_proposals(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
    CREATE INDEX audit_logs_site_idx ON audit_logs (site_id);

    ALTER TABLE change_proposals ADD CONSTRAINT change_proposals_audit_log_fk
      FOREIGN KEY (resulting_audit_log_id) REFERENCES audit_logs(id) ON DELETE SET NULL;

    -- ===== Seed lookup data =====
    INSERT INTO workspace_types (code, label) VALUES
      ('desk', 'Desk'),
      ('office', 'Office'),
      ('meeting_room', 'Meeting Room'),
      ('parking', 'Parking'),
      ('locker', 'Locker'),
      ('other', 'Other');

    INSERT INTO device_types (code, label) VALUES
      ('monitor', 'Monitor'),
      ('dock', 'Dock'),
      ('laptop', 'Laptop'),
      ('phone', 'Phone'),
      ('other', 'Other');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS change_proposals CASCADE;
    DROP TABLE IF EXISTS ingestion_events CASCADE;
    DROP TABLE IF EXISTS audit_logs CASCADE;
    DROP TABLE IF EXISTS devices CASCADE;
    DROP TABLE IF EXISTS import_logs CASCADE;
    DROP TABLE IF EXISTS photos CASCADE;
    DROP TABLE IF EXISTS bookings CASCADE;
    DROP TABLE IF EXISTS workspace_assignments CASCADE;
    DROP TABLE IF EXISTS employees CASCADE;
    DROP TABLE IF EXISTS teams CASCADE;
    DROP TABLE IF EXISTS labels CASCADE;
    DROP TABLE IF EXISTS workspaces CASCADE;
    DROP TABLE IF EXISTS floors CASCADE;
    DROP TABLE IF EXISTS sites CASCADE;
    DROP TABLE IF EXISTS device_types CASCADE;
    DROP TABLE IF EXISTS workspace_types CASCADE;
  `);
};
