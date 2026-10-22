CREATE TABLE IF NOT EXISTS hr_records (
 id uuid PRIMARY KEY, kind text NOT NULL, code text NOT NULL, name text NOT NULL,
 data jsonb NOT NULL, status text NOT NULL, version integer NOT NULL DEFAULT 1,
 created_by text NOT NULL, updated_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,code)
);
CREATE INDEX IF NOT EXISTS hr_records_kind_status ON hr_records(kind,status);
CREATE TABLE IF NOT EXISTS hr_approvals (
 id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES hr_records(id),
 approvers jsonb NOT NULL, record_snapshot jsonb NOT NULL, stage integer NOT NULL DEFAULT 0, state text NOT NULL DEFAULT 'PENDING',
 requested_by text NOT NULL, history jsonb NOT NULL DEFAULT '[]',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_one_pending_approval ON hr_approvals(record_id) WHERE state='PENDING';
CREATE TABLE IF NOT EXISTS hr_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL,
 action text NOT NULL, kind text NOT NULL, record_id uuid,
 detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
