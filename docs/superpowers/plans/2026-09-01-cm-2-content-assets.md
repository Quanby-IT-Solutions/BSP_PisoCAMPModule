# CM-2 Governed Content Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authorized Content Administrators upload validated image, audio, 3D, and AR assets, preserve their checksummed references in immutable content versions, and manage those attachments from the draft editor.

**Architecture:** A bounded NestJS interceptor prepares multipart uploads before the oRPC adapter reads them, while a reusable idempotency service executes the upload transaction against server-computed metadata. PostgreSQL stores deduplicated immutable objects, logical asset metadata, and same-item version-role references; every asset mutation creates a new draft snapshot. The Next.js editor uses the shared contracts and TanStack Query to expose accessible attach, detach, and logical-delete workflows.

**Tech Stack:** TypeScript 5.9, Zod 4, oRPC 1.13, NestJS 11, Multer 2/Busboy, Drizzle ORM 1/PostgreSQL 16, Next.js 16/React 19, TanStack Query 5, Tailwind CSS 4/shadcn, Vitest, Jest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-01-cm-2-content-assets-design.md`

## Global constraints

- CM-2 depends on CM-1; commits `def204a`, `5948d9a`, `af77a63`, and `19f963e` already supply CM-1, CM-3, CE-1, and AN-1.
- Work in the current checkout only. Do not create a branch, worktree, pull request, or push.
- Preserve the unrelated unstaged `packages/auth/src/index.ts`; never stage or rewrite it.
- Use one final local commit only: `CM-2: add governed content asset uploads`. Task checkpoints go in the ignored `.superpowers/sdd/2026-09-01-cm-2-content-assets/progress.md` ledger.
- Follow strict red-green-refactor. Record every intended failing test and its later passing command in the ledger.
- `content_version` and its `version_asset` references are immutable. Every attach/detach/delete operation creates a new draft snapshot.
- Store timestamps in UTC; do not log/audit bytes, filenames, temporary paths, credentials, cookies, session material, or content bodies.
- Canonical formats and caps are fixed by the spec: PNG/JPEG/WebP 10 MiB, MP3/AAC 25 MiB, GLB/GLTF/USDZ 50 MiB; image dimensions at most 8192 × 8192.
- Roles are exactly `obverse | reverse | edge | texture | audio | animation`; the database permits one asset per role per content version.
- `content.assets.upload` protects list, upload, attach, detach, and delete. The shared RBAC guard must run before multipart parsing and must persist permission denials.
- Upload retries use the existing author-scoped idempotency table and advisory lock through one extracted service; do not create a second cache/lock implementation.
- Asset deletion is a tombstone. Any published-version reference blocks it; historical non-published references and object bytes remain resolvable.
- No public asset download, bundle delivery, mobile rendering, preview renderer, S3 integration, or physical garbage collector belongs in CM-2.
- Application code must use direct imports, kebab-case TypeScript filenames, co-located types, and no application barrel files.

## File map

### Shared contracts

- Create `packages/contracts/src/modules/v1/pisocamp/asset.schema.ts`: constants, MIME/role policy, request/response schemas, inferred types.
- Create `packages/contracts/src/modules/v1/pisocamp/asset.schema.test.ts`: exact input/output, coercion, media-role, and multipart `File` tests.
- Create `packages/contracts/src/modules/v1/pisocamp/asset.contract.ts`: list/upload/attach/detach/delete routes.
- Create `packages/contracts/src/modules/v1/pisocamp/asset.contract.test.ts`: exact route-method/path/security metadata tests.
- Modify `packages/contracts/src/modules/v1/pisocamp/pisocamp.contract.ts`: mount the asset router at `pisocamp.admin.assets`.
- Modify `packages/contracts/src/contracts.ts`: export the asset contract, schemas, constants, and inferred types.

### Database

- Modify `packages/db/src/schema.ts`: define `asset_object`, `asset`, `version_asset`, indexes, constraints, and relations.
- Create `packages/db/src/content-assets-migration.spec.ts`: isolated additive migration and constraint/trigger proof.
- Create `packages/db/src/migrations/20260901090000_cm2_content_assets/migration.sql`: generated additive SQL plus immutable-row triggers.
- Create `packages/db/src/migrations/20260901090000_cm2_content_assets/snapshot.json`: Drizzle-generated snapshot.

### Backend shared infrastructure

- Create `apps/backend/src/shared/interceptors/idempotency.service.ts`: reusable author-scoped lock/cache execution.
- Create `apps/backend/src/shared/interceptors/idempotency.service.spec.ts`: exact replay, mismatch, race, expiry, and rollback tests.
- Modify `apps/backend/src/shared/interceptors/idempotency.interceptor.ts`: delegate persistence/locking to `IdempotencyService` without changing current route behavior.
- Modify `apps/backend/src/shared/interceptors/idempotency.spec.ts` and focused existing idempotency integration specs: regression coverage for the extraction.
- Modify `apps/backend/src/app.module.ts`: provide/export the shared idempotency service at the existing application scope if required by Nest injection.

### Backend asset subsystem

- Create `apps/backend/src/modules/v1/pisocamp/assets/asset-file-policy.ts`: byte/structure sniffing, canonical MIME, size and role validation.
- Create `apps/backend/src/modules/v1/pisocamp/assets/asset-file-policy.spec.ts`: valid and adversarial format fixtures.
- Create `apps/backend/src/modules/v1/pisocamp/assets/asset-upload.interceptor.ts`: guarded bounded multipart parsing, private temporary files, canonical `File` handoff, cleanup.
- Create `apps/backend/src/modules/v1/pisocamp/assets/asset-upload.interceptor.spec.ts`: parser limits, ordering seam, abort/error cleanup, safe errors.
- Create `apps/backend/src/modules/v1/pisocamp/assets/asset-object-store.ts`: PostgreSQL content-addressed immutable object store.
- Create `apps/backend/src/modules/v1/pisocamp/assets/asset-object-store.spec.ts`: digest, dedupe, corruption, limit, and transaction tests.
- Create `apps/backend/src/modules/v1/pisocamp/assets/version-assets.ts`: select/copy/replace/remove helpers used by content, workflow, and asset services.
- Create `apps/backend/src/modules/v1/pisocamp/assets/assets.service.ts`: transactional query/upload/attach/detach/delete operations.
- Create `apps/backend/src/modules/v1/pisocamp/assets/assets.service.spec.ts`: real-PostgreSQL lifecycle, concurrency, audit, and idempotency tests.
- Create `apps/backend/src/modules/v1/pisocamp/assets/assets.controller.ts`: permissions, oRPC handlers, bounded upload preparation, safe error mapping.
- Create `apps/backend/src/modules/v1/pisocamp/assets/assets.controller.spec.ts`: route wiring and unit permission/control assertions.
- Create `apps/backend/src/modules/v1/pisocamp/assets/assets.authorization.spec.ts`: authorized, denied-audited, deactivated, and parser-order integration.
- Create `apps/backend/src/modules/v1/pisocamp/assets/assets.module.ts`: focused controller/provider wiring.
- Modify `apps/backend/src/modules/v1/pisocamp/pisocamp.module.ts`: import `AssetsModule`.
- Modify `apps/backend/src/modules/v1/pisocamp/content/content.service.ts`: copy exact attachments during CM-1 edits.
- Modify `apps/backend/src/modules/v1/pisocamp/content/content-workflow.service.ts`: copy exact attachments during all CM-3 transitions.
- Modify their focused specs to prove role/asset identity preservation.
- Modify `apps/backend/package.json` and `pnpm-lock.yaml`: declare `multer` and `@types/multer` directly.

### Proxy and web admin

- Modify `nginx/nginx.conf` and `nginx/nginx.dev.conf`: exact 51 MiB upload-route location while preserving 1 MiB elsewhere.
- Create `apps/backend/src/config/asset-upload-limits.spec.ts`: static proxy-scope and direct-backend parser-limit proof.
- Create `apps/web/features/pisocamp-content-admin/api/assets.hooks.ts`: typed queries/mutations and cache invalidation.
- Create `apps/web/features/pisocamp-content-admin/api/assets.hooks.test.tsx`: transport/header/query-cache tests.
- Create `apps/web/features/pisocamp-content-admin/components/asset-attachments-editor.tsx`: accessible role/file/attachment controls.
- Create `apps/web/features/pisocamp-content-admin/components/asset-attachments-editor.test.tsx`: permission, dirty-state, failures, focus, confirmation, and reflow tests.
- Modify `apps/web/features/pisocamp-content-admin/components/content-form-view.tsx` and its test: mount the asset editor and synchronize version state.
- Modify `apps/web/app/(site)/pisocamp/content/[itemId]/edit/page.tsx` and its test: pass the exact `canManageAssets` capability.
- Create `packages/e2e-web/tests/cm2-assets.authenticated.spec.ts`: real-session production-build browser acceptance.
- Create `docs/pisocamp/cm-2-acceptance-evidence.md`: criterion-by-criterion evidence and final gate record.

---

### Task 1: Freeze the shared asset protocol

**Files:** shared-contract files listed above.

**Interfaces:**

- Consumes: existing `oc` contract builder, UUID conventions, global `/v1` prefix, and `PisoCampContentItemIdSchema` patterns.
- Produces: `PISO_CAMP_ASSET_ROLES`, `PISO_CAMP_ASSET_MEDIA_TYPES`, `PisoCampAssetRole`, `PisoCampAsset`, `PisoCampVersionAsset`, `ListPisoCampAssetsOutput`, all mutation inputs/outputs, and `pisoCampAssetContract` mounted as `v1.pisocamp.admin.assets`.

- [ ] **Step 1: Write failing schema tests for exact roles, safe metadata, coercion, and file input**

```ts
const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "ignored.png", {
	type: "application/octet-stream",
})

