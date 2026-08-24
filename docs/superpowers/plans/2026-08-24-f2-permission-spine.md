# F2 Permission Spine Implementation Plan

**Ticket:** F2 — Permission spine, audit log and first admin screen (Module Configuration)

**Goal:** Establish one explicit shared RBAC and audit foundation, then prove it through an authenticated Module Configuration screen and API.

**Dependencies:** None. F1 is already committed at `5dbcfac` and its public Piso CAMP configuration endpoint must remain unchanged.

## Global constraints

- Work locally on the current branch with no new branch, worktree, push, or pull request.
- Do not commit until every F2 acceptance criterion and validation gate passes; produce one local F2 commit.
- Follow strict TDD: add each behavior test first, run it, and confirm the expected failure before production code.
- Reuse `roles`, `permissions`, `user_roles`, `role_permissions`, `RbacService`, `RbacGuard`, `AuditService`, F1's `PisoCampModule`, the dashboard shell, and shared UI components.
- Reuse physical `audit_log` as the logical `audit_entry`; do not add parallel RBAC or audit tables.
- Do not modify Better Auth-owned `users`, `sessions`, `accounts`, or `verifications` table shapes.
- Preserve F1's anonymous `GET /api/v1/pisocamp/config` response as the strict three-key public schema.
- All authorization comes from explicit permission rows. The legacy `Admin` role remains protected for grant/removal invariants but is no longer an implicit authorization bypass.
- `reports.pii.view` receives no seed-role assignment.
- `session_inactivity_minutes` is an integer from 1 through 1,440 and defaults to 30.
- Admin configuration requests are online-only and never persisted to IndexedDB.
- All inputs are contract-validated; privileged handlers obtain actor identity from the Better Auth session.
- The admin PUT is strictly throttled and idempotent. Its mutation and success audit row commit atomically.
- Permission denials are awaited and persisted before returning 403.
- A deactivated account returns 401 before any RBAC permission lookup.
- Application code has no barrel files or standalone type-only files.

## Task 1: Implement and prove F2 end to end

### 1. Contracts and catalog — RED then GREEN

Create or extend focused tests in `packages/contracts/src/modules/v1/pisocamp/pisocamp.schema.test.ts` and the RBAC catalog tests. Prove:

- admin configuration accepts integers 1 and 1,440 and the default value 30;
- zero, 1,441, fractions, missing keys, and unknown keys are rejected;
- F1's public schema rejects admin fields;
- `System Administrator` and `admin.config.manage` are catalog values;
- all Domain Model dot-form permissions exist.

Run the focused tests and record the expected RED caused by missing F2 schemas/catalog values. Then:

- extend `pisocamp.schema.ts` with strict read/update admin configuration schemas and inferred types;
- extend `pisocamp.contract.ts` with `GET` and `PUT /admin/pisocamp/config`;
- export the new public types/schemas from the contracts package registry;
- expand the shared role/permission catalog with the six Annex H roles and every permission key in `docs/DOMAIN-MODEL.md`;
- retain legacy roles/permissions for compatibility.

### 2. Database schema, migration, and seed — RED then GREEN

Add behavior tests that prove the seed maps `System Administrator` to `admin.config.manage`, leaves `reports.pii.view` unassigned, gives legacy Admin explicit legacy permissions, and defines the default configuration. Confirm RED before implementation.

Extend `packages/db/src/schema.ts` with:

- `module_configuration(key text PK, value jsonb not null, updated_by nullable FK users, created_at, updated_at)`;
- `pisocamp_account_state(account_id text PK/FK users, status active|deactivated, reason nullable, updated_by nullable FK users, created_at, updated_at)`;
- relations and both tables in the exported Drizzle schema object.

Update `packages/db/src/seed.ts` idempotently with:

- all six Annex H roles;
- explicit role-permission mappings;
- explicit legacy Admin mappings;
- System Administrator for the seed admin;
- `session_inactivity_minutes = 30` without overwriting an existing value.

Generate one additive migration and augment its data SQL idempotently to:

- create both tables;
- insert catalog roles/permissions/mappings;
- materialize legacy Admin permissions before removing the bypass;
- grant System Administrator to existing Admin holders;
- insert the default module configuration without overwriting existing configuration.

Smoke-test the migration against a disposable PostgreSQL database and verify reapplication/seed idempotency.

