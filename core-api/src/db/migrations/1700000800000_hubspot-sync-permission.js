/* eslint-disable */
exports.shorthands = undefined;

// A separate, narrower permission from is_admin: the HubSpot sync can delete employees (see
// hubspot.routes.ts), so it's restricted to one specific account rather than every admin. There's
// deliberately no API/UI to grant this to anyone else - it's set directly here, once, for the
// account that requested this feature (valdecir.oliveira@ofg.com / username "smartadmin").
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN can_sync_hubspot BOOLEAN NOT NULL DEFAULT false;
    UPDATE users SET can_sync_hubspot = true WHERE username = 'smartadmin';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE users DROP COLUMN can_sync_hubspot;`);
};