expect(
	UploadPisoCampAssetInputSchema.parse({
		file,
		itemId,
		expectedVersionNo: "7",
		role: "obverse",
		requestId,
	})
).toMatchObject({ file, itemId, expectedVersionNo: 7, role: "obverse", requestId })

expect(PisoCampAssetRoleSchema.safeParse("thumbnail").success).toBe(false)
expect(() => PisoCampAssetSchema.parse({ ...asset, originalFilename: "private.png" })).toThrow()
```

- [ ] **Step 2: Run the contract tests and record the intended RED**

Run: `pnpm --filter @repo/contracts exec vitest run src/modules/v1/pisocamp/asset.schema.test.ts src/modules/v1/pisocamp/asset.contract.test.ts`

Expected: FAIL because the CM-2 schemas and contract do not exist.

- [ ] **Step 3: Implement strict schemas and inferred types**

```ts
export const PISO_CAMP_ASSET_ROLES = [
	"obverse",
	"reverse",
	"edge",
	"texture",
	"audio",
	"animation",
] as const

export const PISO_CAMP_ASSET_MEDIA_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"audio/mpeg",
	"audio/aac",
	"model/gltf-binary",
	"model/gltf+json",
	"model/vnd.usdz+zip",
] as const

export const UploadPisoCampAssetInputSchema = z
	.object({
		file: z.file().min(1).max(52_428_800),
		itemId: z.uuid(),
		expectedVersionNo: z.coerce.number().int().positive(),
		role: PisoCampAssetRoleSchema,
		requestId: z.uuid(),
	})
	.strict()
