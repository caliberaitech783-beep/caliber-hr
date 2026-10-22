# HR Azure API

Deployed on 22 October 2026. The frontend remains on Hostinger at
https://hrpulse.cmll.in. The API is https://hr-api-cmll-783.azurewebsites.net.
Its readiness endpoint was verified from the live Hostinger page and by HTTPS.

## Current Azure deployment

- Resource group: `coalmine-fleet-maintenance-rg`.
- API: `hr-api-cmll-783`, sharing plan `ASP-coalminefleetmaintenancerg-b234`.
- PostgreSQL server: `coalmine-fleet-pg-783`; separate database: `hr`.
- Database login: `hr_runtime_cmll`, with no create-role/create-database privileges.
- Private network: `coalmine-fleet-prod-vnet/appsvc-integration`; PostgreSQL public
  access remains disabled. Connections validate the server's TLS certificate.
- The HR password is configured privately in the HR app's settings. It is absent
  from the frontend and repository. No other app's database credentials are used
  by the running HR API.
- Temporary access to the existing PostgreSQL administrator Key Vault secret was
  authorized only for setup. Its role assignment and bootstrap setting were
  removed and verified absent. The final deployment excludes `bootstrap.mjs`.

## Configuration in Azure App Service

Use a separate HR App Service and database when sharing an existing App Service
plan and PostgreSQL server. Do not overwrite other apps or migrate their databases.

Configure `PGHOST`, `PGDATABASE`, `PGUSER` and `FRONTEND_ORIGIN` from `.env.example`
as server-side App Service settings. Prefer the app's managed identity with access
only to the HR database. The token is acquired for each new pool connection.
Alternatively set `PGPASSWORD` privately on the server. TLS certificate validation
is always enabled. No database secrets belong in Vite environment variables.

Install dependencies from the lockfile, use Node.js 22 or later, and start with
`node index.mjs`. App Service supplies `PORT`. Set its health check path to
`/api/health`. Confirm network access and database permissions before rollout.

## Verification

- `node --test app.test.mjs security.test.mjs` tests origin restrictions, readiness,
  authentication, permissions, validation, stale versions and self-approval.
- `/api/health` checks that the API process runs.
- `/api/ready` returns HTTP 200 only after a real `SELECT 1` succeeds, or HTTP 503
  when the database is unavailable. It exposes no server names or credentials.

The local tests use an injected query function. Live verification additionally
confirmed `/api/ready` returns `{"status":"ready","database":"connected"}`
after temporary administrator access was removed.

## Functional modules

The API validates each bearer grant against the existing Caliber Pulse HR validate
endpoint. Usernames, roles and menu permissions come from that response, never
from client-supplied profile data. Passwords go directly from the login form to
Pulse, not to this API. Requests from unapproved browser origins are rejected.
Pulse's verified `login` field is the audit/approval username. Site assignments
may be a pipe-separated string (for example, `Nagpur | Chandrapur`) or an array.
Employee lists, lookups, writes, approvals, leave, reports and audit views are
filtered server-side to assigned site IDs, codes or names. Global master editing
requires an account without site restrictions; menu access is also required.
An unrestricted HR administrator must configure companies, regions, sites,
organization masters, policies, workflows and approval rules before site users
can onboard employees. No access expansion was applied to site-restricted users.

`schema.sql` creates HR-only records, approvals and audit tables idempotently at
startup. This implementation uses parameterized SQL and validated JSON records;
the older illustrative Prisma schema is not the deployed schema.

Supported records: companies, clients, regions, sites, departments, grades,
designations, shifts, holidays, leave policies, employees, approval workflows,
approval matrix rules and leave requests. Records support search, pagination,
CSV export, version-checked updates and deactivation. Employee CSV imports accept
1–500 rows, resolve reference codes, and commit atomically as drafts.

Employee and leave records save as drafts. Submission resolves the most specific
active matrix rule (site, company, global), snapshots its sequential approvers and
submitted details, and locks editing while pending. Only the current assigned
approver can decide. Requesters cannot approve their own submissions. The final
employee approval activates the record. Rejections require comments. Editing an
active employee returns it to draft and requires approval again.

Leave entitlement is measured in inclusive calendar days, including weekends and
holidays. Requests cannot span years or overlap pending/approved leave. Pending
and approved requests count toward the configured annual policy limit. Employee
row locks serialize concurrent leave submissions. This is not payroll, attendance
capture, accrual/proration, document storage, email notification or automatic
escalation. Shift management configures shift times and employee assignments.

Administration displays Pulse-controlled access. Audit entries are append-only
through the API. The dashboard and reports aggregate the real HR records.

## Deployment verification

The first functional deployment enabled `HR_VERIFY_DATABASE=true`. Before starting
the HTTP listener, `verify-database.mjs` exercised real PostgreSQL CRUD, reference
checks, two-stage approval, invalid/self approvals, leave limits/overlaps and
atomic CSV rollback. All fixtures and their audit entries were rolled back. The
API then started successfully with release `2026-10-22-modules-v1`; the flag was
removed after verification. No sample employee data is seeded on normal startup.

Deploy app.mjs, index.mjs, auth.mjs, modules.mjs, service.mjs, schema.sql,
verify-database.mjs, scope.mjs and package.json at the zip root. Never deploy bootstrap.mjs,
credentials or node_modules from a different operating system.

The final runtime uses Linux dependencies extracted from its existing Oryx
`node_modules.tar.zst` into `.hr-runtime-node-modules`, with a relative
`node_modules` symlink. This repaired a single-file OneDeploy operation that
removed the Oryx manifest. Future source-only updates should preserve that
directory/link, or use a complete successful Oryx build. Do not use single-file
OneDeploy with remote build enabled. The latest source corrections were uploaded
via authenticated Kudu VFS and the HR app restarted. Container logs confirmed the
full integration check passed after the final site-scope update.

Production verification also signed in through Pulse, imported one fictitious
employee using the live Hostinger UI, updated its name through the employee form,
and confirmed both saves survived page reloads. The named verification masters,
employee and their audit entries were removed after checking persistence. No
fictitious business records remain. Ten API tests and eight frontend tests pass.
