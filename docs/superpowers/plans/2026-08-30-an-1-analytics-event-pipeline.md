# AN-1 Analytics Event Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the AN-1 pseudonymous analytics SDK, authenticated encrypted offline queue, idempotent batch ingestion, and permission-gated `module_entry`-today dashboard tile.

**Architecture:** Flutter emits only closed-catalog event intents and atomically stores one AES-256-GCM ciphertext file per event before scheduling a single-flight batch upload. NestJS validates the shared oRPC contract and inserts immutable PostgreSQL rows on unique `event_id`; the web dashboard reads only an aggregate Asia/Manila day count behind the existing F2 permission/audit spine.

**Tech Stack:** Dart 3.9 / Flutter / Riverpod / Dio / `cryptography` / `flutter_secure_storage` / `package_info_plus`; TypeScript / Zod / oRPC / NestJS / Drizzle / PostgreSQL; Next.js 16 / React 19 / TanStack Query / Tailwind / shadcn; Vitest / Jest / Flutter Test / Supertest.

**Spec:** `docs/superpowers/specs/2026-08-30-an-1-analytics-event-pipeline-design.md`

## Global Constraints

- Work on the existing `dev` branch only. Never create a branch, push, or open a pull request.
- AN-1 gets exactly one local commit, and only after every acceptance criterion and validation gate passes: `AN-1: add idempotent offline analytics pipeline`.
- Do not make intermediate task commits. End each task with tests plus reviewer approval, leaving changes uncommitted.
- Follow TDD: establish the intended failure, implement the smallest complete behavior, then rerun the focused suite.
- Use `pnpm` for JavaScript/TypeScript workspace commands and Flutter tooling for `apps/mobile`.
- Use direct imports in `apps/`; do not create application barrel files or type-only files.
- Keep cross-app schemas in `@repo/contracts`; keep Drizzle ownership in `@repo/db`; feature code never writes another ticket's owned tables.
- Common envelope schema version is exactly `1`; event IDs and session IDs are UUIDv4; device pseudonyms match `^[A-Za-z0-9_-]{22}$`.
- Queue encryption is AES-256-GCM with a fresh 96-bit nonce, a 32-byte key in secure storage, a 16-byte tag, and AAD binding format version plus filename event ID.
- Queue commits are flush + atomic same-directory rename. Existing ciphertext plus a missing/invalid key fails closed and is never deleted or re-keyed automatically.
- Batch limits are 100 events and 512 KiB. Retry starts at 1 second, doubles to 5 minutes, uses ±20% jitter, and resets on reconnect or process restart.
- `status` is `completed | failed | cancelled`; it is distinct from the queue transport states `queued | uploading | acked | deleted`.
- The analytics store contains no account ID, email, name, IP address, user agent, token, cookie, or image. No raw-event listing endpoint is added.
- Non-demographic pseudonymous events do not add a consent purpose. Registration, survey, and demographic consent behavior remains unchanged.
- Reporting periods and the first dashboard tile use `Asia/Manila` and `occurredAt`.
- All logs are metadata-only and exclude event properties, pseudonyms, event/session IDs, local paths, HTTP bodies, credentials, and raw exception strings.
- Every permission gate must prove: permitted succeeds; missing permission returns 403 and records `permission_denied`; unauthenticated returns 401 before permission resolution.
- UI validation includes real-browser console/network checks, keyboard/focus, accessible labels, 320 px width, 200% text, and no horizontal overflow.

## File map

### Shared contracts and catalog

- Create `packages/contracts/src/modules/v1/pisocamp/analytics.schema.ts` — closed event catalog, batch input, acknowledgement, and summary schemas.
- Create `packages/contracts/src/modules/v1/pisocamp/analytics.schema.test.ts` — strict shape, PII/image, size, UUID, and catalog tests.
- Create `packages/contracts/src/modules/v1/pisocamp/analytics.contract.ts` — ingestion and summary oRPC routes.
- Create `packages/contracts/src/modules/v1/pisocamp/fixtures/an1-event-vectors.json` — shared wire-format vectors consumed by TypeScript and Dart tests.
- Modify `packages/contracts/src/modules/v1/pisocamp/pisocamp.contract.ts` — mount analytics routes.
- Modify `packages/contracts/src/contracts.ts` — public package exports.
- Create `docs/analytics-events.md` — human-readable catalog matching executable schemas.

### Database

- Modify `packages/db/src/schema.ts` — add `analyticsEvents` and `schema.analyticsEvents`.
- Modify `packages/db/src/schema.spec.ts` — prove columns, constraints, indexes, and package export.
- Create `packages/db/src/analytics-migration.spec.ts` — live migration and no-PII invariant coverage.
- Create `packages/db/src/migrations/20260830120000_an1_analytics_event_pipeline/migration.sql` — additive table and indexes.
- Create `packages/db/src/migrations/20260830120000_an1_analytics_event_pipeline/snapshot.json` — Drizzle snapshot matching `schema.ts`.

### Backend

- Create `apps/backend/src/modules/v1/pisocamp/analytics/analytics.service.ts` — batch insertion and Manila-day aggregate.
- Create `apps/backend/src/modules/v1/pisocamp/analytics/analytics.service.spec.ts` — unit behavior and query bounds.
- Create `apps/backend/src/modules/v1/pisocamp/analytics/analytics.controller.ts` — anonymous ingestion and protected summary handlers.
- Create `apps/backend/src/modules/v1/pisocamp/analytics/analytics.controller.spec.ts` — handler delegation and metadata.
- Create `apps/backend/src/modules/v1/pisocamp/analytics/analytics.idempotency.spec.ts` — PostgreSQL duplicate/concurrency/timeout-resend proof.
- Create `apps/backend/src/modules/v1/pisocamp/analytics/analytics.authorization.spec.ts` — permitted, denied+audit, and deactivated/unauthenticated branches.
- Create `apps/backend/src/modules/v1/pisocamp/analytics/analytics.module.ts` — focused Nest module.
- Modify `apps/backend/src/modules/v1/pisocamp/pisocamp.module.ts` — import the analytics module.
- Create `apps/backend/test/analytics.e2e-spec.ts` — composed HTTP, response safety, exact-once, and clean-log proof.

### Mobile

- Create `apps/mobile/lib/core/utils/uuid_v4.dart` and `apps/mobile/test/core/utils/uuid_v4_test.dart` — shared secure UUIDv4 generator.
- Modify `apps/mobile/lib/features/pisocamp/data/consent_service.dart` and `apps/mobile/lib/features/pisocamp/presentation/providers/pisocamp_registration_provider.dart` — reuse the shared generator.
- Create `apps/mobile/lib/features/pisocamp/data/analytics_event.dart` — runtime event model, closed Dart catalog, validation, and encoding.
- Create `apps/mobile/test/features/pisocamp/data/analytics_event_test.dart` — common/catalog/PII validation and cross-language fixtures.
- Create `apps/mobile/lib/features/pisocamp/data/encrypted_analytics_queue.dart` — key management, AEAD files, recovery, batches, quarantine, and ack deletion.
- Create `apps/mobile/test/features/pisocamp/data/encrypted_analytics_queue_test.dart` — real-filesystem encryption and crash recovery.
- Create `apps/mobile/lib/features/pisocamp/data/analytics_repository.dart` — exact Dio batch protocol.
- Create `apps/mobile/test/features/pisocamp/data/analytics_repository_test.dart` — request/response validation and failure retention inputs.
- Create `apps/mobile/lib/features/pisocamp/data/analytics_sync_controller.dart` — serialized drain/retry lifecycle.
- Create `apps/mobile/test/features/pisocamp/data/analytics_sync_controller_test.dart` — offline/reconnect/timeout/partial-ack/cancellation tests.
- Create `apps/mobile/lib/features/pisocamp/presentation/providers/analytics_provider.dart` — Riverpod assembly, context capture, SDK, and CE-1 adapter.
- Create `apps/mobile/test/features/pisocamp/presentation/analytics_provider_test.dart` — context and provider wiring.
- Modify `apps/mobile/lib/core/constants/api_constants.dart` — analytics ingestion route.
- Modify `apps/mobile/lib/features/pisocamp/presentation/screens/pisocamp_home_screen.dart` — module, prompt, guest events and sync trigger.
- Modify `apps/mobile/lib/features/pisocamp/presentation/widgets/account_prompt.dart` — one logical shown callback.
- Modify `apps/mobile/lib/features/pisocamp/presentation/providers/currency_catalog_provider.dart` — replace no-op default with SDK adapter.
- Modify focused home/account/currency tests — exact logical-boundary emission.
- Modify `apps/mobile/pubspec.yaml` and `apps/mobile/pubspec.lock` — promote locked `package_info_plus` 9.0.1 to a direct dependency.