```

Define strict metadata/output schemas with UTC `Z` timestamps, lowercase SHA-256, positive version, and no filename/path/body fields. Mutation outputs must contain `{ asset, currentVersionId, currentVersionNo, attachments }`; list output must contain `{ currentVersionId, currentVersionNo, attachments, available }`.

- [ ] **Step 4: Define and mount exact routes**

```ts
export const pisoCampAssetContract = {
	list: oc.route({ method: "GET", path: "/admin/pisocamp/content/{itemId}/assets" }),
	upload: oc.route({ method: "POST", path: "/admin/pisocamp/assets" }),
	attach: oc.route({ method: "POST", path: "/admin/pisocamp/assets/{assetId}/attach" }),
	detach: oc.route({ method: "POST", path: "/admin/pisocamp/assets/{assetId}/detach" }),
	delete: oc.route({ method: "DELETE", path: "/admin/pisocamp/assets/{assetId}" }),
}
```

Attach each exact input/output schema, use the `Piso CAMP Content Assets` tag, and do not set `security: []`.

- [ ] **Step 5: Run contract test, type, lint, and format gates**

Run:

```powershell
pnpm --filter @repo/contracts exec vitest run src/modules/v1/pisocamp/asset.schema.test.ts src/modules/v1/pisocamp/asset.contract.test.ts
pnpm --filter @repo/contracts typecheck
pnpm --filter @repo/contracts lint
pnpm --filter @repo/contracts format
```

Expected: all pass with no warnings from touched files. Record Task 1 PASS; do not commit.

### Task 2: Add the immutable PostgreSQL asset model

**Files:** database files listed above.

**Interfaces:**

- Consumes: `contentItems`, `contentVersions`, `users`, `bytea`, the existing `(itemId,id)` version uniqueness, and additive Drizzle migration conventions.
- Produces: exported `assetObjects`, `assets`, and `versionAssets` tables with same-item integrity and immutable history.

- [ ] **Step 1: Write the failing isolated migration test**

Create a fresh-database test that first checks there is exactly one named CM-2 migration after AN-1, migrates twice, seeds two users/items/versions, then exercises these assertions:

```ts
await expectRejected(activePool, crossItemAttachmentSql, "version_asset_asset_item_fkey")
await expectRejected(activePool, duplicateRoleSql, "version_asset_pkey")
await expectRejected(activePool, badDigestSql, "asset_object_sha256_check")
await expectRejected(activePool, mismatchedBodySql, "asset_object_body_length_check")
await expectRejected(activePool, halfTombstoneSql, "asset_deletion_pair_check")
await expectRejected(activePool, updateObjectSql, /immutable asset_object/i)
await expectRejected(activePool, deleteVersionAssetSql, /immutable version_asset/i)
```

Also prove all eight canonical MIME values, all six roles, byte boundary 1/52,428,800, positive asset version, indexes, and restrictive published references.

- [ ] **Step 2: Run the migration test and record RED**

Run: `pnpm --filter @repo/db exec vitest run src/content-assets-migration.spec.ts`

Expected: FAIL because the migration and tables do not exist. PostgreSQL unavailability is not an accepted PASS for final evidence.

- [ ] **Step 3: Define Drizzle tables, constraints, indexes, and relations**

```ts
export const versionAssets = createTable(
	"version_asset",
	t => ({
		contentItemId: t.uuid("content_item_id").notNull(),
		contentVersionId: t.uuid("content_version_id").notNull(),
		assetId: t.uuid("asset_id").notNull(),
		role: t.text("role").notNull().$type<PisoCampAssetRole>(),
	}),
	t => [
		primaryKey({ columns: [t.contentVersionId, t.role] }),
		foreignKey({
			columns: [t.contentItemId, t.contentVersionId],
			foreignColumns: [contentVersions.itemId, contentVersions.id],
			name: "version_asset_content_item_version_fkey",
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.contentItemId, t.assetId],
			foreignColumns: [assets.contentItemId, assets.id],
			name: "version_asset_asset_item_fkey",
		}).onDelete("restrict"),
	]
)
```

Add the object metadata composite key/FK, MIME/role/size/checksum/tombstone checks, lookup indexes, relations, and schema registry entries. Metadata FKs and delete actions must be restrictive.

- [ ] **Step 4: Generate the additive migration and add immutable triggers**

Run: `pnpm --filter @repo/db generate --name cm2_content_assets`

Keep exactly the generated CM-2 directory and verify it corresponds to `20260901090000_cm2_content_assets`; if Drizzle emits a different timestamp, update the migration test constant and this plan's execution ledger to the generated name rather than hand-editing the snapshot. Add SQL functions/triggers that reject `asset_object` update/delete, `version_asset` update/delete, and asset metadata mutation while allowing the one-way null/null → timestamp/user tombstone transition.

- [ ] **Step 5: Prove migration, schema, build, and formatting GREEN**

Run:

```powershell
pnpm --filter @repo/db exec vitest run src/content-assets-migration.spec.ts src/schema.spec.ts src/content-migration.spec.ts src/content-workflow-migration.spec.ts
pnpm --filter @repo/db typecheck
pnpm --filter @repo/db lint
pnpm --filter @repo/db format
pnpm --filter @repo/db build
```

Expected: all execute against real PostgreSQL and pass. Record Task 2 PASS; do not commit.

### Task 3: Extract reusable idempotent execution without regressions

**Files:** backend shared idempotency files listed above.

**Interfaces:**

- Consumes: `idempotencyKeys`, `databaseTransactionContext`, `IDEMPOTENCY_TTL_MS`, current canonicalization and author-scoped advisory-lock semantics.
- Produces:

```ts
export interface IdempotentOperation<T> {
	authorId: string
	key: string
	method: string
	path: string
	input: unknown
	run: () => Promise<T>
}

