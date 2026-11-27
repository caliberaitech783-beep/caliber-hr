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
-- One machine's punches in time order: the roster's day count and last punch per machine (attendance-register.mjs).
CREATE INDEX IF NOT EXISTS hr_attendance_punches_device_time ON hr_attendance_punches(device_serial,punched_at);

-- Punches uploaded in Attendance roster > Manual Biometric. Kept separate from
-- live machine punches so a manual file can never change the live biometric register.
CREATE TABLE IF NOT EXISTS hr_manual_biometric_punches(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 device_serial text NOT NULL,
 biometric_id text NOT NULL,
 punched_at timestamp NOT NULL,
 verify text NOT NULL DEFAULT '',
 punch_type text NOT NULL DEFAULT '',
 imported_by text NOT NULL DEFAULT '',
 imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(device_serial,biometric_id,punched_at)
);
CREATE INDEX IF NOT EXISTS hr_manual_biometric_punches_time ON hr_manual_biometric_punches(punched_at);
CREATE INDEX IF NOT EXISTS hr_manual_biometric_punches_device_time ON hr_manual_biometric_punches(device_serial,punched_at);
-- Manual roster first narrows by machine and day, then reads the biometric ID without returning to the table.
CREATE INDEX IF NOT EXISTS hr_manual_biometric_punches_device_time_id ON hr_manual_biometric_punches(device_serial,punched_at,biometric_id);

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
-- Owner, 27 Nov 2026: Pulse-II is the master of trip card attendance. What Pulse-II signed for the site's day when the
-- rows were read; the roster shows a saved day only while Pulse-II still gives this signature (NULL: saved before).
ALTER TABLE hr_trip_card_days ADD COLUMN IF NOT EXISTS mis_signature text;

-- Attendance roster › Biometric (owner, 23 Nov 2026): one site's biometric roster for one day (every punch on the site's
-- machines, rated with the attendance policy), saved by "Save biometric" (biometric-day-store.mjs). register: the site
-- register for that day as loadSiteRegister builds it, so the Biometric tab opens it without reading the punches again.
CREATE TABLE IF NOT EXISTS hr_biometric_days(
 site text NOT NULL,
 day date NOT NULL,
 register jsonb NOT NULL,
 punches integer NOT NULL,
 people integer NOT NULL,
 saved_by text NOT NULL,
 saved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site,day)
);

-- Manual Biometric snapshots. A saved site/day is immutable and also blocks any later manual-log import for that day.
CREATE TABLE IF NOT EXISTS hr_manual_biometric_days(
 site text NOT NULL,
 day date NOT NULL,
 register jsonb NOT NULL,
 punches integer NOT NULL,
 people integer NOT NULL,
 saved_by text NOT NULL,
 saved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site,day)
);

-- Admin corrections of a Manual Biometric day (owner, 25 Nov 2026; manual-attendance-corrections.mjs). The imported
-- punches stay as imported; a correction gives the day a new In / Out and / or code, with the reason and who made it.
CREATE TABLE IF NOT EXISTS hr_manual_attendance_corrections(
 site text NOT NULL,
 day date NOT NULL,
 employee_code text NOT NULL,
 status text NOT NULL DEFAULT '',
 in_time text NOT NULL DEFAULT '',
 out_time text NOT NULL DEFAULT '',
 reason text NOT NULL,
 corrected_by text NOT NULL,
 corrected_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site,day,employee_code)
);

-- Bridge PCs per site (owner, 22 Nov 2026): each site's bridge PC signs in with its own key (attendance-bridges.mjs).
-- Only the key's SHA-256 fingerprint and last 4 letters are kept. The first bridge PC keeps ATTENDANCE_BRIDGE_KEY and
-- is the "Main bridge PC" (bridge_id NULL on its machines and fetch requests).
CREATE TABLE IF NOT EXISTS hr_attendance_bridges(
 id uuid PRIMARY KEY,
 site_id uuid REFERENCES hr_records(id),
 name text NOT NULL,
 key_hash text NOT NULL UNIQUE,
 key_hint text NOT NULL,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_seen timestamptz,
 removed_at timestamptz
);
-- The bridge PC a machine reports to (NULL = the main bridge PC).
ALTER TABLE hr_attendance_devices ADD COLUMN IF NOT EXISTS bridge_id uuid;
-- The bridge PC that must pick up a fetch request (NULL = the main bridge PC).
ALTER TABLE hr_attendance_fetch_requests ADD COLUMN IF NOT EXISTS bridge_id uuid;
-- Last time the machine pushed straight to HR Pulse without a bridge PC (attendance-direct.mjs, owner 22 Nov 2026).
ALTER TABLE hr_attendance_devices ADD COLUMN IF NOT EXISTS direct_contact timestamptz;
-- Machine master (owner, 23 Nov 2026): the machine no. set on the machine (Menu › Comm. › Device ID; its USB log is
-- named <no.>_attlog.dat, so an upload finds the machine by it), and its make and model. '' = not entered.
ALTER TABLE hr_attendance_devices ADD COLUMN IF NOT EXISTS machine_no text NOT NULL DEFAULT '';
ALTER TABLE hr_attendance_devices ADD COLUMN IF NOT EXISTS make text NOT NULL DEFAULT '';
ALTER TABLE hr_attendance_devices ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '';
