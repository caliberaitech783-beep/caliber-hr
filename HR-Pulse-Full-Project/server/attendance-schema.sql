-- Attendance: fingerprint/face machines, the punches they record, and the
-- "Fetch attendance" requests raised from the Attendance Management page.
-- Every statement is idempotent, so running this at each startup is safe.

-- One row per machine. site_id links it to a site in hr_records.
CREATE TABLE IF NOT EXISTS hr_attendance_devices(
 serial text PRIMARY KEY,
 name text NOT NULL DEFAULT '',
 site_id uuid REFERENCES hr_records(id),
 last_seen timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per punch. punched_at is the clock time shown on the machine.
-- The UNIQUE rule stops the same punch from being saved twice.
CREATE TABLE IF NOT EXISTS hr_attendance_punches(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 device_serial text NOT NULL,
 biometric_id text NOT NULL,
 punched_at timestamp NOT NULL,
 verify text NOT NULL DEFAULT '',
 punch_type text NOT NULL DEFAULT '',
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(device_serial,biometric_id,punched_at)
);
CREATE INDEX IF NOT EXISTS hr_attendance_punches_time ON hr_attendance_punches(punched_at);

-- Names stored on the machine for each user ID. Shown only as a hint to help
-- HR link a machine ID to the right employee.
CREATE TABLE IF NOT EXISTS hr_attendance_device_users(
 device_serial text NOT NULL,
 biometric_id text NOT NULL,
 name text NOT NULL DEFAULT '',
 PRIMARY KEY(device_serial,biometric_id)
);

-- Which employee a machine user ID belongs to. Kept outside the employee
-- record so editing an employee never drops the link.
CREATE TABLE IF NOT EXISTS hr_attendance_links(
 device_serial text NOT NULL,
 biometric_id text NOT NULL,
 employee_id uuid NOT NULL REFERENCES hr_records(id),
 linked_by text NOT NULL,
 linked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(device_serial,biometric_id)
);
CREATE INDEX IF NOT EXISTS hr_attendance_links_employee ON hr_attendance_links(employee_id);

-- One row per click of the "Fetch attendance" button.
CREATE TABLE IF NOT EXISTS hr_attendance_fetch_requests(
 id uuid PRIMARY KEY,
 requested_by text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING',
 punches_received integer NOT NULL DEFAULT 0,
 new_punches integer NOT NULL DEFAULT 0,
 error text,
 requested_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS hr_attendance_fetch_open ON hr_attendance_fetch_requests(requested_at) WHERE state IN ('PENDING','RUNNING');

-- Single row recording when the bridge PC last checked in.
CREATE TABLE IF NOT EXISTS hr_attendance_bridge(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 last_seen timestamptz NOT NULL
);
