# CM-1 Draft Content Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a permitted Content Administrator create, list, read, and edit validated draft Piso CAMP content while preserving immutable version history, atomic audit/idempotency, and future CM-3/CM-4 lifecycle semantics.

**Architecture:** `content_item` owns stable identity and lifecycle pointers; every create/edit appends an immutable `content_version`, with version-scoped immutable `related_link` rows. Strict oRPC discriminated unions define type-specific fields, Nest services join F2's active-account/RBAC/audit/idempotency transaction spine, and Next.js pages consume the typed API through TanStack Query. Controlled BSP series/denominations are additive reference data sourced from official BSP publications.

**Tech Stack:** TypeScript 5.9, Zod 4, oRPC 1.13, NestJS 11, Drizzle ORM 1/PostgreSQL, Next.js 16/React 19, TanStack Query 5, shadcn/Tailwind 4, Vitest/Jest/Testing Library/Playwright.

**Spec:** `docs/TICKETS.md` CM-1; `docs/DOMAIN-MODEL.md` sections 2, 4a, and 5; `docs/PRD.md` constraints and decisions.

## Global Constraints

- Dependencies F2, F3, and F4 are already locally committed; CM-1 may reuse but must not duplicate or bypass their Better Auth, active-account, RBAC, audit, idempotency, transaction, logging, and UI access helpers.
- Permission is exactly `content.items.edit`; a missing permission returns 403 and writes the existing awaited `permission_denied` audit. A deactivated account returns 401 before permission or idempotent replay.
- CM-1 is foundational. Do not commit task slices. Make one local commit only after all acceptance criteria, live browser/API checks, independent review, and user review pass: `CM-1: add draft content foundation`.
- Work locally in the existing `dev` checkout because the user forbids branch creation, worktree branches, pushes, pull requests, and remote side effects.
- Use strict TDD: every behavior begins with an observed RED failure, then minimal GREEN implementation, then refactor while green. Record commands and RED/GREEN outcomes in the ignored SDD report.
- `content_item` owns lifecycle status and version mechanics. Reserve exactly `draft`, `submitted_for_review`, `approved`, `published`, `unpublished`, `deactivated`, and `archived`; CM-1 may create/edit only `draft`.
- Every successful create/edit appends a new immutable `content_version`; editing never overwrites an old version. `related_link` rows are version-scoped and immutable.
- Store timestamps in UTC and serialize ISO-8601 UTC. Render administration dates in Asia/Manila.
- Migrations are additive. Generate one CM-1 migration, verify fresh apply and reapply, and add SQL-level immutability and ownership constraints not expressible by Drizzle.
- Server derives actor/editor IDs from the verified Better Auth session. No request accepts account ID, editor ID, status, version ID, audit body, or publication state.
- Mutations require a client UUID `requestId` and identical `Idempotency-Key`; idempotency is identity-scoped, concurrent-safe, guard-before-replay, and persisted in the same transaction as content and audit.
- Audits contain item/version IDs, version number, content type, and changed field names only. Never write content body, link URLs, cookies, session material, or credentials to audits/logs.
- Strings are trimmed, plain text, and bounded. Arbitrary HTML is neither accepted nor rendered. Unknown contract keys are rejected.
- Application files use direct imports, kebab-case TypeScript names, co-located types, and no app barrel files.
- Admin authoring is online-only. Authenticated Piso CAMP content queries must not enter persisted browser/PWA caches.

## Frozen CM-1 Interfaces

### Content types and required fields

```ts
type CurrencyDraft = {
	contentType: "banknote" | "coin" | "security_feature"
	title: string // trimmed, 1..160
	summary: string // trimmed, 1..500
	body: string // trimmed, 1..10_000, plain text
	seriesCode: string
	denominationCode: string
}

type AdvisoryDraft = {
	contentType: "advisory"
	title: string
	summary: string
	body: string
}

type LinkDraft = {
	contentType: "link"
	title: string
	summary: string
	body?: string // trimmed, at most 10_000
	primaryUrl: string // HTTPS only, at most 2_048
}
```

Currency fields and `primaryUrl` are omitted, not nullable, from variants where forbidden. `security_feature` is denomination-specific in CM-1; CE-3 may later add a version-scoped `feature_level` field without changing workflow semantics.

### Related links