@Injectable()
export class IdempotencyService {
	execute<T>(operation: IdempotentOperation<T>): Promise<T>
}

export function requireMatchingRequestId(rawKey: string | string[] | undefined, requestId: string): string
```

- [ ] **Step 1: Write failing service tests**

Test exact replay, same key/different fingerprint conflict, expired-row replacement, two-user key isolation, concurrent duplicate serialization, transaction rollback when response persistence fails, UUID/header matching, and a fingerprint input containing `{ fileSha256, itemId, expectedVersionNo, role, requestId }`.

```ts
await expect(
	service.execute({ authorId, key, method: "POST", path: uploadPath, input, run })
).resolves.toEqual(response)
expect(run).toHaveBeenCalledTimes(1)
```

- [ ] **Step 2: Run service and interceptor tests for RED**

Run: `pnpm --filter @repo/backend exec jest --runInBand --runTestsByPath src/shared/interceptors/idempotency.service.spec.ts src/shared/interceptors/idempotency.spec.ts`

Expected: the new service spec fails because the service does not exist; existing interceptor tests remain a baseline.

- [ ] **Step 3: Move canonical fingerprint and lock/cache execution into `IdempotencyService`**

Keep canonical sorting, operation method/path binding, author+key advisory locks, unexpired replay, fingerprint mismatch conflict, TTL, and in-transaction response persistence byte-for-byte equivalent. `requireMatchingRequestId` must reject missing, array, non-UUID, or nonmatching keys using the same safe messages as current required routes.

- [ ] **Step 4: Inject the service into `IdempotencyInterceptor`**

The interceptor remains responsible for Nest metadata, session/guest author resolution, active-account checks, and wrapping procedures. Replace only its private lock/cache implementation with `idempotencyService.execute(...)`. Update direct-construction tests to provide the service; do not weaken any existing idempotency integration test.

- [ ] **Step 5: Run all idempotency regression suites and backend gates**

Run the shared spec plus profile, consent, config, content, workflow, and analytics idempotency specs with direct Jest. Then run backend typecheck, lint, and format. Expected: all pass and current APIs retain identical behavior. Record Task 3 PASS; do not commit.

### Task 4: Build bounded file validation and immutable object storage

**Files:** asset file-policy, upload-interceptor, object-store, package manifest, and their specs.

**Interfaces:**

- Produces:

```ts
export interface PreparedAssetUpload {
	file: File
	bytes: Buffer
	sha256: string
	mediaType: PisoCampAssetMediaType
	byteLength: number
}

