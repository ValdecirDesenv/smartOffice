/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Lets a device be placed directly on a floor's map (e.g. a meeting-room TV or shared PC)
    -- independent of being attached to any specific desk. workspace_id stays for "device at this desk".
    ALTER TABLE devices
      ADD COLUMN floor_id BIGINT REFERENCES floors(id) ON DELETE CASCADE,
      ADD COLUMN pos_x NUMERIC(6, 3),
      ADD COLUMN pos_y NUMERIC(6, 3);

    CREATE INDEX devices_floor_idx ON devices (floor_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS devices_floor_idx;
    ALTER TABLE devices
      DROP COLUMN IF EXISTS floor_id,
      DROP COLUMN IF EXISTS pos_x,
      DROP COLUMN IF EXISTS pos_y;
  `);
};
