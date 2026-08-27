/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE config_snapshots (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      data JSONB NOT NULL,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_by_username TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS config_snapshots CASCADE;`);
};