export async function prepareAssetUpload(path: string, role: PisoCampAssetRole): Promise<PreparedAssetUpload>

export class PostgresAssetObjectStore {
	putVerified(database: ContentDatabase, input: PreparedAssetUpload): Promise<StoredAssetObject>
	readByDigest(database: ContentDatabase, sha256: string): Promise<StoredAssetObject | null>
}
```

- [ ] **Step 1: Write failing byte-policy tests with generated local fixtures**

Construct minimal valid fixture bytes in the spec itself for PNG, JPEG, WebP, framed MP3, ADTS AAC, GLB 2, self-contained GLTF 2, and safe USDZ. Assert canonical MIME, digest, byte length, and allowed role. Add malformed/truncated signatures, MIME/extension spoofing, empty files, 8193-pixel image dimension, GLB length mismatch, external/absolute/traversal GLTF URIs, generic ZIP, USDZ traversal, polyglot, category boundary +1, and wrong-role cases.

- [ ] **Step 2: Run file-policy tests and record RED**

Run: `pnpm --filter @repo/backend exec jest --runInBand --runTestsByPath src/modules/v1/pisocamp/assets/asset-file-policy.spec.ts`

Expected: FAIL because the policy is absent.

- [ ] **Step 3: Implement content/structure validators**

Use fixed signatures plus bounded structural reads. Normalize to only the eight canonical MIME values. Parse GLTF JSON with exact 2.x version and walk `buffers[].uri`/`images[].uri`; accept embedded `data:` only. Validate ZIP central-directory names and compression method for USDZ. Never shell out, resolve an author path, or trust submitted MIME/name.

- [ ] **Step 4: Write RED object-store and interceptor specs**

Object-store tests must prove server digest recomputation, `onConflictDoNothing` dedupe, persisted read-back verification, corruption detection, and transaction rollback. Interceptor tests must prove one file/six-field/1 KiB field/50 MiB limits, random private paths, prepared `request.body.file`, metadata on the request, guard-compatible Nest interceptor placement, and cleanup on success, validation failure, downstream error, and abort.

- [ ] **Step 5: Implement the store and bounded interceptor**

Declare `multer` as a runtime dependency and `@types/multer` as a dev dependency. The interceptor must invoke Multer only from its Nest `intercept` method, use an attacker-independent temp root and random name, await `prepareAssetUpload`, assign the canonical `File` to `request.body.file`, retain safe `PreparedAssetUpload` metadata on the request for the controller, delete the disk file before calling `next.handle()`, and map size/shape errors to safe 400/413 responses.

- [ ] **Step 6: Run focused GREEN and dependency hygiene**

Run file-policy, interceptor, and store specs; backend typecheck/lint/format; `pnpm lint:ws`; and `git diff --check`. Scan test output for temp paths or filenames. Record Task 4 PASS; do not commit.

### Task 5: Implement asset transactions and immutable reference propagation

**Files:** backend asset module/service/controller/helpers and content/workflow modifications listed above.

**Interfaces:**

- Consumes: Task 1 contracts, Task 2 tables, Task 3 `IdempotencyService`, Task 4 prepared upload/store, `AuditService`, and `databaseTransactionContext`.
- Produces: `AssetsService.list`, `upload`, `attach`, `detach`, `delete`; `copyVersionAssets`; and all protected oRPC endpoints.

- [ ] **Step 1: Write RED integration tests for the complete lifecycle**

Against real PostgreSQL, create a draft and assert:

```ts
const uploaded = await service.upload(prepared, input, actorId)
expect(uploaded.currentVersionNo).toBe(2)
expect(uploaded.attachments).toMatchObject([{ role: "obverse", asset: { sha256 } }])