### 3. Shared authorization and audit — RED then GREEN

Extend backend tests first to prove:

- resolved System Administrator access contains `admin.config.manage`;
- legacy Admin access is derived from explicit rows, not role-name bypass;
- repeated permission checks in one request reuse one resolved permission promise;
- unauthenticated protected request returns 401;
- deactivated protected request returns 401 and never calls `RbacService`;
- active unauthorized request returns 403 and persists one `permission_denied` audit row before rejection;
- an audit-write failure does not accidentally authorize the request.

Then:

- add a shared `AccountAccessService` that treats a missing state row as active;
- make RBAC resolution request-scoped with a per-user promise memo while retaining Redis as shared L2 cache and existing invalidation;
- remove backend and web legacy Admin authorization shortcuts;
- check account state in the global `RbacGuard` after session resolution and before permission resolution;
- inject `AuditService` into the guard and persist structured denial entries with actor, handler target, required/missing permissions, outcome `denied`, and action `permission_denied`;
- retain structured warning logs without secrets.

### 4. Module configuration backend — RED then GREEN

Add service/controller tests before implementation proving:

- GET returns the stored/default value;
- authorized PUT persists the value and its before/after audit row atomically;
- forced audit failure rolls back the configuration update;
- GET and PUT require `admin.config.manage`;
- PUT has strict throttle and idempotency metadata/interceptor;
- F1 public endpoint remains anonymous and strict.

Extend the existing Piso CAMP module rather than creating a parallel module:

- add a focused admin configuration service using a key registry limited to `session_inactivity_minutes`;
- use one database transaction for `SELECT ... FOR UPDATE`, update, and `AuditService.record`;
- use audit domain `pisocamp`, action `module_configuration.update`, target type `module_configuration`, and target id `session_inactivity_minutes`;
- add protected controller handlers for the two admin contract procedures;
- derive actor id from `@Session()`.

### 5. Shared browser oRPC client and web screen — RED then GREEN

Create web tests first proving:

- oRPC requests include credentials and use the versioned backend URL;
- the `pisocamp` oRPC query root is excluded from IndexedDB persistence;
- navigation and direct route access require `admin.config.manage`;
- loading, fetch error, loaded form, client validation, pending save, successful save, and failed save are accessible and visible;
- keyboard submission works, the input has a programmatic label and described error, and no role/audit management UI appears.

Then:

- add the shared browser oRPC client under `apps/web/services/orpc/` using `OpenAPILink` and `createTanstackQueryUtils`;
- create `features/pisocamp-admin/api/pisocamp-config.hooks.ts` with oRPC query/mutation options and namespace invalidation;
- add `pisocamp` to non-persisted query roots;
- add a thin server-gated `app/(site)/pisocamp/config/page.tsx`;
- create the client `ModuleConfigurationView` using existing PageHeader, Card, Label, Input, Button, Alert/Skeleton, and toast components;
- add the permission-filtered navigation item and route title;
- handle 401/403 and general fetch errors without leaking internals.

### 6. Verification and evidence

Run focused and touched-package validation first, then broader checks:

- contracts, database, backend, and web focused tests;
- contracts/db/backend/web typechecks;
- targeted lint for all touched TypeScript/TSX;
- backend and web production builds;
- workspace dependency check and `git diff --check`.

Run live acceptance against migrated local PostgreSQL and the actual applications:

1. System Administrator GET returns 200 and PUT persists the chosen value.
2. The success audit contains actor, key, literal before/after values, and timestamp.
3. A signed-in user without the permission receives 403 and a persisted `permission_denied` row.
4. A valid deactivated session receives 401 before permission lookup on both the new endpoint and an existing admin endpoint.
5. Repeating PUT with one idempotency key causes one effective change and one success audit entry.
6. Anonymous F1 GET remains 200 with exactly its three public keys.
7. Exercise the Module Configuration screen in a browser at desktop and mobile widths; verify keyboard/focus, label/error semantics, no horizontal overflow, and clean browser console/network and backend logs.

Write F2 acceptance evidence under `docs/pisocamp/`, including commands, identities/permissions used, database queries/results, runtime request results, UI evidence, and any unrelated pre-existing warnings clearly separated from F2.

Only after every gate passes: stage all F2 files and create exactly one local commit named `F2: establish permission spine and module configuration`.