```ts
type RelatedLinkInput =
	| { kind: "external"; label: string; url: string }
	| { kind: "internal"; label: string; route: string }
	| { kind: "topic"; label: string; targetContentItemId: string }
```

Each request accepts at most ten links. Labels are trimmed 1..100. External URLs are HTTPS and at most 2,048 characters. Internal routes are bounded absolute app paths matching the approved route-key syntax; topic targets are UUIDs of existing content items. Update rejects a self-referencing topic link.

### Routes

```text
GET  /api/v1/admin/pisocamp/content
GET  /api/v1/admin/pisocamp/content/{itemId}
POST /api/v1/admin/pisocamp/content
PUT  /api/v1/admin/pisocamp/content/{itemId}
```

Create input is `{ requestId, content, relatedLinks }`. Update input is `{ itemId, requestId, expectedVersionNo, content, relatedLinks }`. List input supports `page` (default 1), `limit` (default 20, max 100), and optional `contentType`, `status`, `seriesCode`, `denominationCode`, and trimmed `search`. List output is `{ items, page, limit, total }`; detail includes the current version, related links, creator, last editor, `createdAt`, and `dateModified`.

### Controlled catalog

Use stable lowercase codes and integer minor-unit values. Seed these exact, source-backed series:

| Series code       | Kind     | Denominations                      |
| ----------------- | -------- | ---------------------------------- |
| `fpp-banknotes`   | banknote | PHP 50, 100, 500, 1000             |
| `engc-banknotes`  | banknote | PHP 50, 100, 200, 500, 1000        |
| `ngc-banknotes`   | banknote | PHP 20, 50, 100, 200, 500, 1000    |
| `ngc-coins`       | coin     | 1, 5, 25 sentimo; PHP 1, 5, 10, 20 |
| `bsp-coin-series` | coin     | 1, 5, 10, 25 sentimo; PHP 1, 5, 10 |

Official sources are the BSP Polymer Banknotes page, Enhanced NGC flyer, NGC Banknotes page, NGC Coins FAQ, and BSP Coin Series page. Use codes such as `php-50` and `sentimo-25`; the composite `(series_code, denomination_code)` is the identity.

---

### Task 1: Strict contract and route surface

**Files:**

- Create: `packages/contracts/src/modules/v1/pisocamp/content.schema.ts`
- Create: `packages/contracts/src/modules/v1/pisocamp/content.schema.test.ts`
- Create: `packages/contracts/src/modules/v1/pisocamp/content.contract.ts`
- Create: `packages/contracts/src/modules/v1/pisocamp/content.contract.test.ts`
- Modify: `packages/contracts/src/modules/v1/pisocamp/pisocamp.contract.ts`
- Modify: `packages/contracts/src/modules/v1/pisocamp/pisocamp.contract.test.ts` only for composed-router regression coverage.
- Modify: `packages/contracts/src/contracts.ts`

**Interfaces:**

- Consumes: existing `pisoCampContract`, Zod strict-object conventions, `v1.pisocamp.admin` route composition.
- Produces: exported content/status/type/catalog/input/output schemas and `pisoCampContract.admin.content.{list,get,create,update}`.

- [ ] **Step 1: Write schema RED tests**

Add table-driven tests proving each valid variant parses and proving failure for: missing series/denomination on all three currency variants; mismatched forbidden currency fields on advisory/link; non-HTTPS `primaryUrl`; blank/overlong title, summary, body, and link label; more than ten links; malformed internal UUID; unknown keys; client-provided status/editor/version fields; invalid page/limit; contradictory detail output.

```ts
const validBanknote = {
	requestId: "8bdc754e-3d04-4eab-b98c-523f378ac1e4",
	content: {
		contentType: "banknote" as const,
		title: "20-Piso New Generation Currency Banknote",
		summary: "Approved educational summary",
		body: "Approved plain-text description.",
		seriesCode: "ngc-banknotes",
		denominationCode: "php-20",
	},
	relatedLinks: [],
}

expect(CreatePisoCampContentInputSchema.parse(validBanknote)).toEqual(validBanknote)
expect(() =>
	CreatePisoCampContentInputSchema.parse({
		...validBanknote,
		content: { ...validBanknote.content, denominationCode: undefined },
	})
).toThrow()
```

- [ ] **Step 2: Run schema RED**