const rows = await db.select().from(versionAssets)
expect(rows).toContainEqual(
	expect.objectContaining({ contentVersionId: uploaded.currentVersionId, assetId: uploaded.asset.id })
)
```

Cover object dedupe, occupied role, wrong kind, cross-item asset, deleted asset, stale version, non-draft states, exact reattach/detach, logical delete, published-reference delete 409 with unchanged rows, metadata-only audits, response-loss retry, key mismatch, and rollback on audit/object/version failure.

- [ ] **Step 2: Run service tests and record RED**

Run: `pnpm --filter @repo/backend exec jest --runInBand --runTestsByPath src/modules/v1/pisocamp/assets/assets.service.spec.ts`

Expected: FAIL because service/helpers do not exist.

- [ ] **Step 3: Implement shared version-asset query/copy helpers**

```ts
export async function copyVersionAssets(
	tx: DatabaseTransaction,
	input: {
		contentItemId: string
		sourceVersionId: string
		targetVersionId: string
		excludeRole?: PisoCampAssetRole
		add?: { assetId: string; role: PisoCampAssetRole }
	}
): Promise<void>
```

Select in stable role order, insert unchanged exact asset ids, omit only `excludeRole`, and append only a validated same-item non-deleted asset. Provide mapping functions returning safe contract metadata.

- [ ] **Step 4: Implement transactional service operations**

Centralize item/current-version `FOR UPDATE`, draft-state, and expected-version checks. Centralize snapshot creation so content fields, links, and attachments are copied once. Upload must `putVerified`, insert version-1 asset, create snapshot, attach, advance item, audit, and return from the transaction. Attach/detach/delete use the same snapshot path. Deletion queries all referenced `contentVersions.status`; published wins before any tombstone or snapshot mutation.

- [ ] **Step 5: Preserve attachments through existing CM-1/CM-3 version paths**

Call `copyVersionAssets` immediately after every successful new-version insert in `ContentService.update` and `ContentWorkflowService.transition`. Create regression tests for edit, submit, approve, reject, and publish that compare source and target `(role,assetId)` sets exactly. Create/first-version paths correctly start with no attachments.

- [ ] **Step 6: Implement protected controllers and module wiring**

```ts
@StrictThrottle()
@RequirePermissions("content.assets.upload")
@UseInterceptors(AssetUploadInterceptor)
@Implement(v1.pisocamp.admin.assets.upload)
async upload(@Session() session: UserSession, @Req() request: PreparedAssetRequest) {
	return implement(v1.pisocamp.admin.assets.upload).handler(({ input }) =>
		this.assetUploadWithIdempotency(session.user.id, request, input)
	)
}
```

Inside `assetUploadWithIdempotency`, require header/request-id equality and call `IdempotencyService.execute` with safe fingerprint input `{ fileSha256, itemId, expectedVersionNo, role, requestId }`. JSON mutations use the existing required-idempotency decorator/interceptor. Every handler uses safe error mapping and the exact permission.

- [ ] **Step 7: Prove permission ordering and all service/controller GREEN**

Run asset service/controller/authorization tests plus content/workflow regression suites. The authorization integration must assert denied 403 + audit and zero temp/object/asset/version rows; deactivated 401 must occur before permission resolution; allowed upload must create one success audit. Run backend typecheck/lint/format/build. Record Task 5 PASS; do not commit.

### Task 6: Add the accessible draft asset editor

**Files:** web hooks/components/page files listed above.

**Interfaces:**

- Consumes: `contractClient.pisocamp.admin.assets`, content query keys, `PisoCampAssetMutationOutput`, page access helpers.
- Produces: `usePisoCampAssetsQuery`, four mutations, `AssetAttachmentsEditor`, `canManageAssets`, and version synchronization callback.

- [ ] **Step 1: Write RED hook and page-capability tests**

Assert upload sends `File` plus `Idempotency-Key = requestId`, every success invalidates asset and content keys, mutation errors remain observable, and the edit page independently maps `content.assets.upload` to `canManageAssets` while still requiring `content.items.edit` for page access.

- [ ] **Step 2: Run the focused tests and record RED**

Run: `pnpm --filter @repo/web exec vitest run features/pisocamp-content-admin/api/assets.hooks.test.tsx 'app/(site)/pisocamp/content/[itemId]/edit/page.test.tsx'`

Expected: FAIL because hooks/capability do not exist.

- [ ] **Step 3: Implement typed hooks with exact cache ownership**

```ts
export function useUploadPisoCampAssetMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: UploadPisoCampAssetInput) =>
			contractClient.pisocamp.admin.assets.upload(input, {
				context: { headers: { "Idempotency-Key": input.requestId } },
			}),
		onSuccess: result => invalidateAssetAndContentQueries(queryClient, result.asset.contentItemId),
	})
}
```

Use one internal invalidation function in the same file; do not create a barrel or type-only file.

- [ ] **Step 4: Write RED component tests**

Cover exact labels/guidance, role choices, no controls without permission, dirty-form lock explanation, file selection, pending `aria-live`, server 400/413/409 messages, retained role after error, mutation success/version callback, stale reload action, keyboard order, focus after error, and confirmed detach/delete. Assert the root uses `min-w-0`, wrapping metadata, and no fixed width exceeding 320 px.

- [ ] **Step 5: Implement `AssetAttachmentsEditor` and integrate it**

The component receives `{ itemId, expectedVersionNo, canManageAssets, contentDirty, onVersionChanged }`. Use native labelled file input, shadcn fields/select/buttons/alerts/dialogs, accepted extensions as a hint, exact server policy text, safe checksum display, 44 px controls, and no image/model rendering. Disable controls while text is dirty or any mutation is pending. On success, update `ContentFormView`'s version number and reload/invalidate detail before allowing another mutation.

- [ ] **Step 6: Run UI GREEN and accessibility-focused gates**

Run hooks, component, form, page, and repository hygiene tests; web typecheck/lint/format/build. Treat React act warnings, hydration warnings, failed mocked requests, and accessibility warnings as failures. Record Task 6 PASS; do not commit.

### Task 7: Scope proxy limits and prove cross-layer failure behavior

**Files:** Nginx configs, proxy/parser spec, backend authorization/idempotency integration, and E2E fixture.

**Interfaces:**

- Consumes: exact upload URI and existing proxy headers/timeouts.
- Produces: a route-specific 51 MiB envelope only for the upload endpoint and full failure/idempotency evidence.

- [ ] **Step 1: Write RED configuration tests**

Read both Nginx files and assert one exact upload location precedes `/api/`, contains `client_max_body_size 51m`, forwards the same Host/X-Real-IP/X-Forwarded-For/X-Forwarded-Proto headers, and the server/default `/api/` scope remains 1 MiB. Exercise direct Nest upload with 50 MiB+1 and multipart field-count/size violations to prove 413/400 without relying on Nginx.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @repo/backend exec jest --runInBand --runTestsByPath src/config/asset-upload-limits.spec.ts src/modules/v1/pisocamp/assets/assets.authorization.spec.ts`

