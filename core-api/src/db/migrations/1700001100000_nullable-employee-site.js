/* eslint-disable */
exports.shorthands = undefined;

// Removes the "Unassigned" placeholder-office concept the HubSpot sync used for people it
// couldn't match to a real site. An employee with an unknown office doesn't need a fake office
// to belong to - they just sit in the directory with no site until a human assigns them to a
// real one (or to a desk directly, which sets it). Migrates anyone currently parked in a site
// named 'Unassigned' to site_id NULL, then removes that site.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE employees ALTER COLUMN site_id DROP NOT NULL;

    UPDATE employees SET site_id = NULL, team_id = NULL
      WHERE site_id IN (SELECT id FROM sites WHERE name = 'Unassigned');

    DELETE FROM sites WHERE name = 'Unassigned';
  `);
};

exports.down = (pgm) => {
  // Best-effort only: doesn't recreate the deleted "Unassigned" site or move NULL-site
  // employees back into it (which one they came from isn't recoverable at this point) - if any
  // employee still has a NULL site_id, this will fail until that's resolved by hand.
  pgm.sql(`
    ALTER TABLE employees ALTER COLUMN site_id SET NOT NULL;
  `);
};
