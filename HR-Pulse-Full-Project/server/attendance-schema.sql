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
ALTER TABLE hr_attendance_devices ADD COLUMN IF NOT EXISTS last_contact timestamptz;
-- Where the machine stands on its site (main gate, workshop, office...).
ALTER TABLE hr_attendance_devices ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '';
-- The machine's IPv4 address on the site network ('' = not entered).
ALTER TABLE hr_attendance_devices ADD COLUMN IF NOT EXISTS ip_address text NOT NULL DEFAULT '';
ALTER TABLE hr_attendance_fetch_requests ADD COLUMN IF NOT EXISTS device_serial text;
CREATE INDEX IF NOT EXISTS hr_attendance_fetch_open ON hr_attendance_fetch_requests(requested_at) WHERE state IN ('PENDING','RUNNING');

-- Single row recording when the bridge PC last checked in.
CREATE TABLE IF NOT EXISTS hr_attendance_bridge(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 last_seen timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_mis_attendance_corrections(
 duty_id text PRIMARY KEY,
 status text NOT NULL CHECK(status IN ('mis','present','absent','pending')),
 start_time text NOT NULL DEFAULT '',
 end_time text NOT NULL DEFAULT '',
 reason text NOT NULL,
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0)
);

-- One shared MIS snapshot per Pulse access scope, selected site and date range.
-- Browsers no longer build separate versions of the same attendance report.
CREATE TABLE IF NOT EXISTS hr_mis_attendance_cache(
 cache_key text PRIMARY KEY,
 report jsonb NOT NULL,
 fetched_by text NOT NULL,
 fetched_at timestamptz NOT NULL DEFAULT now()
);

-- Attendance HR policy settings (one row). Missing values use the defaults in
-- attendance-policy.mjs: 1 hr lunch, under 4 hrs absent, 7 hrs full duty,
-- 15 min grace, 3 late/early marks per half duty cut, 1 hr free gate pass.
CREATE TABLE IF NOT EXISTS hr_attendance_policy(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 settings jsonb NOT NULL,
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0)
);

-- Attendance roster › Trip card (owner, 22 Nov 2026): the MIS trip cards (VLB, ELB, LMV) of one site and day, saved by
-- "Save trip cards" so the roster opens them without reading MIS again. rows: the day's duties (trip-card-store.mjs).
CREATE TABLE IF NOT EXISTS hr_trip_card_days(
 site text NOT NULL,
 day date NOT NULL,
 rows jsonb NOT NULL,
 duties integer NOT NULL,
 saved_by text NOT NULL,
 saved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site,day)
);
