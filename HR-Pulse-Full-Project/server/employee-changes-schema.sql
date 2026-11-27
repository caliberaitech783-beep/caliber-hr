-- The change list of the Employee Master (owner, 23 Nov 2026): HR Pulse is the only place where an employee is
-- created, edited or removed, and Pulse-II copies every change within a minute. Pulse-II asks "what changed after
-- number N?" (mis-employee-sync.mjs), so every change of a register line or of a joined employee gets a running
-- number here. Two database triggers write it, so no screen, import or later code can change an employee
-- without leaving a line. Only the employee number is kept: Pulse-II then reads that person's lines as they are now.
CREATE TABLE IF NOT EXISTS hr_employee_changes (
 seq bigserial PRIMARY KEY,
 source text NOT NULL,
 action text NOT NULL,
 record_id text,
 old_number text NOT NULL DEFAULT '',
 new_number text NOT NULL DEFAULT '',
 at timestamptz NOT NULL DEFAULT now()
);

-- The number of an Employee ID, read the same way as employeeNumber() in employee-number.mjs:
-- CMPL123 = CMLL123 = "CMLL 0123" = 123; anything that is not a number is ''.
CREATE OR REPLACE FUNCTION hr_employee_number(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
 SELECT CASE WHEN regexp_replace(upper(coalesce(value,'')),'[[:space:]/-]','','g') ~ '^(CMPL|CMLL)?[0-9]{1,9}$'
  THEN ltrim(regexp_replace(regexp_replace(upper(coalesce(value,'')),'[[:space:]/-]','','g'),'^(CMPL|CMLL)',''),'0')
  ELSE '' END
$fn$;

-- WCL manual-biometric matching uses the numeric part of Employee ID. Keep that lookup indexed for every site/user.
CREATE INDEX IF NOT EXISTS hr_employee_master_register_employee_number
 ON hr_employee_master_register(hr_employee_number(data->>'employeeId'))
 WHERE hr_employee_number(data->>'employeeId')<>'';

CREATE OR REPLACE FUNCTION hr_note_register_change() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE old_n text := ''; new_n text := '';
BEGIN
 IF TG_OP <> 'INSERT' THEN old_n := hr_employee_number(OLD.data->>'employeeId'); END IF;
 IF TG_OP <> 'DELETE' THEN new_n := hr_employee_number(NEW.data->>'employeeId'); END IF;
 IF old_n = '' AND new_n = '' THEN RETURN NULL; END IF;
 IF TG_OP = 'UPDATE' AND OLD.data IS NOT DISTINCT FROM NEW.data AND OLD.name IS NOT DISTINCT FROM NEW.name
    AND OLD.site_code IS NOT DISTINCT FROM NEW.site_code AND OLD.site_name IS NOT DISTINCT FROM NEW.site_name THEN RETURN NULL; END IF;
 INSERT INTO hr_employee_changes(source,action,record_id,old_number,new_number)
  VALUES('register',TG_OP,CASE WHEN TG_OP='DELETE' THEN OLD.id::text ELSE NEW.id::text END,old_n,new_n);
 RETURN NULL;
-- Writing the list must never stop HR's own save: a change the list missed is found by the nightly match of both lists.
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END
$fn$;

-- A joined employee counts while the copy to Pulse-II serves it: ACTIVE, APPROVED or INACTIVE (left).
CREATE OR REPLACE FUNCTION hr_note_employee_change() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE old_n text := ''; new_n text := ''; served text[] := ARRAY['ACTIVE','APPROVED','INACTIVE'];
BEGIN
 IF TG_OP <> 'INSERT' AND OLD.kind = 'employees' AND OLD.status = ANY(served) THEN old_n := hr_employee_number(OLD.code); END IF;
 IF TG_OP <> 'DELETE' AND NEW.kind = 'employees' AND NEW.status = ANY(served) THEN new_n := hr_employee_number(NEW.code); END IF;
 IF old_n = '' AND new_n = '' THEN RETURN NULL; END IF;
 IF TG_OP = 'UPDATE' AND old_n = new_n AND OLD.name IS NOT DISTINCT FROM NEW.name AND OLD.status IS NOT DISTINCT FROM NEW.status
    AND OLD.data IS NOT DISTINCT FROM NEW.data THEN RETURN NULL; END IF;
 INSERT INTO hr_employee_changes(source,action,record_id,old_number,new_number)
  VALUES('joining',TG_OP,CASE WHEN TG_OP='DELETE' THEN OLD.id::text ELSE NEW.id::text END,old_n,new_n);
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END
$fn$;

-- Created once: a trigger that is already there is left alone, so a start-up never has to lock the two tables.
DO $do$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hr_register_changes' AND NOT tgisinternal) THEN
  CREATE TRIGGER hr_register_changes AFTER INSERT OR UPDATE OR DELETE ON hr_employee_master_register
   FOR EACH ROW EXECUTE FUNCTION hr_note_register_change();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hr_joined_employee_changes' AND NOT tgisinternal) THEN
  CREATE TRIGGER hr_joined_employee_changes AFTER INSERT OR UPDATE OR DELETE ON hr_records
   FOR EACH ROW EXECUTE FUNCTION hr_note_employee_change();
 END IF;
END
$do$;
