/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN can_edit BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE invites ADD COLUMN can_edit BOOLEAN NOT NULL DEFAULT true;
  `);
};