### Web and evidence

- Create `apps/web/features/analytics/api/analytics.hooks.ts` — permission-controlled summary query.
- Create `apps/web/features/analytics/api/analytics.hooks.test.tsx` — disabled/enabled typed query behavior.
- Create `apps/web/features/analytics/components/module-entry-today-tile.tsx` — accessible tile states.
- Create `apps/web/features/analytics/components/module-entry-today-tile.test.tsx` — loading/zero/error/success/accessibility tests.
- Modify `apps/web/features/dashboard/components/dashboard-overview.tsx` — conditionally render analytics tile.
- Create `apps/web/features/dashboard/components/dashboard-overview.test.tsx` — prove unauthorized users issue no analytics query.
- Create `packages/e2e-web/tests/an1-dashboard.authenticated.spec.ts` — real-browser permission, responsive, accessibility, and console/network proof.
- Create `docs/pisocamp/an-1-acceptance-evidence.md` — criterion-by-criterion commands, observations, and hashes.
- Track ticket progress in `.superpowers/sdd/2026-08-30-an-1-analytics-event-pipeline/progress.md` (ignored ledger; never staged).

---

### Task 1: Freeze the executable event catalog and oRPC routes

**Assigned project agent:** `backend-developer`

**Files:**

- Create: `packages/contracts/src/modules/v1/pisocamp/analytics.schema.ts`
- Create: `packages/contracts/src/modules/v1/pisocamp/analytics.schema.test.ts`
- Create: `packages/contracts/src/modules/v1/pisocamp/analytics.contract.ts`
- Create: `packages/contracts/src/modules/v1/pisocamp/fixtures/an1-event-vectors.json`
- Modify: `packages/contracts/src/modules/v1/pisocamp/pisocamp.contract.ts`
- Modify: `packages/contracts/src/contracts.ts`
- Create: `docs/analytics-events.md`

**Interfaces:**

- Produces: `AnalyticsEventSchema`, `IngestAnalyticsEventsInputSchema`, `IngestAnalyticsEventsOutputSchema`, `ModuleEntryTodaySchema`, `AnalyticsEvent`, `IngestAnalyticsEventsInput`, `IngestAnalyticsEventsOutput`, `ModuleEntryToday`, and `pisoCampAnalyticsContract`.
- Produces routes: `v1.pisocamp.events.ingest` at `POST /api/v1/pisocamp/events`; `v1.pisocamp.analytics.moduleEntryToday` at `GET /api/v1/admin/pisocamp/analytics/module-entry-today`.
- Consumed by: Tasks 2–4, 6, and 8.

- [ ] **Step 1: Write failing schema and route tests**

Add tests that parse one fixture for each event, reject all unknown keys and unregistered names, enforce UUIDv4/pseudonym/timestamp/enums, reject duplicate input event IDs and property keys or values containing email/name/image data, enforce 8 KiB per event plus 100-event/512 KiB batches, preserve acknowledgement order, and assert exact route paths/security declarations.

Use a fixture factory shaped like:

```ts
const common = {
	schemaVersion: 1 as const,
	eventId: "0190f49b-57a8-4b85-9d0e-5e274f0e4aa1",
	occurredAt: "2026-08-30T01:02:03.000Z",
	subjectPseudoId: "AbCdEfGhIjKlMnOpQrStUv",
	sessionId: "f6635d24-b4d1-4f63-8a06-4026fa4e8fd6",
	accountType: "guest" as const,
	appVersion: "1.0.0+1",
	osName: "android" as const,
	osVersion: "Android 15",
	deviceCategory: "phone" as const,
	networkState: "offline" as const,
}
```

Run:

```bash
pnpm --filter @repo/contracts test -- analytics.schema.test.ts
```

Expected: FAIL because analytics schemas and routes do not exist.

- [ ] **Step 2: Implement strict discriminated schemas**

Create a closed catalog using literal fields on each variant:

```ts
const AnalyticsCommonSchema = z.object({
	schemaVersion: z.literal(1),
	eventId: UuidV4Schema,
	occurredAt: z.iso.datetime({ offset: true }),
	subjectPseudoId: DevicePseudoIdSchema,
	sessionId: UuidV4Schema,
	accountType: z.enum(["guest", "registered"]),
	appVersion: z.string().trim().min(1).max(64),
	osName: z.enum(["android", "ios", "other"]),
	osVersion: z.string().trim().min(1).max(96),
	deviceCategory: z.enum(["phone", "tablet", "other"]),
	networkState: z.enum(["online", "offline", "unknown"]),
})

export const AnalyticsEventSchema = z.discriminatedUnion("eventName", [
	AnalyticsCommonSchema.extend({
		eventName: z.literal("module_entry"),
		screen: z.literal("pisocamp_home"),
		feature: z.literal("module"),
		status: z.literal("completed"),
		properties: z.object({ entryPoint: z.enum(["navigation", "deep_link", "other"]) }).strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("account_prompt_shown"),
		screen: z.literal("pisocamp_home"),
		feature: z.literal("account_prompt"),
		status: z.literal("completed"),
		properties: z.object({}).strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("account_prompt_guest"),
		screen: z.literal("pisocamp_home"),
		feature: z.literal("account_prompt"),
		status: z.literal("completed"),
		properties: z.object({}).strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("content_view"),
		screen: z.literal("currency_detail"),
		feature: z.literal("currency_education"),
		status: z.literal("completed"),
		properties: z.object({ logicalId: z.string().trim().min(1).max(128) }).strict(),
	}).strict(),
])
```

Implement recursive key/value safety as a `superRefine` applied to every event and encoded byte limits using `TextEncoder`. Deny normalized key segments `email`, `name`, `image`, `photo`, `frame`, `token`, `cookie`, and `authorization`; deny `data:image/` and image-shaped base64 strings without echoing values in issues.

- [ ] **Step 3: Mount and export the contracts**

Create:

```ts
export const pisoCampAnalyticsContract = {
	events: {
		ingest: oc
			.route({
				method: "POST",
				path: "/pisocamp/events",
				summary: "Ingest idempotent Piso CAMP analytics events",
				tags: ["Piso CAMP Analytics"],
				spec: spec => ({ ...spec, security: [] }),
			})
			.input(IngestAnalyticsEventsInputSchema)
			.output(IngestAnalyticsEventsOutputSchema),
	},
	analytics: {
		moduleEntryToday: oc
			.route({
				method: "GET",
				path: "/admin/pisocamp/analytics/module-entry-today",
				summary: "Count today's Piso CAMP module entries",
				tags: ["Piso CAMP Analytics"],
			})
			.output(ModuleEntryTodaySchema),
	},
}
```

Mount `events` and `analytics` under `pisoCampContract`, and export all public constants/types from `contracts.ts`.

- [ ] **Step 4: Write the human catalog and parity assertion**

Document the exact four rows (`module_entry`, `account_prompt_shown`, `account_prompt_guest`, `content_view`), common fields, property schemas, emission points, forbidden data, and registration process in `docs/analytics-events.md`. Store one valid vector per event in `fixtures/an1-event-vectors.json`; TypeScript parses every vector, and Task 4 consumes the same bytes from Dart. Add a test that extracts the backticked event names and compares them to exported `ANALYTICS_EVENT_NAMES`.

- [ ] **Step 5: Run the focused and complete contract gates**

```bash
pnpm --filter @repo/contracts test -- analytics.schema.test.ts
pnpm --filter @repo/contracts typecheck
pnpm --filter @repo/contracts lint
```

Expected: all PASS, no skipped tests, no warnings from the touched catalog.

- [ ] **Step 6: Reviewer checkpoint; do not commit**

Verify the schema contains no open `record<string, unknown>` property bucket, the public ingestion route alone is anonymous, and the summary route advertises normal authentication. Record Task 1 PASS in the ignored progress ledger.

### Task 2: Add the PostgreSQL analytics event store and migration

