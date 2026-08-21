/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Lets a map-placed device (e.g. a wall-mounted TV) be rendered rotated 90 degrees to match
    -- its physical orientation on the floor.
    ALTER TABLE devices ADD COLUMN rotated BOOLEAN NOT NULL DEFAULT false;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE devices DROP COLUMN IF EXISTS rotated;`);
};