Run: `pnpm.cmd --filter @repo/contracts exec vitest run src/modules/v1/pisocamp/content.schema.test.ts`

Expected: FAIL because the CM-1 schemas do not exist.

- [ ] **Step 3: Implement strict schemas**

Define `.strict()` schemas for the lifecycle/type enums, controlled-series output, discriminated content and related-link unions, create/update inputs, list filters/output, summary, editor identity, and current-version detail. Use a shared trimming helper implemented with `z.string().trim()` and explicit min/max messages. Export the public schemas and inferred types through `packages/contracts/src/contracts.ts`. Do not use `.passthrough()`, coercive booleans, client actor fields, or HTML-bearing fields.

- [ ] **Step 4: Run schema GREEN**

Run: `pnpm.cmd --filter @repo/contracts exec vitest run src/modules/v1/pisocamp/content.schema.test.ts`

Expected: all focused schema tests pass.

- [ ] **Step 5: Write and observe route RED**

Assert exact methods/paths and the composed `/v1/admin/pisocamp/content` surface for list/detail/create/update. Parse representative inputs/outputs through the route schemas.

Run: `pnpm.cmd --filter @repo/contracts exec vitest run src/modules/v1/pisocamp/content.contract.test.ts src/modules/v1/pisocamp/pisocamp.contract.test.ts`

Expected: FAIL because `admin.content` is not registered.

- [ ] **Step 6: Register routes and run contract GREEN**

Implement the four routes with summaries/tags and run:

```powershell
pnpm.cmd --filter @repo/contracts test
pnpm.cmd --filter @repo/contracts typecheck
```

Expected: all contract tests and typecheck pass with no warnings from touched code.

### Task 2: Additive relational aggregate, constraints, and catalog

**Files:**

- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/schema.spec.ts`
- Create: `packages/db/src/pisocamp-currency-catalog.ts`
- Create: `packages/db/src/pisocamp-currency-catalog.spec.ts`
- Modify: `packages/db/src/seed.ts`
- Modify: `packages/db/src/seed-catalog.ts`
- Modify: `packages/db/src/seed-catalog.spec.ts`
- Create: the single Drizzle-generated `cm1_content_foundation` migration directory under `packages/db/src/migrations/`
- Create: `packages/db/src/content-migration.spec.ts`

**Interfaces:**

- Consumes: `users`, `auditLog`, additive migration pattern, guarded/idempotent seed helpers.
- Produces: `pisoCampCurrencySeries`, `pisoCampCurrencyDenominations`, `contentItems`, `contentVersions`, `relatedLinks` and their schema registrations.

- [ ] **Step 1: Write schema/catalog RED**

Assert exported tables/columns, exact seven-state and five-type vocabularies, five series, 29 composite denomination rows, stable codes, media-kind pairing, official HTTPS source URLs, and no duplicate composite keys.

Run: `pnpm.cmd --filter @repo/db test -- schema.spec.ts pisocamp-currency-catalog.spec.ts seed-catalog.spec.ts`

Expected: FAIL because the aggregate and catalog do not exist.

- [ ] **Step 2: Define tables and catalog GREEN**

Add:

```ts
export const pisoCampCurrencySeries = createTable("piso_camp_currency_series", t => ({
	code: t.text("code").primaryKey(),
	name: t.text("name").notNull(),
	mediaKind: t.text("media_kind").notNull().$type<"banknote" | "coin">(),
	sourceUrl: t.text("source_url").notNull(),
	catalogVersion: t.text("catalog_version").notNull(),
}))
```

Define denominations with composite PK `(seriesCode, code)`, integer `minorUnitValue`, label and `sortOrder`. Define content items with immutable type, lifecycle status, current working/published pointers, creator/editor/timestamps. Define versions with `(itemId, versionNo)` uniqueness, lineage/revision/status/type snapshots, bounded common fields, currency reference, primary URL, creator/time and reserved approval/publication fields. Define version-scoped links with position uniqueness and an exact three-way target rule: external uses `external_url`; internal uses `internal_route`; topic uses `target_content_item_id`; all other target columns are null.

Register tables in `defineRelations` and `schema`. Implement an exact read-only catalog constant and seed through existing guarded helpers.

Run the focused command until GREEN.

- [ ] **Step 3: Generate the migration and write migration RED assertions**

Run: `pnpm.cmd --filter @repo/db db:generate --name cm1_content_foundation`

Add PostgreSQL-backed tests that migrate a disposable DB and assert:

- fresh apply and supported reapply succeed;
- 5 series and 29 denominations are present exactly once;
- every status/type/media-kind/check constraint rejects invalid values;
- series/type mismatches and unknown denomination pairs reject;
- item pointers cannot reference another item's version;
- version numbers are unique per item;
- related links enforce the three-way target rule, kind/target agreement, ordering uniqueness, route syntax, and topic target FKs;
- update/delete on `content_version` or `related_link` raises an immutability exception;
- deleting referenced users/items/catalog rows cannot erase governed content.

Run: `pnpm.cmd --filter @repo/db test -- content-migration.spec.ts`

Expected RED: generated SQL lacks the custom composite pointer and immutability enforcement.

- [ ] **Step 4: Add SQL-level enforcement and run migration GREEN**

Patch only the generated migration and matching snapshot metadata as needed. Add `content_version_immutable()` and `related_link_immutable()` triggers; composite ownership/type/catalog FKs; lifecycle/type/URL/text checks; and lookup indexes for list/search/audit use. No destructive alteration of F1-F4 tables.

Run:

```powershell
pnpm.cmd --filter @repo/db test
pnpm.cmd --filter @repo/db typecheck
```

Expected: all DB tests pass against real PostgreSQL, with explicit local skips only when the established test harness proves PostgreSQL unavailable.

### Task 3: Generalize mandatory idempotency through route metadata

**Files:**

- Create: `apps/backend/src/shared/decorators/require-idempotency.decorator.ts`
- Create: `apps/backend/src/shared/decorators/require-idempotency.decorator.spec.ts`
- Modify: `apps/backend/src/shared/interceptors/idempotency.interceptor.ts`
- Modify: `apps/backend/src/shared/interceptors/idempotency.spec.ts`
- Modify: `apps/backend/src/modules/v1/pisocamp/pisocamp.controller.ts`
- Modify: `apps/backend/src/modules/v1/pisocamp/pisocamp-profile.controller.ts`
- Modify: existing F3/F4 idempotency specs only where needed to assert metadata-backed parity.

**Interfaces:**

- Consumes: F2 transaction-scoped interceptor and active-account ordering.
- Produces: `@RequireIdempotency({ requestIdField, requireActiveAccount })`, removing hard-coded consent/profile path detection.

- [ ] **Step 1: Write metadata RED**

Prove a decorated arbitrary oRPC mutation requires the header, rejects malformed/mismatched UUIDs, replays only for the same verified actor, checks deactivation before replay when configured, and joins the existing transaction. Prove an undecorated mutation retains optional idempotency behavior.

Run: `pnpm.cmd --filter @repo/backend test --runInBand --testPathPatterns=idempotency.spec.ts`

Expected: FAIL because route metadata is absent and behavior is path-hardcoded.

- [ ] **Step 2: Implement metadata GREEN**

Use Nest `SetMetadata` and `Reflector.getAllAndOverride` with this co-located runtime/type shape:

```ts
export const IDEMPOTENCY_REQUIREMENT_KEY = "idempotency.requirement"
export interface IdempotencyRequirement {
	requestIdField: "id" | "requestId"
	requireActiveAccount: boolean
}
```

Decorate consent/profile with `requestIdField: "id"`; decorate later CM-1 mutations with `requestIdField: "requestId"`. Delete path comparisons from the interceptor. Keep guard-before-replay and existing anonymous guest scoping unchanged.

Run focused idempotency, consent, profile, and controller suites until GREEN.

### Task 4: Atomic content service and controllers

**Files:**

- Create: `apps/backend/src/modules/v1/pisocamp/content/content.service.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/content/content.service.spec.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/content/content.controller.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/content/content.controller.spec.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/content/content.idempotency.spec.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/content/content.module.ts`
- Modify: `apps/backend/src/modules/v1/pisocamp/pisocamp.module.ts`

**Interfaces:**

- Consumes: Task 1 contracts, Task 2 tables, Task 3 idempotency decorator, `databaseTransactionContext`, `AuditService`, `@RequirePermissions`.
- Produces: composed Nest handlers for all four admin content routes.

- [ ] **Step 1: Write service RED**

Use PostgreSQL-backed tests where transaction/locking/integrity matters. Prove:

- create generates server item/version/link UUIDs, status `draft`, version 1, current pointer, creator/editor metadata and bounded `content.create` audit atomically;
- each edit locks the item, requires `draft`, validates the controlled denomination/type, appends version N+1, replaces current version links by new immutable rows, updates editor/date, and writes one `content.edit` audit with changed field names;
- earlier versions/links remain byte-for-byte unchanged;
- stale `expectedVersionNo` returns `ORPCError("CONFLICT")` without rows/audit;
- non-draft edit returns conflict;
- unknown/mismatched series/denomination and missing link target return understandable bad-request errors;
- audit insertion failure rolls back content; idempotency persistence failure rolls back item/version/links/audit;
- list/detail return only response-schema fields, use deterministic ordering, filtering, total count, and no email/body in summaries.

Run: `pnpm.cmd --filter @repo/backend test --runInBand --testPathPatterns=content.service.spec.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 2: Implement minimal service GREEN**