**Assigned project agent:** `backend-developer`

**Files:**

- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/schema.spec.ts`
- Create: `packages/db/src/analytics-migration.spec.ts`
- Create: `packages/db/src/migrations/20260830120000_an1_analytics_event_pipeline/migration.sql`
- Create: `packages/db/src/migrations/20260830120000_an1_analytics_event_pipeline/snapshot.json`

**Interfaces:**

- Consumes: `AnalyticsEvent` from Task 1.
- Produces: `analyticsEvents` Drizzle table and `schema.analyticsEvents`.
- Consumed by: Task 3 and all later analytics tickets.

- [ ] **Step 1: Write failing schema tests**

Assert the exact columns and absence of prohibited columns:

```ts
expect(getTableName(analyticsEvents)).toBe("analytics_event")
expect(Object.keys(getTableColumns(analyticsEvents))).toEqual([
	"eventId",
	"schemaVersion",
	"eventName",
	"occurredAt",
	"subjectPseudoId",
	"sessionId",
	"accountType",
	"screen",
	"feature",
	"appVersion",
	"osName",
	"osVersion",
	"deviceCategory",
	"networkState",
	"status",
	"properties",
	"receivedAt",
])
expect(Object.keys(getTableColumns(analyticsEvents))).not.toEqual(
	expect.arrayContaining(["accountId", "email", "name", "ipAddress", "userAgent", "image"])
)
```

Assert primary key `event_id`, checks for every enum/length/schema version/JSON size, the three indexes from the spec, and `schema.analyticsEvents.table` identity.

Run:

```bash
pnpm --filter @repo/db test -- schema.spec.ts
```

Expected: FAIL because `analyticsEvents` is absent.

- [ ] **Step 2: Define the Drizzle table**

Add a focused `analyticsEvents` definition with constrained types:

```ts
export const analyticsEvents = createTable(
	"analytics_event",
	t => ({
		eventId: t.uuid("event_id").primaryKey(),
		schemaVersion: t.integer("schema_version").notNull(),
		eventName: t.text("event_name").notNull().$type<AnalyticsEvent["eventName"]>(),
		occurredAt: t.timestamp("occurred_at", { withTimezone: true }).notNull(),
		subjectPseudoId: t.text("subject_pseudo_id").notNull(),
		sessionId: t.uuid("session_id").notNull(),
		accountType: t.text("account_type").notNull().$type<AnalyticsEvent["accountType"]>(),
		screen: t.text("screen").notNull(),
		feature: t.text("feature").notNull(),
		appVersion: t.text("app_version").notNull(),
		osName: t.text("os_name").notNull().$type<AnalyticsEvent["osName"]>(),
		osVersion: t.text("os_version").notNull(),
		deviceCategory: t.text("device_category").notNull().$type<AnalyticsEvent["deviceCategory"]>(),
		networkState: t.text("network_state").notNull().$type<AnalyticsEvent["networkState"]>(),
		status: t.text("status").notNull().$type<AnalyticsEvent["status"]>(),
		properties: t.jsonb("properties").notNull().$type<AnalyticsEvent["properties"]>(),
		receivedAt: t.timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
	}),
	t => [
		check("analytics_event_schema_version_check", sql`${t.schemaVersion} = 1`),
		check(
			"analytics_event_subject_pseudo_id_check",
			sql`${t.subjectPseudoId} ~ '^[A-Za-z0-9_-]{22}$'`
		),
		check("analytics_event_account_type_check", sql`${t.accountType} in ('guest', 'registered')`),
		check("analytics_event_os_name_check", sql`${t.osName} in ('android', 'ios', 'other')`),
		check(
			"analytics_event_device_category_check",
			sql`${t.deviceCategory} in ('phone', 'tablet', 'other')`
		),
		check(
			"analytics_event_network_state_check",
			sql`${t.networkState} in ('online', 'offline', 'unknown')`
		),
		check("analytics_event_status_check", sql`${t.status} in ('completed', 'failed', 'cancelled')`),
		index("analytics_event_name_occurred_at_idx").on(t.eventName, t.occurredAt),
		index("analytics_event_subject_occurred_at_idx").on(t.subjectPseudoId, t.occurredAt),
		index("analytics_event_session_occurred_at_idx").on(t.sessionId, t.occurredAt),
	]
)
```

Use a primary key rather than a second uniqueness constraint. Add checks for schema version 1, device format, event/common enums, exact catalog screen/feature/status combinations, bounded text, and object JSON. Keep the canonical 8 KiB rule in the shared/application validator because PostgreSQL storage size is not canonical JSON byte size.

- [ ] **Step 3: Generate and inspect the additive migration**

Run Drizzle generation with the stable name, then rename the returned timestamp directory to the exact planned directory if needed and keep its generated `snapshot.json` paired with the SQL:

```bash
pnpm --filter @repo/db exec drizzle-kit generate --name an1_analytics_event_pipeline
```

The SQL must create only `analytics_event` plus its checks/indexes. It must not drop, rename, or rewrite existing tables.

- [ ] **Step 4: Add live migration invariants**

In `analytics-migration.spec.ts`, use `assertDisposablePostgres` and test:

- two rows with the same `event_id` cannot coexist;
- every enum, pseudonym, schema version, catalog-combination, bounded-text, and object-JSON check rejects invalid SQL;
- `information_schema.columns` proves no prohibited PII columns;
- required indexes exist;
- migration applies on the full preceding schema without data loss.

- [ ] **Step 5: Run schema, migration, type, and format gates**

```bash
pnpm --filter @repo/db test -- schema.spec.ts analytics-migration.spec.ts
pnpm --filter @repo/db typecheck
pnpm --filter @repo/db lint
pnpm --filter @repo/db build
```

Expected: schema tests PASS; the migration test must run against the disposable AN-1 database in the authoritative run and must not be reported as skipped.

- [ ] **Step 6: Reviewer checkpoint; do not commit**

Review the SQL diff for additive-only behavior, verify the snapshot matches `schema.ts`, and record Task 2 PASS plus the migration directory/hash in the progress ledger.

### Task 3: Implement idempotent NestJS ingestion and the Manila-day aggregate

**Assigned project agent:** `backend-developer`

**Files:**

- Create: `apps/backend/src/modules/v1/pisocamp/analytics/analytics.service.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/analytics/analytics.service.spec.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/analytics/analytics.controller.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/analytics/analytics.controller.spec.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/analytics/analytics.idempotency.spec.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/analytics/analytics.authorization.spec.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/analytics/analytics.module.ts`
- Modify: `apps/backend/src/modules/v1/pisocamp/pisocamp.module.ts`
- Create: `apps/backend/test/analytics.e2e-spec.ts`

**Interfaces:**

- Consumes: Task 1 oRPC types and Task 2 `analyticsEvents`.
- Produces: `AnalyticsService.ingest(input): Promise<IngestAnalyticsEventsOutput>` and `AnalyticsService.moduleEntryToday(referenceTime?): Promise<ModuleEntryToday>`.
- Produces controllers for `v1.pisocamp.events.ingest` and `v1.pisocamp.analytics.moduleEntryToday`.
- Consumed by: Task 8 dashboard and Task 9 acceptance proof.

- [ ] **Step 1: Write failing service tests**

Use an injected `ANALYTICS_DATABASE` seam. Assert that `ingest` maps `occurredAt` to `Date`, performs one conflict-ignore insertion, returns distinct IDs in request order, and never updates existing events. For the summary, assert the SQL binds the supplied reference time and uses `Asia/Manila`, a half-open day, `module_entry`, and `occurred_at`.

Run:

```bash
pnpm --filter @repo/backend test -- analytics.service.spec.ts --runInBand
```

Expected: FAIL because the service does not exist.

- [ ] **Step 2: Implement the service and database provider**

Use one insertion statement:

```ts
export const ANALYTICS_DATABASE = Symbol("ANALYTICS_DATABASE")
export const analyticsDatabaseProvider: Provider = {
	provide: ANALYTICS_DATABASE,
	useValue: db,
}