Expected: exact route limit test fails before config changes.

- [ ] **Step 3: Add exact locations without weakening global limits**

In production and dev configs, add `location = /api/v1/admin/pisocamp/assets` before `location /api/`, set `client_max_body_size 51m`, and duplicate only the existing backend proxy/header directives. Keep server-scope `client_max_body_size 1m`, body/header timeouts, and X-Forwarded-For overwrite unchanged.

- [ ] **Step 4: Extend integration tests for retry and logs**

Simulate timeout/response loss after committed upload, resend exact input, and assert one asset/object/new version/attachment/upload audit/idempotency row with byte-identical response. Reuse the key with different bytes and assert 409 with no second mutation. Capture logger output for spoof, oversize, denied, internal rollback, and success; assert no byte sentinel, filename, temp path, cookie, session token, password, or stack trace appears in public responses/logs.

- [ ] **Step 5: Run GREEN and static security scans**

Run proxy/parser, authorization, service, idempotency, content workflow, and bundle regression suites. Run `rg` checks for `console.`, raw request logging, filename persistence, world-readable upload directories, and unbounded multipart parsing in touched code. Record Task 7 PASS; do not commit.

### Task 8: Full acceptance, independent review, evidence, and single commit gate

**Files:** E2E test, evidence document, ignored ledger, and all CM-2 changes.