Implement one focused service. All mutations run through `databaseTransactionContext.transaction`. Use `SELECT ... FOR UPDATE` for edit, `ORPCError` inside oRPC paths, parameterized Drizzle queries, and a private mapper/validator co-located in the service. Compare old/new normalized values to produce changed-field names; never persist client status or actor identifiers.

Run service tests until GREEN.

- [ ] **Step 3: Write controller/security RED**

Prove all four handlers carry `@RequirePermissions("content.items.edit")`; mutations also carry `@StrictThrottle`, `@RequireIdempotency({ requestIdField: "requestId", requireActiveAccount: true })`, and `@UseInterceptors(IdempotencyInterceptor)`. Exercise the real composed `/v1` procedures so unauthenticated is 401, missing permission is 403 plus one denial audit, permitted create/list/get/edit succeeds, deactivated replay is 401, and missing/mismatched keys are 400.

Run focused controller/idempotency specs and observe RED.

- [ ] **Step 4: Implement controller/module GREEN**

Controller methods derive `session.user.id`, pass only parsed contract input, and translate service errors to typed oRPC errors without leaking database details. Register controller/service/providers in a focused `ContentModule` and import it into `PisoCampModule`; reuse `RbacModule`, `AuditService`, and the shared interceptor.

Run:

```powershell
pnpm.cmd --filter @repo/backend test --runInBand --testPathPatterns=content
pnpm.cmd --filter @repo/backend typecheck
pnpm.cmd --filter @repo/backend build
```

Expected: all focused tests, typecheck, and build pass.

### Task 5: Typed web data/access boundary and routes

**Files:**

- Modify: `apps/web/services/orpc/client.ts`
- Modify: `apps/web/services/orpc/client.test.ts`
- Modify: `apps/web/services/tanstack-query/query-client.test.ts`
- Create: `apps/web/features/pisocamp-content-admin/api/content.hooks.ts`
- Create: `apps/web/features/pisocamp-content-admin/api/content.hooks.test.tsx`
- Modify: `apps/web/features/dashboard/lib/nav-items.ts`
- Modify: `apps/web/features/dashboard/lib/access.test.ts`
- Create: `apps/web/app/(site)/pisocamp/content/page.tsx`
- Create: `apps/web/app/(site)/pisocamp/content/page.test.tsx`
- Create: `apps/web/app/(site)/pisocamp/content/new/page.tsx`
- Create: `apps/web/app/(site)/pisocamp/content/new/page.test.tsx`
- Create: `apps/web/app/(site)/pisocamp/content/[itemId]/edit/page.tsx`
- Create: `apps/web/app/(site)/pisocamp/content/[itemId]/edit/page.test.tsx`

**Interfaces:**

- Consumes: Task 1 typed routes and existing `getAccess`/`canAccess`/sidebar patterns.
- Produces: online-only queries/mutations, typed dynamic headers, and server permission gates for all pages.

- [ ] **Step 1: Write client/header RED**

Prove the oRPC link can inject per-call headers from typed client context while retaining `credentials: "include"`. Prove content create/update mutation functions send `Idempotency-Key === requestId`, use the typed contract client, are `networkMode: "online"`, and invalidate `orpc.pisocamp.admin.content.key()` after success. Add an explicit regression proving CM-1 content query data is excluded from the persisted browser/PWA query cache.

Run focused client/hook tests and observe RED.

- [ ] **Step 2: Implement hooks GREEN**

