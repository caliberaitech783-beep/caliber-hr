# HR Pulse — Phase 1 architecture

## Stack

- React + TypeScript + Vite for a responsive, component-based portal UI.
- Node.js API layer (Phase 2) with PostgreSQL and Prisma migrations.
- Cookie-based opaque sessions; only hashed session tokens are stored. Passwords use Argon2id.
- Azure App Service or Azure Container Apps, Azure Database for PostgreSQL, Blob Storage for restricted documents, Key Vault for secrets, and Application Insights for telemetry.

The browser never connects directly to PostgreSQL. Every API request is authenticated, authorized on the server, scoped to company/region/site, validated, and audited.

## Page structure

`/login`; `/dashboard`; `/masters` with B1–B8 routes; `/employees/new`, `/employees/import`, `/employees/:id`; `/approvals`; `/shifts`; `/leave`; `/reports`; `/admin/users`, `/admin/roles`; `/audit`.

## API structure

`/api/auth/*`, `/api/me`, `/api/users`, `/api/roles`, `/api/permissions`, `/api/masters/{resource}`, `/api/employees`, `/api/imports`, `/api/workflows`, `/api/approval-rules`, `/api/approval-requests`, `/api/shifts`, `/api/holidays`, `/api/leave`, `/api/reports`, `/api/audit-logs`.

Mutations use transactions and optimistic concurrency. List endpoints use cursor pagination, server-side filters, and scope checks. Files are uploaded via short-lived signed URLs after type and size validation.

## Dependency map

1. B1 Company & Sites and B2 Department/Designation/Grade establish reference data.
2. B8 Approval Matrix establishes the shared approval resolver.
3. B3 versions onboarding workflows using B8 approver resolution.
4. B4 employee forms depend on B1, B2, B3, B6 and B8.
5. B5 validates imports against approved B1/B2 records and routes batches through B8.
6. B6 depends on sites and optionally departments.
7. B7 depends on companies, regions, sites, employee groups and B8.

## Roles and permissions

Roles are data-driven. Permissions are `(module, action)` pairs for View, Create, Edit, Submit, Approve, Reject, Import, Export, Deactivate, and Manage Configuration. `UserRole` carries optional company, region, and site scope. Backend policy checks combine permission, scope, record status, employee relationship, and separation of duties. Frontend visibility is convenience only.

## Approval engine

One engine serves all modules. Submission resolves one active non-conflicting rule, snapshots an immutable workflow version, creates sequential or parallel stage assignments, and prevents self-approval unless explicitly enabled. Decisions append to history; they never overwrite it. Rejection comments are mandatory. Delegation and escalation produce auditable assignments. Missing or overlapping rules block submission with a configuration error.

## Phase plan

- Phase 1 (this delivery): portal shell, polished login interaction, dashboard empty states, navigation, B1–B8 landing page, normalized core schema, architecture and security baseline.
- Phase 2: authenticated API, migrations/seed, user/role administration, B1/B2 CRUD, master review and audit.
- Phase 3: onboarding forms, documents, directory, profile and transactional Excel imports.
- Phase 4: approval matrix, visual workflow builder, notifications and delegation.
- Phase 5: shift, holiday and leave configuration and employee transactions.
- Phase 6: reports, automated authorization/workflow/security tests and Azure deployment assets.

## Decisions requiring CMLL confirmation

- Exact eight grade codes/ranks; employee-number format; authoritative role holders and self-approval exceptions.
- Password/SSO/MFA policy and Azure Entra ID preference; session duration and lockout policy.
- Site types, employment categories, joining types, mandatory statutory/mining documents and retention periods.
- Workflow stages, escalation SLAs/delegation policy; approved leave entitlements, accrual, carry-forward and encashment rules.
- Import template columns/update authority; document size/types; audit retention; data residency, backup RPO/RTO.
- Original “Pulse” brand assets/screenshots if pixel-identical reproduction is required.

## RFQ note

No RFQ workbook was supplied in this workspace. The master prompt is therefore the only business source used, and no unapproved policies or master values are seeded.
