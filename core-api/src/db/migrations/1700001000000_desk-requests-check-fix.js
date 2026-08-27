/* eslint-disable */
exports.shorthands = undefined;

// The original check (employee_id set, OR both requested names set) is only meaningful while a
// request is still pending - it makes sure a *new* ticket actually identifies someone. Once a
// ticket is approved/rejected, employee_id is historical record-keeping; if that employee is
// later deleted for any reason (e.g. the HubSpot sync removing a former employee with no desk),
// ON DELETE SET NULL nulls employee_id here too, and for a ticket that used the "existing
// employee" path (never had requested_first_name/last_name set), that leaves every identifying
// field null - violating the original constraint and aborting whatever deleted the employee.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE desk_requests DROP CONSTRAINT desk_requests_person_check;
    ALTER TABLE desk_requests ADD CONSTRAINT desk_requests_person_check CHECK (
      status <> 'pending' OR employee_id IS NOT NULL
        OR (requested_first_name IS NOT NULL AND requested_last_name IS NOT NULL)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE desk_requests DROP CONSTRAINT desk_requests_person_check;
    ALTER TABLE desk_requests ADD CONSTRAINT desk_requests_person_check CHECK (
      employee_id IS NOT NULL OR (requested_first_name IS NOT NULL AND requested_last_name IS NOT NULL)
    );
  `);
};