Extend `OpenAPILink` with an optional header context and export the typed contract client alongside query utils. In mutation functions, call the typed client with:

```ts
{
	context: { headers: { "Idempotency-Key": input.requestId } },
}
```

Generate `requestId` once at submit time; retries reuse the same variables. Do not use raw `fetch` for CM-1 endpoints or offline-persist these authoring mutations.

- [ ] **Step 3: Write page/nav access RED**

Prove the sidebar item and each route require exactly `content.items.edit`; permitted access renders the feature view; missing/error access redirects to `/dashboard`; route titles resolve for nested new/edit pages.

Run focused page/access tests and observe RED.

- [ ] **Step 4: Implement thin routes/access GREEN**

Add a `Content` administration navigation item and routing-only pages with metadata. Pages call `getAccess` and redirect on failure before rendering feature components. Do not place form/query logic in `app/`.

### Task 6: Accessible list and dynamic draft form

**Files:**

- Create: `apps/web/features/pisocamp-content-admin/components/content-list-view.tsx`
- Create: `apps/web/features/pisocamp-content-admin/components/content-list-view.test.tsx`
- Create: `apps/web/features/pisocamp-content-admin/components/content-form-view.tsx`
- Create: `apps/web/features/pisocamp-content-admin/components/content-form-view.test.tsx`
- Create: `apps/web/features/pisocamp-content-admin/components/content-type-fields.tsx`
- Create: `apps/web/features/pisocamp-content-admin/components/related-links-editor.tsx`
- Create: `apps/web/features/pisocamp-content-admin/lib/content-form.ts`
- Create: `apps/web/features/pisocamp-content-admin/lib/content-form.test.ts`

**Interfaces:**

- Consumes: Task 1 schemas/types and Task 5 hooks/routes.
- Produces: list/empty/error/loading states and create/edit forms satisfying every CM-1 UI acceptance branch.

- [ ] **Step 1: Write form-model RED**

Test normalization, type switching, series-to-denomination filtering, required/forbidden fields, link union validation, immutable edit request construction with `expectedVersionNo`, and stable retry UUID. Reuse contract schemas as the final client validator; do not reimplement divergent business rules.

Run focused form-model tests and observe RED, then implement the minimal co-located helpers and run GREEN.

- [ ] **Step 2: Write list/form widget RED**

Prove:

- skeleton, retryable load error, empty state, populated rows, filters, creator/editor/date/status display;
- create and edit happy paths navigate/refetch and visibly announce success;
- all five content types show only applicable fields and understandable required-field messages;
- series filters denomination options and changing series clears an invalid denomination;
- related links can be added/removed/reordered with labelled keyboard-operable controls;
- first invalid field receives focus, inserted errors use `role="alert"`, save state is announced, and double submit is disabled;
- server 409 renders a conflict alert with reload action and never overwrites newer data;
- dirty navigation/reload receives a confirmation;
- 320px viewport and 200% text do not cause horizontal overflow.

Run: `pnpm.cmd --filter @repo/web test -- content-list-view.test.tsx content-form-view.test.tsx content-form.test.ts`

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement components GREEN**

Use existing `PageHeader`, `Alert`, `Button`, `Card`, `Field`/`Label`, `Input`, `Textarea`, `Select`, `Table`, `Skeleton`, and theme tokens. Use semantic headings/fieldsets and native form submission. Keep the list responsive by switching to stacked cards at narrow widths rather than forcing a wide table.

Run focused tests until GREEN, then run:

```powershell
pnpm.cmd --filter @repo/web test
pnpm.cmd --filter @repo/web typecheck
pnpm.cmd --filter @repo/web lint
pnpm.cmd --filter @repo/web build
```

Expected: full web suite, typecheck, lint, and production build pass with no touched-area warnings.

### Task 7: Live acceptance, evidence, independent review, and single commit

**Files:**

- Create: `docs/pisocamp/cm-1-acceptance-evidence.md`
- Update: the ignored SDD ledger/report for RED/GREEN commands, rulings, and review findings.

**Interfaces:**

- Consumes: complete Tasks 1-6 implementation.
- Produces: explicit acceptance evidence and the sole CM-1 local commit after approval.

- [ ] **Step 1: Run full static verification**

Run serially to avoid the known PostgreSQL fixture contention from parallel Jest suites:

```powershell
pnpm.cmd --filter @repo/contracts test
pnpm.cmd --filter @repo/db test
pnpm.cmd --filter @repo/backend test --runInBand
pnpm.cmd --filter @repo/web test
pnpm.cmd --filter @repo/contracts lint
pnpm.cmd --filter @repo/db lint
pnpm.cmd --filter @repo/backend lint
pnpm.cmd --filter @repo/web lint
pnpm.cmd --filter @repo/contracts typecheck
pnpm.cmd --filter @repo/db typecheck
pnpm.cmd --filter @repo/backend typecheck
pnpm.cmd --filter @repo/web typecheck
pnpm.cmd --filter @repo/contracts build
pnpm.cmd --filter @repo/db build
pnpm.cmd --filter @repo/backend build
pnpm.cmd --filter @repo/web build
pnpm.cmd lint:ws
git diff --check
```

Read every exit code and failure count; do not infer broad success from focused checks.

- [ ] **Step 2: Disposable PostgreSQL/live HTTP acceptance**

Create a dedicated disposable database, apply all migrations, seed roles/catalog, start the production-built backend on a temporary localhost port, and prove:

1. permitted create returns draft version 1 and appears in list/detail;
2. permitted edit returns draft version 2, changes editor/date, retains version 1 unchanged, and shows new fields/links;
3. invalid type payload is 400 with understandable field errors and zero writes;
4. unknown/mismatched catalog pair is 400 with zero writes;
5. missing/mismatched idempotency key is 400;
6. exact create/edit replay returns stored success without duplicate item/version/link/audit/key rows;
7. stale edit is 409 and preserves the winning version;
8. unprivileged create/edit is 403 with exact `permission_denied` audits;
9. deactivated stored replay is 401 before response replay;
10. forced audit/idempotency failure leaves no partial content rows;
11. no public route/bundle exposes draft content;
12. captured server logs contain no content body, URLs, cookies, raw credentials, or session material and no unhandled errors/warnings.

Drop the disposable database and stop the exact process tree; verify the port is closed and database absent.

- [ ] **Step 3: Browser acceptance**

Use a disposable Content Administrator and unprivileged account against disposable backend data. Exercise rendered Chromium at desktop and 390px mobile widths:

- keyboard-create one currency draft and confirm it appears;
- edit it and confirm displayed editor/date/content after reload;
- exercise all five type fieldsets and validation focus/messages;
- add/reorder/remove each related-link kind;
- force 409 conflict and verify reload warning;
- verify unprivileged navigation is hidden and direct route redirects;
- inspect browser console, `pageerror`, network failures, focus order, labels, visible errors, 200% zoom, and horizontal overflow.

Require zero touched-area console errors/warnings, unhandled rejections, or unexpected failed requests.

- [ ] **Step 4: Record evidence and independent review**

Write `docs/pisocamp/cm-1-acceptance-evidence.md` with exact commands/counts, migration/catalog provenance, API row counts, audit/idempotency/denial evidence, browser matrix, clean-log checks, teardown, and residual limitations. Dispatch the project `code-reviewer` across the entire working-tree diff against `HEAD`; fix every Critical/Important finding via RED/GREEN and request scoped re-review.

- [ ] **Step 5: Foundation review checkpoint and single local commit**

Present the complete plan/result/evidence and pause for the user's foundational review before committing. After explicit approval, run the fresh completion commands again, then:

```powershell
git add -A
git commit -m "CM-1: add draft content foundation"
```

Confirm the commit is local, no push/PR/branch occurred, and log CM-1 as PASS before starting CM-3.

## Plan Self-Review

- CM-1 user story and all five acceptance criteria map to Tasks 1, 4, 6, and 7.
- In-scope tables/routes/list/form/type rules are covered; assets, transitions, preview, bundle/public visibility, and workflow UI remain out of scope.
- CM-3/CM-4 reuse the reserved lifecycle, immutable versions, lineage, approval/publication fields, and current pointers without rewriting status/version ownership.
- F2 primitives are extended through metadata and reused; no second auth, RBAC, audit, transaction, idempotency, logging, or access system is introduced.
- Types/signatures are consistent across contracts, backend, and web; request IDs are UUIDs and headers match exactly.
- Every implementation step names concrete behavior, files, commands, and expected evidence; no intermediate commit is permitted.