async ingest(input: V1Inputs["pisocamp"]["events"]["ingest"]):
	Promise<V1Outputs["pisocamp"]["events"]["ingest"]> {
	await this.database
		.insert(analyticsEvents)
		.values(input.events.map(event => ({ ...event, occurredAt: new Date(event.occurredAt) })))
		.onConflictDoNothing({ target: analyticsEvents.eventId })
	return { ackedEventIds: input.events.map(event => event.eventId) }
}
```

Require input event IDs to be distinct at the shared schema boundary; output every validated ID once in request order.

Implement the summary as one parameterized PostgreSQL CTE. The CTE derives the local date from `$referenceTime::timestamptz AT TIME ZONE 'Asia/Manila'`, converts local midnight and next midnight back with `AT TIME ZONE 'Asia/Manila'`, counts `module_entry`, and returns `{ date, timezone: "Asia/Manila", moduleEntryCount }`. Parse the bigint count safely and reject values above `Number.MAX_SAFE_INTEGER`.

- [ ] **Step 3: Write failing controller metadata and delegation tests**

Assert:

```ts
expect(Reflect.getMetadata("PUBLIC", AnalyticsController.prototype.ingest)).toBe(true)
expect(Reflect.getMetadata(STRICT_THROTTLE_KEY, AnalyticsController.prototype.ingest)).toBe(true)
expect(
	Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AnalyticsController.prototype.moduleEntryToday)
).toEqual(["reports.dashboards.view"])
```

Assert exact service input/output delegation and safe ORPC translation without logging response bodies.

- [ ] **Step 4: Implement the controller and module**

Use:

```ts
@Controller()
export class AnalyticsController {
	constructor(private readonly analyticsService: AnalyticsService) {}

	@AllowAnonymous()
	@StrictThrottle()
	@Implement(v1.pisocamp.events.ingest)
	ingest() {
		return implement(v1.pisocamp.events.ingest).handler(({ input }) =>
			this.analyticsService.ingest(input)
		)
	}