**Interfaces:**

- Consumes: completed Tasks 1–7 and production-like local services.
- Produces: criterion-level proof, clean review, and one local CM-2 commit.

- [ ] **Step 1: Create the real-session Playwright scenario**

Seed a Content Administrator with `content.items.edit`, `content.items.submit`, and `content.assets.upload`; a content editor lacking upload permission; and a publish-capable approver. Use production backend/web builds and real Better Auth cookies. The scenario must exercise keyboard-only asset upload/attach/detach/delete, one valid file from every media family, spoof and oversize messages, dirty-state lock, stale version, exact retry, publish then blocked delete, and the denied role with its audit row.

- [ ] **Step 2: Capture browser, network, accessibility, and server evidence**

Require zero unexpected console errors/warnings, page errors, failed requests, unhandled rejections, or backend error/warn lines from the touched flow. Assert labels, descriptions, live status, focus restoration, destructive confirmations, 44 px targets, non-color messages, logical tab order, and no horizontal overflow at 320×720 and desktop. Store screenshots/traces under the ignored ledger directory and record SHA-256 hashes, not user secrets, in the evidence document.

- [ ] **Step 3: Run the complete affected and repository gates**

Run:

```powershell
pnpm --filter @repo/contracts test
pnpm --filter @repo/db test
pnpm --filter @repo/backend exec jest --runInBand
pnpm --filter @repo/web test
pnpm --filter @repo/e2e-web test:e2e -- cm2-assets.authenticated.spec.ts
pnpm typecheck
pnpm lint
pnpm format
pnpm lint:ws
pnpm build
git diff --check
```

Any pre-existing unrelated failure must be reproduced at `19f963e`, bounded with exact unchanged evidence, and reviewed before it can be classified non-blocking. A touched-area warning or failure is always blocking.

- [ ] **Step 4: Write criterion-by-criterion evidence**

In `docs/pisocamp/cm-2-acceptance-evidence.md`, map each of the five acceptance criteria to source files, exact automated/runtime commands, database/audit rows, browser/network/log evidence, hashes, and PASS/PARTIAL/BLOCKED/FAIL. Include format/limit matrix, permission branches, deletion block, idempotency/failure branches, accessibility, dependency confirmation, changed-file inventory, and explicit out-of-scope confirmation.

- [ ] **Step 5: Obtain two-stage independent review and close findings**

First review specification compliance: every ticket/spec requirement and forbidden scope. Second review code quality/security: bounded parsing, transactionality, immutable history, authorization ordering, idempotency, logging, accessibility, and tests. Classify findings Critical/Important/Minor, fix all Critical/Important findings with new RED/GREEN evidence, and rerun affected plus final gates. Record reviewer verdict and residual Minor findings.

- [ ] **Step 6: Present the foundational pre-commit checkpoint**

CM-2 is a dependency of CM-5, CE-2, AR-2, and later delivery/rendering work. Show the user the plan outcome, complete evidence, reviewer verdict, exact staged file list, and proposed commit; pause for review before committing as required by the foundational-ticket rule.

- [ ] **Step 7: Stage only CM-2 and create the one local commit after approval**

Verify `packages/auth/src/index.ts` is excluded. Stage explicit CM-2 paths rather than `git add -A`, inspect `git diff --cached --check`, `git diff --cached --stat`, and the cached diff, then commit:

```powershell
git commit -m "CM-2: add governed content asset uploads"
```

Confirm one new local commit, a clean CM-2 path set, the unrelated auth state preserved, no push/branch/PR, and update the running ticket log before beginning CM-5.
