# Asset management

React + existing HR CSS/Lucide and XLSX; Node HTTP API and PostgreSQL. New `/api/asset-management/*` routes reuse Pulse bearer grants and site scopes. `hr_asset_register.employee_id` references the existing `hr_records` employee ID; no employee copy is created. Previous generic asset records remain accessible as Legacy imports, never converted into inventory automatically.

## Permissions
Trusted Pulse `permissions.assetRole`, or exact assignedRole/role Admin/HR/Manager/Employee is used. Existing-menu fallback: Administration => Admin; Employee Master or Master Configuration => HR; Asset Management => Manager; otherwise Employee self-view. All asset operations also enforce site access. Admin defines categories/custom fields and settings. Admin/HR create inventory and lookups. Managers move assets within their sites. Employee accounts require an explicit employee ID in their trusted Pulse profile or a unique Pulse username link configured by Admin. They can only read their own assets/clearance. The client cannot supply a role or scope.

## Data and transactions
Schema is idempotently applied on server startup. Counters use an atomic UPSERT inside the creation transaction; unique serial/tag constraints guard races. Asset row locks and version checks serialize movements. Employee locks serialize assignment with clearance checks. Movement rows have a database trigger rejecting updates/deletes. Generic CRUD endpoints cannot reach these tables. Serial is optional unless category requires it; nonblank serials are case-insensitively unique. Depreciation settings are snapshotted at purchase; fractional years use 365.25 days, five-percent floor, Lost/Disposed zero. Zero-rate seed categories were unspecified by the request and can be edited by Admin.

Vehicle fields: registration, insuranceExpiry, pucExpiry. Custom data is whitelisted/type-validated on creation. Invoice is an invoice reference, not an uploaded file. Return can move directly to repair; send-for-repair is allowed from Available (assigned assets must be returned first). Transfer changes assigned employee atomically. Disposed is terminal. Lost recoveries remain pending even if disposed; Found clears the lost obligation.

## Reminders and F&F
Startup and hourly sweeps create durable date-keyed reminders for the current India day, deduplicated across restarts/instances. Dashboard displays overdue returns and warranty/insurance/PUC expiries in the next 30 days. These are **in-app reminders**, not outbound emails. Keep Azure Always On enabled for scheduled sweeps.

`POST asset-management/fnf-check` is an auditable eligibility gate; with block_fnf=true it returns 422 for outstanding assets/recoveries. Payroll in this repository is only a placeholder; no settlement/payment operation exists to intercept. A future finalisation transaction MUST call the gate with employee locking in the same transaction. A past successful eligibility check must not be treated as permanent clearance.

Run: `node --test server/assets.test.mjs server/app.test.mjs server/security.test.mjs`. `HR_ASSET_VERIFY_DATABASE=true node server/assets.integration.mjs` (requires configured PostgreSQL credentials) runs rollback-only employee/asset fixtures; tag counter race test uses a temporary prefix and removes it afterwards.