	@RequirePermissions("reports.dashboards.view")
	@Implement(v1.pisocamp.analytics.moduleEntryToday)
	moduleEntryToday() {
		return implement(v1.pisocamp.analytics.moduleEntryToday).handler(() =>
			this.analyticsService.moduleEntryToday()
		)
	}
}
```

Register controller/service/provider in `AnalyticsModule`, then import that module from `PisoCampModule`. Do not enlarge `PisoCampController`.

- [ ] **Step 5: Prove duplicate, race, and timeout-resend behavior with PostgreSQL**

In `analytics.idempotency.spec.ts`, insert a batch twice, concurrently submit the same ID from two service instances, and simulate “commit succeeded / response lost” by discarding the first output then calling `ingest` again. Assert one database row and the same acknowledgement. Reuse the same ID with changed properties and prove the stored row is unchanged.

- [ ] **Step 6: Prove permission and account-state branches**

Use the real `RbacGuard`, `RbacService`, `AccountAccessService`, and `AuditService` seams as in existing authorization specs:

- Reports & Analytics user receives the summary.
- Registered user without `reports.dashboards.view` receives 403 and one `permission_denied` audit targeting `AnalyticsController.moduleEntryToday`.
- unauthenticated or deactivated identity receives 401 before permission resolution and no permission grant.

- [ ] **Step 7: Add composed HTTP and clean-log tests**

Use `createApplication()` and Supertest against the disposable database. Prove anonymous POST, strict invalid-body rejection, duplicate resend, exact acknowledgement, authenticated summary, no cookies/PII in body, and no raw sentinel in captured Pino output. Include a batch just below and above the 512 KiB route boundary.

- [ ] **Step 8: Run focused backend gates**

```bash
pnpm --filter @repo/backend test -- analytics.service.spec.ts analytics.controller.spec.ts analytics.idempotency.spec.ts analytics.authorization.spec.ts --runInBand
pnpm --filter @repo/backend test:e2e -- analytics.e2e-spec.ts --runInBand
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend build
```

Expected: all PASS, database-backed cases execute without skip, no open handles, and captured logs contain no sentinels.

- [ ] **Step 9: Reviewer checkpoint; do not commit**

Review contract/handler symmetry, ensure no account identity is persisted, confirm uniqueness—not pre-read—is the race authority, and record Task 3 PASS in the progress ledger.

### Task 4: Build the Dart catalog, shared UUID generator, and safe event model

**Assigned project agent:** `flutter-expert`

**Files:**

- Create: `apps/mobile/lib/core/utils/uuid_v4.dart`
- Create: `apps/mobile/test/core/utils/uuid_v4_test.dart`
- Modify: `apps/mobile/lib/features/pisocamp/data/consent_service.dart`
- Modify: `apps/mobile/lib/features/pisocamp/presentation/providers/pisocamp_registration_provider.dart`
- Create: `apps/mobile/lib/features/pisocamp/data/analytics_event.dart`
- Create: `apps/mobile/test/features/pisocamp/data/analytics_event_test.dart`
- Consume fixture: `packages/contracts/src/modules/v1/pisocamp/fixtures/an1-event-vectors.json`

**Interfaces:**

- Produces: `createUuidV4([Random? random])`, sealed `AnalyticsIntent` variants, `AnalyticsEventContext`, immutable `AnalyticsEvent`, `AnalyticsValidationException`, and `AnalyticsEvent.build(...)`/`fromJson(...)`/`toJson()`.
- Consumed by: Tasks 5–7.

- [ ] **Step 1: Write failing UUID and catalog tests**

Test 1,000 generated values against:

```dart
final uuidV4 = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
);
```

Assert no duplicate in that sample and deterministic byte-bit behavior with an injected `Random`. Test every event intent against the shared fixture and round-trip exact JSON keys. Negative cases must include email/name keys, nested photo/image/frame keys, `data:image`, image-shaped base64, byte arrays, unknown properties, excessive nesting, overlong strings, invalid pseudonym/UUID/time/enum, and canonical JSON above 8 KiB.

Run:

```bash
cd apps/mobile
flutter test test/core/utils/uuid_v4_test.dart test/features/pisocamp/data/analytics_event_test.dart
```

Expected: FAIL because the utility and event model do not exist.

- [ ] **Step 2: Extract and reuse the secure UUIDv4 helper**

Implement:

```dart
String createUuidV4([Random? source]) {
  final random = source ?? Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
```

Replace the two feature-local copies in consent and registration without changing their injected test seams or stored IDs.

- [ ] **Step 3: Implement typed event intents and exact context**

Use sealed runtime types, not an arbitrary producer map:

```dart
sealed class AnalyticsIntent {
  const AnalyticsIntent();
  String get eventName;
  String get screen;
  String get feature;
  String get status => 'completed';
  Map<String, Object?> get properties;
}

final class ModuleEntryIntent extends AnalyticsIntent {
  const ModuleEntryIntent(this.entryPoint);
  final ModuleEntryPoint entryPoint;
  @override String get eventName => 'module_entry';
  @override String get screen => 'pisocamp_home';
  @override String get feature => 'module';
  @override Map<String, Object?> get properties => {'entryPoint': entryPoint.wireValue};
}

final class ContentViewIntent extends AnalyticsIntent {
  const ContentViewIntent(this.logicalId);
  final String logicalId;
  @override String get eventName => 'content_view';
  @override String get screen => 'currency_detail';
  @override String get feature => 'currency_education';
  @override Map<String, Object?> get properties => {'logicalId': logicalId};
}
```

Add the two prompt intent classes and `AnalyticsEventContext` with subject/session/account/app/OS/device/network fields. `AnalyticsEvent.build` assigns exactly one injected UUID and millisecond UTC timestamp.

- [ ] **Step 4: Implement strict parsing and PII/image defense**

`AnalyticsEvent.fromJson` must require the exact common key set, then the exact properties for `eventName`; validate all string bounds/enums/regexes before constructing an object. Before returning or serializing, recursively inspect keys and values with the spec's normalized deny list. Reuse `kRedactedFieldNames` for overlapping credential/PII terms, and add analytics-only image/name terms without mutating the shared observability manifest.

Throw only stable reason codes:

```dart
final class AnalyticsValidationException implements Exception {
  const AnalyticsValidationException(this.reason);
  final AnalyticsValidationReason reason;
}
```

No exception message contains a rejected value.

- [ ] **Step 5: Run focused tests and regression tests for migrated UUID consumers**

```bash
cd apps/mobile
flutter test test/core/utils/uuid_v4_test.dart test/features/pisocamp/data/analytics_event_test.dart
flutter test test/features/pisocamp/data/consent_service_test.dart
flutter test test/features/pisocamp/presentation/pisocamp_registration_controller_test.dart
flutter analyze lib/core/utils/uuid_v4.dart lib/features/pisocamp/data/analytics_event.dart
```

Expected: all PASS; existing consent/profile idempotency tests remain unchanged semantically.

- [ ] **Step 6: Reviewer checkpoint; do not commit**

Confirm feature callers cannot inject common metadata or arbitrary properties, fixture parity passes, exceptions contain no payloads, and record Task 4 PASS.

### Task 5: Implement the authenticated encrypted event-file queue

**Assigned project agent:** `flutter-expert`

**Files:**

- Create: `apps/mobile/lib/features/pisocamp/data/encrypted_analytics_queue.dart`
- Create: `apps/mobile/test/features/pisocamp/data/encrypted_analytics_queue_test.dart`

**Interfaces:**

- Consumes: Task 4 `AnalyticsEvent`.
- Produces: `AnalyticsKeyStore`, `SecureStorageAnalyticsKeyStore`, `EncryptedAnalyticsQueue.initialize()`, `enqueue(AnalyticsEvent)`, `readBatch({maxEvents, maxBytes})`, `acknowledge(Iterable<String>)`, and `pendingCount()`.
- Consumed by: Tasks 6 and 7.

- [ ] **Step 1: Write failing real-filesystem tests**

Use `Directory.systemTemp.createTemp` and an in-memory `AnalyticsKeyStore`. Cover:

- first initialization creates exactly one 32-byte key before enqueue;
- existing valid key is reused;
- missing/invalid key with committed files throws `analyticsKeyUnavailable` and leaves every byte untouched;
- ciphertext contains none of event name, pseudonym, logical ID, app/OS strings, or canonical JSON fragments;
- same plaintext encrypted twice yields different nonces/ciphertext;
- modified tag, nonce, version, AAD/filename, JSON, or embedded event ID is rejected and quarantined;
- 24-hour stale temp cleanup and preservation of newer temp files;
- 100 concurrent enqueues produce 100 complete uniquely named files and no `.part` reader visibility;
- deterministic lexicographic batching honors 100-event and 512 KiB limits;
- acknowledgement deletes only submitted IDs and is idempotent;
- one corrupt file cannot block valid siblings.

Run:

```bash
cd apps/mobile
flutter test test/features/pisocamp/data/encrypted_analytics_queue_test.dart
```

Expected: FAIL because the queue does not exist.

- [ ] **Step 2: Implement versioned key management and binary envelope**

Use constants:

```dart
const analyticsQueueKeyName = 'pisocamp.analytics.queue-key.v1';
const _magic = <int>[0x50, 0x43, 0x41, 0x51]; // PCAQ
const _formatVersion = 1;
const _nonceLength = 12;
const _tagLength = 16;
```

The file bytes are `magic || version || nonce || ciphertext || tag`. AAD is UTF-8 `PCAQ:1:<eventId>`. Generate the key and nonce using `Cryptography.instance.randomBytes`; encode the key as unpadded base64url in `SecureStorageAnalyticsKeyStore`.

- [ ] **Step 3: Implement atomic enqueue**

```dart
Future<void> enqueue(AnalyticsEvent event) async {
  final eventId = event.eventId;
  final plaintext = utf8.encode(jsonEncode(event.toJson()));
  final secretBox = await _cipher.encrypt(
    plaintext,
    secretKey: _secretKey,
    nonce: _randomBytes(_nonceLength),
    aad: utf8.encode('PCAQ:1:$eventId'),
  );
  final target = File(p.join(_queue.path, '$eventId.event'));
  final temporary = File(p.join(_tmp.path, '$eventId.${createUuidV4()}.part'));
  await temporary.writeAsBytes(_encode(secretBox), flush: true);
  await temporary.rename(target.path);
}
```

Serialize initialization and directory mutation. If rename fails, retain the original exception only internally and surface a stable `AnalyticsQueueException` code.

- [ ] **Step 4: Implement read, quarantine, and acknowledgement**

Enumerate only `*.event`, sort basename lexicographically, verify filename UUID before decrypting, authenticate with filename-bound AAD, parse through `AnalyticsEvent.fromJson`, and require embedded/filename ID equality. Atomically move bad files to `quarantine/` with the same basename; if a collision exists, suffix a random UUID. Build batch size from the UTF-8 bytes of the exact `{ "events": [...] }` request JSON, including wrapper, commas, and brackets; return only valid events within both limits.

`acknowledge` validates every ID before resolving a path and deletes only the exact `<id>.event` file. Never accept a caller-provided path.

- [ ] **Step 5: Run encryption, filesystem, and analyze gates**

```bash
cd apps/mobile
flutter test test/features/pisocamp/data/encrypted_analytics_queue_test.dart
flutter analyze lib/features/pisocamp/data/encrypted_analytics_queue.dart
```

Expected: all PASS under repeated runs; no plaintext or local path appears in diagnostics.

- [ ] **Step 6: Reviewer checkpoint; do not commit**

Inspect the actual file bytes and key storage seam, verify nonce generation and AAD, run the concurrency test five times, and record Task 5 PASS.

### Task 6: Implement exact batch upload and single-flight retry

**Assigned project agent:** `flutter-expert`

**Files:**

- Create: `apps/mobile/lib/features/pisocamp/data/analytics_repository.dart`
- Create: `apps/mobile/test/features/pisocamp/data/analytics_repository_test.dart`
- Create: `apps/mobile/lib/features/pisocamp/data/analytics_sync_controller.dart`
- Create: `apps/mobile/test/features/pisocamp/data/analytics_sync_controller_test.dart`
- Modify: `apps/mobile/lib/core/constants/api_constants.dart`

**Interfaces:**

- Consumes: Task 5 queue and Task 1 wire protocol.
- Produces: `AnalyticsRepository.upload(List<AnalyticsEvent>): Future<List<String>>`, `AnalyticsSyncTrigger`, `AnalyticsSyncController.sync(trigger)`, `dispose()`, and observable metadata-only sync state.
- Consumed by: Task 7.

- [ ] **Step 1: Write failing repository protocol tests**

Use a custom Dio adapter and assert:

- POST path is `${ApiConstants.versionedUrl}/pisocamp/events`;
- request body has exactly `{events: [...]}` and no separately supplied common metadata;
- response requires exactly `{ackedEventIds: [...]}`;
- acknowledgement IDs are distinct UUIDv4 values and a subset of the submitted IDs;
- foreign, duplicate, malformed, body-bearing error, timeout, cancel, and 4xx/5xx paths surface safe typed failures;
- no request or response body is logged.

Run:

```bash
cd apps/mobile
flutter test test/features/pisocamp/data/analytics_repository_test.dart
```

Expected: FAIL because repository/API constant are absent.

- [ ] **Step 2: Implement the repository parser**

```dart
Future<List<String>> upload(List<AnalyticsEvent> events) async {
  final response = await _dio.post<Object?>(
    ApiConstants.pisoCampEvents,
    data: <String, Object?>{
      'events': events.map((event) => event.toJson()).toList(growable: false),
    },
  );
  return _parseAcknowledgements(response.data, submitted: events.map((e) => e.eventId).toSet());
}
```

Require HTTP success through Dio defaults and exact keys/types. Return IDs in server order.

- [ ] **Step 3: Write failing sync lifecycle tests**

Use fake queue/repository, injected clock/sleeper/jitter, and cancellable completion points. Prove:

- two concurrent triggers share one drain;
- batches continue until fewer than 100 remain;
- only acknowledged IDs are deleted;
- offline trigger performs no HTTP;
- reconnect and startup trigger immediate attempts;
- timeout after committed server insert leaves files, resend gets ack, then deletes once;
- cancellation/process-dispose leaves all unacknowledged files;
- malformed/foreign ack and 4xx stop tight retries and retain batch;
- 5xx/network errors use 1s, 2s, 4s … 5m with deterministic ±20% injected jitter;
- reconnect resets backoff;
- diagnostics contain counts/codes only.

- [ ] **Step 4: Implement serialized drain and retry policy**

Use one stored future rather than a mutex package:

```dart
Future<void> sync(AnalyticsSyncTrigger trigger) {
  final active = _active;
  if (active != null) return active;
  final run = _drain(trigger).whenComplete(() => _active = null);
  _active = run;
  return run;
}
```

Within `_drain`, stop when offline, queue empty, a partial batch remains unacknowledged, a permanent protocol/4xx failure occurs, or disposed. Retry only transient errors while active. Never write an `uploading` status to disk.

- [ ] **Step 5: Run focused data-layer gates**

```bash
cd apps/mobile
flutter test test/features/pisocamp/data/analytics_repository_test.dart test/features/pisocamp/data/analytics_sync_controller_test.dart
flutter analyze lib/features/pisocamp/data/analytics_repository.dart lib/features/pisocamp/data/analytics_sync_controller.dart
```

Expected: all PASS with no leaked async timers, subscriptions, or unhandled errors.

- [ ] **Step 6: Reviewer checkpoint; do not commit**

Verify the client deletes only server-returned IDs, no batch idempotency header replaces per-event IDs, retry loops are bounded, and record Task 6 PASS.

### Task 7: Assemble Riverpod context and activate F1/CE-1 emission seams

**Assigned project agent:** `flutter-expert`

**Files:**

- Create: `apps/mobile/lib/features/pisocamp/presentation/providers/analytics_provider.dart`
- Create: `apps/mobile/test/features/pisocamp/presentation/analytics_provider_test.dart`
- Modify: `apps/mobile/lib/features/pisocamp/presentation/screens/pisocamp_home_screen.dart`
- Modify: `apps/mobile/lib/features/pisocamp/presentation/widgets/account_prompt.dart`
- Modify: `apps/mobile/lib/features/pisocamp/presentation/providers/currency_catalog_provider.dart`
- Modify: `apps/mobile/test/features/pisocamp/presentation/pisocamp_home_screen_test.dart`
- Modify: `apps/mobile/test/features/pisocamp/presentation/currency_screens_test.dart`
- Modify: `apps/mobile/pubspec.yaml`
- Modify: `apps/mobile/pubspec.lock`

**Interfaces:**

- Consumes: Tasks 4–6 plus existing `secureStorageProvider`, `dioProvider`, `connectivityStatusProvider`, `guestIdentityServiceProvider`, and `currentUserProvider`.
- Produces: `AnalyticsSdk.emit(AnalyticsIntent)`, `analyticsSdkProvider`, `analyticsSyncControllerProvider`, `ContentViewAnalytics`, and `contentViewAnalyticsProvider` backed by the SDK.
- Activates: `module_entry`, `account_prompt_shown`, `account_prompt_guest`, and `content_view`.

- [ ] **Step 1: Promote package metadata to a direct dependency**

Add the already locked version:

```yaml
dependencies:
  package_info_plus: ^9.0.1
```

Run `flutter pub get` and verify only the dependency classification/necessary lock metadata changes.

- [ ] **Step 2: Write failing provider/context tests**

Override all external sources and assert one emitted event captures:

- persisted device pseudonym;
- launch-stable UUID session ID, with a new ID for a fresh provider container;
- `registered` only when `currentUserProvider` has a user, otherwise `guest`;
- `online`, `offline`, or `unknown` from the connectivity `AsyncValue`;
- `version+buildNumber` from `PackageInfo`;
- normalized OS name/version;
- `tablet` at 600 logical pixels and `phone` below 600;
- one durable queue write before `emit` completes;
- safe debug-only reason-code reporting on rejected events.

Run:

```bash
cd apps/mobile
flutter test test/features/pisocamp/presentation/analytics_provider_test.dart
```

Expected: FAIL because providers and SDK do not exist.

- [ ] **Step 3: Implement provider assembly and SDK**

Keep types beside runtime behavior. The SDK should be:

```dart
final class AnalyticsSdk {
  AnalyticsSdk({required this.queue, required this.context, required this.scheduleSync});
  final EncryptedAnalyticsQueue queue;
  final Future<AnalyticsEventContext> Function() context;
  final void Function() scheduleSync;

  Future<void> emit(AnalyticsIntent intent) async {
    final event = AnalyticsEvent.build(intent: intent, context: await context());
    await queue.enqueue(event);
    scheduleSync();
  }
}
```

Initialize application-support directory, secure key adapter, package metadata, and sync controller once through keep-alive providers. Cancel connectivity subscriptions and controller timers on provider disposal.

- [ ] **Step 4: Write failing logical-boundary widget tests**

Prove:

- one `module_entry` after a home route mounts, not after state/provider rebuild;
- `account_prompt_shown` only when the prompt is actually rendered, once per prompt widget lifetime;
- guest event only after `continueAsGuest` succeeds, never on storage failure;
- content detail emits one `content_view` per resolved logical route; rebuild does not duplicate; route logical-ID change emits a new event;
- analytics write/sync failure never blocks navigation or makes the usable content disappear, and is consumed by the guarded detached-future helper;
- offline values are captured while local UI remains usable.

- [ ] **Step 5: Wire home, prompt, and CE-1 adapter**

Move `ContentViewAnalytics` and its SDK adapter into `analytics_provider.dart`; remove `NoopContentViewAnalytics`. Let `currency_catalog_provider.dart` import the real provider directly.

Add `onShown` to `AccountPrompt` as a stateful one-shot callback invoked from `initState` after the first frame. In home `initState`, schedule `ModuleEntryIntent(navigation)` and a startup sync. After successful guest persistence emit `AccountPromptGuestIntent`. On reconnect trigger both currency and analytics sync without coupling their failure states.

Use one helper:

```dart
void emitAnalytics(WidgetRef ref, AnalyticsIntent intent) {
  unawaited(
    ref.read(analyticsSdkProvider.future)
      .then((sdk) => sdk.emit(intent))
      .catchError((Object error, StackTrace stack) {
        reportAnalyticsFailure(intent.eventName, error);
      }),
  );
}

void reportAnalyticsFailure(String eventName, Object error) {
  final reason = switch (error) {
    AnalyticsValidationException(:final reason) => reason.wireValue,
    AnalyticsQueueException(:final reason) => reason.wireValue,
    _ => 'unexpected',
  };
  assert(() {
    debugPrint('analytics_emit_failed event=$eventName reason=$reason');
    return true;
  }());
}
```

Do not log `error`, `stack`, rejected values, IDs, paths, or bodies, and do not leave empty `catchError((_) {})` on the new analytics path.

- [ ] **Step 6: Run focused and full mobile gates**

```bash
cd apps/mobile
flutter test test/features/pisocamp/presentation/analytics_provider_test.dart test/features/pisocamp/presentation/pisocamp_home_screen_test.dart test/features/pisocamp/presentation/currency_screens_test.dart
flutter test
flutter analyze
dart format --output=none --set-exit-if-changed lib test
flutter build apk --debug
```

Expected: all PASS, no skipped tests, no pending timers, no analyzer/format diagnostics, APK builds.

- [ ] **Step 7: Reviewer checkpoint; do not commit**

Inspect event counts across rebuild/navigation tests, verify every emission waits for durable enqueue internally while UI callers detach safely, verify account/email never enter context, and record Task 7 PASS.

### Task 8: Add the permission-gated module-entry dashboard tile

**Assigned project agent:** `web-frontend-developer`

**Files:**

- Create: `apps/web/features/analytics/api/analytics.hooks.ts`
- Create: `apps/web/features/analytics/api/analytics.hooks.test.tsx`
- Create: `apps/web/features/analytics/components/module-entry-today-tile.tsx`
- Create: `apps/web/features/analytics/components/module-entry-today-tile.test.tsx`
- Modify: `apps/web/features/dashboard/components/dashboard-overview.tsx`
- Create: `apps/web/features/dashboard/components/dashboard-overview.test.tsx`
- Create: `packages/e2e-web/tests/an1-dashboard.authenticated.spec.ts`

**Interfaces:**

- Consumes: Task 1 `v1.pisocamp.analytics.moduleEntryToday`, F2 `canAccess`/`AccessProfile`, and the existing dashboard card/loading/error conventions.
- Produces: `useModuleEntryTodayQuery({ enabled })` and `ModuleEntryTodayTile`.
- Security invariant: a user without `reports.dashboards.view` never mounts the tile and therefore never creates the protected query.

- [ ] **Step 1: Write failing typed-query tests**

Mock the oRPC query-options builder and prove `enabled: false` produces no fetch, while `enabled: true` returns typed `{ moduleEntryCount, date, timezone }` data. Assert the options set `networkMode: "online"` and `staleTime: 60_000`.

Run:

```bash
pnpm --filter @repo/web test -- analytics.hooks.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 2: Implement the focused hook**

Follow the existing config-hook dependency injection seam:

```ts
export function useModuleEntryTodayQuery({ enabled }: { enabled: boolean }) {
	const options = orpc.pisocamp.analytics.moduleEntryToday.queryOptions({
		enabled,
		networkMode: "online",
		staleTime: 60_000,
	})

	return useQuery<ModuleEntryToday, Error>(
		options as unknown as UseQueryOptions<ModuleEntryToday, Error>
	)
}
```

Import `ModuleEntryToday` from `@repo/contracts` and use the same nominal TanStack compatibility cast already documented in `pisocamp-config.hooks.ts`.

- [ ] **Step 3: Write failing tile state and accessibility tests**

Cover:

- loading card uses an accessible status and stable title;
- zero is rendered as `0`, not an empty state;
- success renders the localized count plus server-returned date and `Asia/Manila`;
- failure renders a generic retryable message without response-body text;
- heading/value relationships and contrast-bearing semantic classes remain intact at narrow width and 200% text.

- [ ] **Step 4: Implement the tile**

Create a shadcn `Card` that calls `useModuleEntryTodayQuery({ enabled: true })`, uses `aria-live="polite"` for the changing value, and preserves a fixed label `Module entries today`. Do not expose raw event rows, pseudonyms, IDs, or properties.

- [ ] **Step 5: Gate tile mounting in the dashboard**

Write the dashboard test first. Mock `ModuleEntryTodayTile` and prove:

- missing `reports.dashboards.view` renders no tile and invokes no analytics hook;
- granted permission mounts one tile;
- the existing dashboard content remains unchanged in both branches.

Then derive permission from the existing `access` prop and conditionally render the query-owning child inside the dashboard stat grid:

```tsx
const canViewAnalytics = canAccess(access, {
	requiredPermission: "reports.dashboards.view",
})

return (
	<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<StatCard
			icon={SecurityCheckIcon}
			label="Your permissions"
			value={access.permissions.length}
			hint="Granted on your account"
		/>
		{canViewAnalytics ? <ModuleEntryTodayTile /> : null}
		{canReadPosts ? (
			<StatCard
				icon={Task01Icon}
				label="Total todos"
				value={todos.data?.length}
				hint={`${completedTodos} completed`}
			/>
		) : null}
		{canReadUsers ? (
			<StatCard
				icon={UserGroupIcon}
				label="Users"
				value={users.data?.length}
				hint="Across all roles"
			/>
		) : null}
		{canReadUsers ? (
			<StatCard
				icon={UserMultipleIcon}
				label="Roles"
				value={roles.data?.length}
				hint="Defined in the workspace"
			/>
		) : null}
	</div>
)
```

Keep the query hook inside `ModuleEntryTodayTile`; never call it conditionally from `DashboardOverview`.

- [ ] **Step 6: Run focused and complete web gates**

```bash
pnpm --filter @repo/web test -- analytics.hooks.test.tsx module-entry-today-tile.test.tsx dashboard-overview.test.tsx
pnpm --filter @repo/web test
pnpm --filter @repo/web typecheck
pnpm --filter @repo/web lint
pnpm --filter @repo/web build
```

Expected: all PASS with no act warnings, hydration warnings, or unauthorized analytics request.

- [ ] **Step 7: Reviewer checkpoint; do not commit**

Inspect the rendered DOM and network mock, verify denial removes the entire query-owning child, verify errors contain no server body, and record Task 8 PASS.

### Task 9: Prove AN-1 end to end and capture acceptance evidence

**Assigned project agents:** `fullstack-developer`, `flutter-expert`, then `code-reviewer`

**Files:**

- Create: `docs/pisocamp/an-1-acceptance-evidence.md`
- Modify only test/evidence files from Tasks 1–8 if a missing acceptance assertion is discovered.

**Interfaces:**

- Consumes: the complete AN-1 vertical slice.
- Produces: reproducible evidence for all five AN-1 acceptance criteria, RF-2, security/privacy, accessibility, and operational readiness.

- [ ] **Step 1: Start and migrate a disposable PostgreSQL authority**

Resolve and record the absolute repository path, then start a dedicated container named `pisocamp-an1-postgres` on host port `55440` with database `pisocamp_an1_test`. Point only the verification processes at that database, apply every migration in order, and verify the container/database identity before any destructive cleanup.

```powershell
docker run --name pisocamp-an1-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=pisocamp_an1_test -p 55440:5432 -d postgres:17-alpine
$env:DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55440/pisocamp_an1_test'
pnpm --filter @repo/db migrate
$env:SEED_ADMIN_PASSWORD='Password123'
pnpm --filter @repo/db seed -- --force-password
```

If the named container already exists, inspect it first and use it only when its image, port, and database match. Never remove a container or volume outside this exact AN-1 target.

- [ ] **Step 2: Run the cross-language and database authority proofs**

Run the TypeScript fixture parser and Dart fixture parser against the same committed JSON file. Run migration, concurrent duplicate, and timeout-after-commit resend tests against the disposable PostgreSQL database; skipped database cases fail the gate.

Capture commands, exit codes, test counts, database image digest, migration hash, and fixture hash in `an-1-acceptance-evidence.md`.

- [ ] **Step 3: Exercise the composed HTTP flow**

Use the real Nest application and disposable database to submit a batch, simulate loss of the first successful response at the test transport boundary, resend it, and verify:

- both responses acknowledge the same submitted IDs;
- the table contains one row per `event_id`;
- a partial acknowledgement deletes only acknowledged mobile files;
- request/response logs contain none of the seeded email, name, image, token, pseudonym, event ID, session ID, logical ID, or local-path sentinels.

Then exercise the protected summary as permitted, denied, and unauthenticated. Confirm denied returns 403 and writes `permission_denied`; unauthenticated returns 401 before permission resolution.

- [ ] **Step 4: Exercise the mobile lifecycle on a Flutter test device**

With a debug emulator/device and the backend URL pointed at the disposable stack:

1. enter Piso CAMP while offline and open one currency detail;
2. verify the UI remains usable and encrypted queue files contain no plaintext sentinels;
3. restore connectivity and verify the queue drains after acknowledgements;
4. terminate during an in-flight request, relaunch, and verify the retained event resends without a duplicate database row;
5. inspect Flutter logs for uncaught errors and prohibited sentinels.

Record device/emulator identity, app build hash, observation times, queue counts, and database counts without copying IDs or payloads into evidence.

- [ ] **Step 5: Validate the dashboard in a real browser**

Start backend and web against the disposable database. In Chrome/Edge DevTools, validate an authorized admin and a user lacking `reports.dashboards.view`:

- authorized: one successful summary request and a tile showing the Manila date/count;
- unauthorized: no analytics request and no tile;
- keyboard traversal and visible focus;
- screen-reader labels/live status;
- 320 CSS-pixel viewport and 200% text with no horizontal overflow;
- zero/loading/error/success states;
- no console errors, hydration warnings, failed requests, or PII/image sentinels in console/network bodies.

Automate these assertions in `an1-dashboard.authenticated.spec.ts` with the existing `signInAs(page, "admin")` and `signInAs(page, "userA")` fixtures, including page-error/console-error/request-failure collectors and `page.setViewportSize({ width: 320, height: 800 })`. Run it against the already started services:

```powershell
$env:BASE_URL='http://127.0.0.1:3001'
$env:E2E_AUTH_API_URL='http://127.0.0.1:3000/api/v1/auth/'
$env:E2E_NO_WEBSERVER='1'
pnpm --filter @repo/e2e-web test:e2e -- an1-dashboard.authenticated.spec.ts --project=chromium-authenticated
```

Capture Playwright screenshots/traces under the ignored progress directory and record their SHA-256 hashes in the evidence document; do not commit user/account identifiers.

- [ ] **Step 6: Map every criterion and RF-2**

In `an-1-acceptance-evidence.md`, include a table with one row for each ticket acceptance criterion and RF-2. Each row must link to the owning implementation/test, give the exact command or manual procedure, state PASS/FAIL, and cite the captured artifact/hash. A missing row or an unexecuted command is FAIL.

- [ ] **Step 7: Run privacy, secret, and scope scans**

```powershell
rg -n -i 'email|full.?name|raw.?image|data:image|authorization|cookie|token|ip.?address|user.?agent' packages/db/src/schema.ts apps/backend/src/modules/v1/pisocamp/analytics apps/mobile/lib/features/pisocamp/data apps/mobile/lib/features/pisocamp/presentation/providers/analytics_provider.dart
rg -n 'console\.|print\(|debugPrint\(' apps/backend/src/modules/v1/pisocamp/analytics apps/web/features/analytics apps/mobile/lib/features/pisocamp
git diff --check
git status --short
```

Review every hit as schema defense, test sentinel, or violation. Evidence must explain allowed defensive hits. Fail on secrets, payload logging, unrelated files, or generated artifacts that should be ignored.

- [ ] **Step 8: Reviewer checkpoint; do not commit**

Have `code-reviewer` compare the implementation and evidence to the design spec, all ticket text, RF-2, and repository rules. Resolve every critical or important finding, rerun affected gates, and record Task 9 PASS only at zero unresolved critical/important findings.

### Task 10: Run the authoritative gates and create the single local commit

**Assigned project agent:** `code-reviewer`; the primary agent owns staging and commit.

**Files:**

- All AN-1 files listed above.
- Ignored only: `.superpowers/sdd/2026-08-30-an-1-analytics-event-pipeline/progress.md` and browser/device artifacts.

- [ ] **Step 1: Re-run all authoritative tests from a clean process state**

Keep the disposable PostgreSQL database active and run:

```powershell
pnpm --filter @repo/contracts test
pnpm --filter @repo/db test
pnpm --filter @repo/backend test -- --runInBand
pnpm --filter @repo/backend test:e2e --runInBand
pnpm --filter @repo/web test
Push-Location apps/mobile
flutter test
flutter analyze
dart format --output=none --set-exit-if-changed lib test
flutter build apk --debug
Pop-Location
pnpm typecheck
pnpm lint
pnpm build
pnpm lint:ws
pnpm format
git diff --check
```

Expected: every command exits 0, database tests execute rather than skip, no warnings indicate hidden failures, and no process is left holding an unhandled rejection or timer.

- [ ] **Step 2: Perform cumulative diff review**

The `code-reviewer` checks every changed file for correctness, privacy/security, race safety, migration reversibility expectations, UX/accessibility, project conventions, and accidental scope. Resolve all critical/important findings and rerun the smallest affected test plus the complete authoritative gate it belongs to.

- [ ] **Step 3: Stage only the AN-1 ticket**

```powershell
git status --short
git add `
  apps/backend/src/app.module.ts `
  apps/backend/src/config/app.config.ts `
  apps/backend/src/config/body-limits.spec.ts `
  apps/backend/src/modules/v1/pisocamp/pisocamp.module.ts `
  apps/backend/src/modules/v1/pisocamp/analytics/analytics.authorization.spec.ts `
  apps/backend/src/modules/v1/pisocamp/analytics/analytics.controller.spec.ts `
  apps/backend/src/modules/v1/pisocamp/analytics/analytics.controller.ts `
  apps/backend/src/modules/v1/pisocamp/analytics/analytics.idempotency.spec.ts `
  apps/backend/src/modules/v1/pisocamp/analytics/analytics.module.ts `
  apps/backend/src/modules/v1/pisocamp/analytics/analytics.service.spec.ts `
  apps/backend/src/modules/v1/pisocamp/analytics/analytics.service.ts `
  apps/backend/test/analytics.e2e-spec.ts `
  apps/mobile/lib/core/constants/api_constants.dart `
  apps/mobile/lib/core/constants/sentry_constants.dart `
  apps/mobile/lib/core/utils/uuid_v4.dart `
  apps/mobile/lib/features/pisocamp/data/analytics_event.dart `
  apps/mobile/lib/features/pisocamp/data/analytics_repository.dart `
  apps/mobile/lib/features/pisocamp/data/analytics_sync_controller.dart `
  apps/mobile/lib/features/pisocamp/data/consent_service.dart `
  apps/mobile/lib/features/pisocamp/data/encrypted_analytics_queue.dart `
  apps/mobile/lib/features/pisocamp/presentation/providers/analytics_provider.dart `
  apps/mobile/lib/features/pisocamp/presentation/providers/currency_catalog_provider.dart `
  apps/mobile/lib/features/pisocamp/presentation/providers/pisocamp_registration_provider.dart `
  apps/mobile/lib/features/pisocamp/presentation/screens/currency_detail_screen.dart `
  apps/mobile/lib/features/pisocamp/presentation/screens/pisocamp_home_screen.dart `
  apps/mobile/lib/features/pisocamp/presentation/widgets/account_prompt.dart `
  apps/mobile/pubspec.lock `
  apps/mobile/pubspec.yaml `
  apps/mobile/test/core/utils/uuid_v4_test.dart `
  apps/mobile/test/features/pisocamp/data/analytics_event_test.dart `
  apps/mobile/test/features/pisocamp/data/analytics_repository_test.dart `
  apps/mobile/test/features/pisocamp/data/analytics_sync_controller_test.dart `
  apps/mobile/test/features/pisocamp/data/encrypted_analytics_queue_test.dart `
  apps/mobile/test/features/pisocamp/presentation/analytics_provider_test.dart `
  apps/mobile/test/features/pisocamp/presentation/currency_catalog_provider_test.dart `
  apps/mobile/test/features/pisocamp/presentation/currency_screens_test.dart `
  apps/mobile/test/features/pisocamp/presentation/pisocamp_home_screen_test.dart `
  apps/web/features/analytics/api/analytics.hooks.test.tsx `
  apps/web/features/analytics/api/analytics.hooks.ts `
  apps/web/features/analytics/components/module-entry-today-tile.test.tsx `
  apps/web/features/analytics/components/module-entry-today-tile.tsx `
  apps/web/features/dashboard/components/dashboard-overview.test.tsx `
  apps/web/features/dashboard/components/dashboard-overview.tsx `
  docs/analytics-events.md `
  docs/pisocamp/an-1-acceptance-evidence.md `
  docs/superpowers/plans/2026-08-30-an-1-analytics-event-pipeline.md `
  docs/superpowers/specs/2026-08-30-an-1-analytics-event-pipeline-design.md `
  packages/auth/src/config.ts `
  packages/contracts/src/contracts.ts `
  packages/contracts/src/modules/v1/pisocamp/analytics.contract.ts `
  packages/contracts/src/modules/v1/pisocamp/analytics.schema.test.ts `
  packages/contracts/src/modules/v1/pisocamp/analytics.schema.ts `
  packages/contracts/src/modules/v1/pisocamp/fixtures/an1-event-vectors.json `
  packages/contracts/src/modules/v1/pisocamp/pisocamp.contract.ts `
  packages/db/src/analytics-migration.spec.ts `
  packages/db/src/bundle-migration.spec.ts `
  packages/db/src/migrations/20260830120000_an1_analytics_event_pipeline/migration.sql `
  packages/db/src/migrations/20260830120000_an1_analytics_event_pipeline/snapshot.json `
  packages/db/src/schema.spec.ts `
  packages/db/src/schema.ts `
  packages/e2e-web/tests/an1-dashboard.authenticated.spec.ts
git diff --cached --check
git diff --cached --stat
git diff --cached --name-status
```

Inspect every staged path and the full staged patch. The ignored progress ledger and local browser/device artifacts must not be staged. Any unrelated file fails this step and must be unstaged without discarding the user's work.

- [ ] **Step 4: Commit once, locally**

Only after all evidence rows and gates are PASS:

```powershell
git commit -m "AN-1: add idempotent offline analytics pipeline"
git show --stat --oneline --decorate HEAD
git status --short
```

Expected: exactly one new AN-1 commit, no tracked AN-1 changes remain, unrelated pre-existing work is preserved, and no push/PR/branch operation occurred.

- [ ] **Step 5: Record final local state outside the commit**

Update the ignored progress ledger with the commit hash, final test counts, evidence hash, and PASS. Verify `git log -1 --format='%H %s'`, local branch name remains `dev`, and origin has not been contacted. Inspect the exact `pisocamp-an1-postgres` container identity, stop that container, and leave it stopped but recoverable; do not remove its container or volume.
