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
CREATE INDEX IF NOT EXISTS hr_attendance_punches_person ON hr_attendance_punches(biometric_id,punched_at);

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
CREATE INDEX IF NOT EXISTS hr_attendance_fetch_pending ON hr_attendance_fetch_requests(requested_at) WHERE state='PENDING';
