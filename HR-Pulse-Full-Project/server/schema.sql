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

ALTER TABLE hr_approvals ADD COLUMN IF NOT EXISTS approval_steps jsonb;

-- Organization masters used by the employee joining form. These inserts are
-- idempotent so an existing administrator-managed record is never overwritten.
INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by)
SELECT '10000000-0000-4000-8000-000000000001','companies','CMLL','Caliber Mining & Logistics','{"code":"CMLL","name":"Caliber Mining & Logistics","address":"","email":""}','ACTIVE','system','system'
WHERE NOT EXISTS (SELECT 1 FROM hr_records WHERE kind='companies' AND status='ACTIVE');

INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES
 ('10000000-0000-4000-8000-000000000002','regions','CO-HO','Corporate / HO','{"code":"CO-HO","name":"Corporate / HO","state":"Maharashtra"}','ACTIVE','system','system'),
 ('10000000-0000-4000-8000-000000000003','regions','WCL','WCL','{"code":"WCL","name":"WCL","state":"Maharashtra"}','ACTIVE','system','system'),
 ('10000000-0000-4000-8000-000000000004','regions','NCL','NCL','{"code":"NCL","name":"NCL","state":"Madhya Pradesh / Uttar Pradesh"}','ACTIVE','system','system')
ON CONFLICT(kind,code) DO NOTHING;

INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by)
SELECT source.id::uuid,'sites',source.code,source.name,
 jsonb_build_object('code',source.code,'name',source.name,'companyId',company.id::text,'clientId','','regionId',region.id::text,'state',source.state,'district','','address','','siteType',source.site_type),
 'ACTIVE','system','system'
FROM (VALUES
 ('20000000-0000-4000-8000-000000000001','CMLL-CORP','Corporate','CO-HO','Maharashtra','Office'),
 ('20000000-0000-4000-8000-000000000002','CMLL-HO','HO','CO-HO','Maharashtra','Office'),
 ('20000000-0000-4000-8000-000000000003','KSR','KSR FREIGHT CARRIERS','CO-HO','Maharashtra','Office'),
 ('20000000-0000-4000-8000-000000000004','CHADDA','CHADDA TRADING CO.','CO-HO','Maharashtra','Office'),
 ('20000000-0000-4000-8000-000000000005','NCL-JAYANT','Jayant OB','NCL','Madhya Pradesh / Uttar Pradesh','Mine'),
 ('20000000-0000-4000-8000-000000000006','NCL-DUDW','Dudichua OB west','NCL','Madhya Pradesh / Uttar Pradesh','Mine'),
 ('20000000-0000-4000-8000-000000000007','NCL-DUDE','Dudichua OB East','NCL','Madhya Pradesh / Uttar Pradesh','Mine'),
 ('20000000-0000-4000-8000-000000000008','WCL-SASTI','Sasti OB','WCL','Maharashtra','Mine'),
 ('20000000-0000-4000-8000-000000000009','WCL-DHOPTALA','Dhoptala OB','WCL','Maharashtra','Mine'),
 ('20000000-0000-4000-8000-000000000010','WCL-MAJRI','Majri OB','WCL','Maharashtra','Mine'),
 ('20000000-0000-4000-8000-000000000011','WCL-GAURI','Gauri Pauni OB','WCL','Maharashtra','Mine'),
 ('20000000-0000-4000-8000-000000000012','CMPL-SCR-JV','CMPL SCR JV','WCL','Maharashtra','Project')
) AS source(id,code,name,region_code,state,site_type)
CROSS JOIN (SELECT id FROM hr_records WHERE kind='companies' AND status='ACTIVE' ORDER BY created_at LIMIT 1) company
JOIN hr_records region ON region.kind='regions' AND region.code=source.region_code AND region.status='ACTIVE'
ON CONFLICT(kind,code) DO NOTHING;
