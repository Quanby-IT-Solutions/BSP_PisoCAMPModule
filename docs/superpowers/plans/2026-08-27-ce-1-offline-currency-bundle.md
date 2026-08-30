# CE-1 Offline Currency Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every production behavior follows superpowers:test-driven-development RED/GREEN/REFACTOR. Use the project full-stack, Flutter, and code-review agents plus the Drizzle, oRPC, NestJS, testing, logging, security, and monorepo skills.

**Goal:** Deliver exact published currency education content through a signed, resumable, crash-safe bundle and let guests browse the full banknote/coin catalog offline from first launch.

**Architecture:** A PostgreSQL-coordinated NestJS worker builds immutable complete snapshots into a bounded durable object store, signs exact manifest bytes, and atomically advances one ready pointer. Flutter verifies the same envelope, reuses content-addressed objects, resumes partial downloads, and atomically switches a small active pointer while readers continue using the prior bundle. The packaged version-0 seed uses the identical protocol and covers all 29 mandatory denominations.

**Tech Stack:** TypeScript 5.9, Zod 4, oRPC 1.13, NestJS 11, Drizzle ORM/PostgreSQL 16, Node Ed25519/SHA-256, Flutter/Dart 3.9, Dio, Riverpod, `cryptography`, `crypto`, `path_provider`, Jest/Vitest/flutter_test.

**Spec:** `docs/superpowers/specs/2026-08-27-ce-1-offline-currency-bundle.md`; `docs/TICKETS.md` CE-1, RF-1, and RF-6; `docs/DOMAIN-MODEL.md`; `docs/PRD.md` offline, security, accessibility, reliability, and Definition of Done constraints.

## Global Constraints

- Prerequisite HEAD is `5948d9a` with F1 and CM-3 complete. Work only in the existing local `dev` checkout; do not create a branch/worktree, push, publish, or open a pull request.
- CE-1 is foundational. Keep the cumulative diff unstaged and create exactly one local commit only after complete acceptance evidence, independent whole-ticket review, and explicit user foundation approval: `CE-1: deliver signed offline currency bundles`.
- Do not make intermediate task commits even where the generic SDD workflow suggests them. Record RED/GREEN commands, scoped diffs, review verdicts, and rulings in the ignored CE-1 SDD ledger.
- Every production behavior requires a test observed failing for the intended missing behavior before implementation. Generated migration/snapshot files and source raster assets are the only non-TDD artifacts.
- Bundle payloads contain only exact current published immutable versions and a public allowlist. Never expose actor IDs, workflow comments, audit data, credentials, storage internals, or raw errors.
- Protocol constants are frozen by the design: schema version `1`; Ed25519; exact signed payload bytes; SHA-256; manifest limit 2 MiB/2,000 entries/50 MiB core; per-core-entry limit 5 MiB; delivery `core|on_demand`; seed version `0`.
- Signing trust is purpose-bound: `ce1-seed-v1` is packaged-seed-only; `ce1-test-v1` is test-only; `ce1-dev-2026-01` is debug-only and its private key arrives through the environment. A release build fails closed without a compile-time production public-key ring.
- Server versions are strictly increasing decimal strings. Clients reject a lower version and an equal version with a different manifest digest.
- Public resource identity is a lowercase 64-character SHA-256 digest. No archive extraction, SVG/HTML rendering, manifest-derived filesystem path, or author-URL fetch is allowed.
- Client sync is credential-free, serialized, resumable, and staging-only until full verification. Any failure leaves the previous active bundle usable.
- All 29 catalog denominations are present in the packaged signed seed. Neutral source-controlled raster illustrations/copy are the approved CE-1 baseline; CM-2 remains official-media lifecycle owner.
- Mobile guest routes are restricted to `/pisocamp` and `/pisocamp/currency/...`; release Android declares `INTERNET`. Do not invent iOS proof while no iOS host project exists.
- No application barrel files or type-only files. Co-locate Dart/TypeScript types with runtime consumers; package entrypoints remain the allowed exception.
- Use UTC on the wire and in storage. Logs are structured and privacy-safe under the shared redaction policy.

## Shared Interfaces

| Producer | Consumer | Frozen interface |
| --- | --- | --- |
| Task 1 protocol | Tasks 3-8 | Strict envelope/payload/resource schemas, exact public routes, golden payload/signature fixture |
| Task 2 database | Tasks 3-4 and 8 | Immutable bundles/blobs/entries/current pointer plus leased rebuild requests and conditional pending clearing |
| Task 3 builder | Tasks 4 and 8 | `buildNextBundle(reason): Promise<BundleBuildResult>` and injected `BundleSigner`/`BundleObjectStore` |
| Task 4 public API | Tasks 6-8 | Anonymous ETag manifest endpoint and digest-addressed byte-range resource endpoint |
| Task 5 seed/model | Tasks 6-8 | Verified version-0 envelope/resources and strict Dart manifest/content models |
| Task 6 mobile store | Tasks 7-8 | `BundleStore.bootstrap/readActive/stage/activate/recover` and serialized `BundleSyncController.sync()` |
| Task 7 mobile UI | Task 8 | Riverpod active catalog plus guest banknote/coin list and detail routes |

### Task 1: Freeze the strict bundle protocol and cross-language fixture

**Files:**

- Create `packages/contracts/src/modules/v1/pisocamp/bundle.schema.ts`
- Create `packages/contracts/src/modules/v1/pisocamp/bundle.schema.test.ts`
- Create `packages/contracts/src/modules/v1/pisocamp/bundle.contract.ts`
- Create `packages/contracts/src/modules/v1/pisocamp/bundle.contract.test.ts`
- Modify `packages/contracts/src/modules/v1/pisocamp/pisocamp.contract.ts`
- Modify `packages/contracts/src/modules/v1/pisocamp/pisocamp.contract.test.ts`
- Modify the package public export file used by existing Piso CAMP schemas
- Create `packages/contracts/src/modules/v1/pisocamp/fixtures/ce1-ed25519-vector.json`

**Interfaces:**

- Produce `PisoCampBundleEnvelopeSchema`, `PisoCampBundleManifestSchema`, `PisoCampBundleManifestEntrySchema`, their inferred types, `pisoCampContract.bundle.manifest.get`, and `pisoCampContract.bundle.resource.get`.
- The manifest route is `GET /pisocamp/bundle/manifest`; the resource route is `GET /pisocamp/bundle/resources/{sha256}`. Both declare `security: []`.

- [ ] Write schema tests that reject unknown fields, unknown algorithms/keys, malformed base64url, non-canonical decimal versions, non-UTC timestamps, duplicate logical IDs/digests, unsorted entries, invalid UUID ownership pairs, unsupported MIME/delivery/kind, unsafe download paths, entry/count/byte limits, and on-demand bytes being counted as core.
- [ ] Run the focused contract test and confirm RED because the bundle schemas/routes do not exist.
- [ ] Implement the minimal strict schemas and semantic refinements. Represent the signature envelope payload as base64url exact bytes; do not reserialize it for verification.
- [ ] Add a deterministic Ed25519 golden fixture containing a test-only PKCS#8 private key, SPKI public key, exact UTF-8 payload hex/base64url, signature, and digest. Label it test-only and reject its key ID outside tests. Keep the seed-only key distinct and prohibit it for network verification.
- [ ] Run focused schema/contract tests GREEN, then full contracts tests, lint, typecheck, format check, and build.

### Task 2: Add durable bundle state and recoverable rebuild leases

**Files:**

- Modify `packages/db/src/schema.ts`
- Modify `packages/db/src/schema.spec.ts`
- Create `packages/db/src/bundle-migration.spec.ts`
- Modify `packages/db/src/content-workflow-migration.spec.ts`
- Add one generated additive migration and snapshot under `packages/db/src/migrations/`

**Interfaces:**

- Produce `contentBundles`, `contentBundleBlobs`, `contentBundleManifestEntries`, `contentBundleChannel`, and request-to-bundle ownership in `contentBundleRebuildRequests`.
- Request leases expose owner, expiry, processed bundle, and safe retry timing. A ready bundle and its entries/blobs are immutable; only the singleton channel pointer advances.

- [ ] Write failing schema and live PostgreSQL migration tests for monotonic unique versions, one primary channel, ready-only pointer ownership, immutable ready rows/entries/blobs, digest/length/MIME checks, published item/version ownership, request lease legality, expired-claim recovery, processed-bundle association, and fresh apply/reapply.
- [ ] Run the focused DB tests against the disposable PostgreSQL harness and confirm RED on missing relations/columns/constraints.
- [ ] Add the minimal Drizzle definitions and generate the additive migration. Preserve all CM-1/CM-3 triggers; extend the outbox transition trigger to permit only legal claim, retry, completion, and expiry-recovery changes.
- [ ] Add database constraints that prevent a current pointer from naming a non-ready bundle and prevent a manifest entry from naming a content version not owned by its item.
- [ ] Run focused tests GREEN, then the complete DB suite serially with zero skips, migration generate-parity, lint, typecheck, format check, and build.

### Task 3: Build deterministic published-only bundles

**Files:**

- Create focused files under `apps/backend/src/modules/v1/pisocamp/bundle/` for signer, PostgreSQL object store, repository, builder, worker, and module; do not add a barrel file
- Create adjacent `*.spec.ts` files for every runtime service
- Modify `apps/backend/src/modules/v1/pisocamp/pisocamp.module.ts`
- Modify `apps/backend/src/modules/v1/pisocamp/content/content-workflow.service.ts` only to reuse its exact published-candidate seam
- Modify `apps/backend/src/config/env.config.ts` and `.env.example` for bounded signing/worker configuration without committing key material

**Interfaces:**

- `BundleSigner.sign(payload: Uint8Array): Promise<{ algorithm: "Ed25519"; keyId: string; signature: string }>`.
- `BundleObjectStore.putVerified(input): Promise<StoredBundleObject>` and `readByDigest(sha256): Promise<StoredBundleObject | null>` use bounded immutable bytes.
- `BundleBuilder.buildNextBundle(reason): Promise<{ outcome: "built"|"unchanged"; bundleVersion: string }>`.

- [ ] Write failing tests for deterministic byte-for-byte rendering, the golden signature vector, exact current-published inclusion, exclusion of every other state/stale pointer, public-field allowlisting, catalog sorting, same-input unchanged behavior, monotonic gaps, conditional `bundle_pending` clearing, and full-snapshot removal.
- [ ] Write failing concurrency/fault tests for two workers, stale leases, publish-during-build, object-write/read-back failure, signer failure, promotion rollback, retry after object-ready/DB-not-promoted, and no stale build overtaking a newer ready version.
- [ ] Run focused tests and confirm RED on missing builder abstractions.
- [ ] Implement the smallest signer/store/repository/builder state machine from the design. Use Node `crypto`; inject all clock/random/config boundaries; sanitize stored errors to stable codes.
- [ ] Add a scheduled poller that claims with `FOR UPDATE SKIP LOCKED`, uses the existing PostgreSQL advisory-lock pattern, heartbeats/reaps conservatively, and never runs heavy work while holding an unnecessary row transaction.
- [ ] Run focused tests GREEN, complete backend tests with open-handle detection and zero skips, then lint/typecheck/format/build.

### Task 4: Expose anonymous manifest and byte-range resources

**Files:**

- Create `apps/backend/src/modules/v1/pisocamp/bundle/bundle.controller.ts`
- Create `apps/backend/src/modules/v1/pisocamp/bundle/bundle.controller.spec.ts`
- Create or extend a focused PostgreSQL-backed composed HTTP E2E spec under `apps/backend/test/`
- Modify the bundle module provider/controller registration
- Modify proxy/deployment configuration only where required to preserve range and no-compression semantics

**Interfaces:**

- Manifest returns the strict envelope through oRPC and honors `If-None-Match` with a strong body digest.
- Resource reads are opaque digest lookups and return exact 200/206/404/416 semantics with immutable caching and `nosniff`.

- [ ] Write failing controller/E2E tests for anonymous access, no session-cookie requirement, strict throttle metadata, ready-only manifest, unavailable state, ETag 304, full 200, every single-range form, malformed/multiple/unsatisfiable ranges, correct headers/lengths, and unknown digest 404.
- [ ] Add leak sentinels proving responses/logs omit actors, comments, internal storage keys, body text outside the signed resource, keys, cookies, and raw errors.
- [ ] Run focused tests and confirm RED on missing routes.
- [ ] Implement the minimal controller/service boundary using `@AllowAnonymous`, contract validation, safe oRPC errors, and direct response streaming where oRPC cannot express 206/304 without weakening the typed manifest contract.
- [ ] Run focused tests GREEN, the real composed HTTP test through the configured server/proxy path, then full backend quality gates.

### Task 5: Create and verify the complete signed packaged seed

**Files:**

- Add neutral source raster assets under `apps/mobile/assets/pisocamp/bundle/seed/`
- Add the exact signed seed envelope and 29 strict content JSON resources under the same directory
- Modify `apps/mobile/pubspec.yaml` and `pubspec.lock`
- Modify `packages/db/package.json` only if a public currency-catalog subpath export is required by the deterministic seed generator
- Create a source-controlled seed generator/validator in the appropriate package script location with adjacent tests; it must never contain a production private key
- Create Dart manifest/content models and verifier under `apps/mobile/lib/features/pisocamp/data/`, co-locating their types
- Create adjacent tests under `apps/mobile/test/features/pisocamp/data/`

**Interfaces:**

- Produce `BundleEnvelope.parseAndVerify(bytes, keyRing)`, `BundleManifest`, `CurrencyContentDocument`, and one verified version-0 seed using the Task 1 golden protocol.

- [ ] Use the image-generation skill to create neutral, non-replica raster illustrations for banknote and coin categories; verify their visual suitability and commit only exported raster files, not tool scratch output.
- [ ] Write failing generator/model tests proving exact 5-series/29-denomination coverage, stable ordering, unique logical IDs, factual source attribution, meaningful image alt text, no official-artwork claim, valid SHA-256/length, and byte-identical regeneration.
- [ ] Write failing Dart tests for valid/altered golden vectors, unknown key/algorithm, bad base64url/signature, malformed/duplicate/oversized schema data, rollback/equal-version conflict, MIME/path limits, and image magic-byte mismatch.
- [ ] Run focused tests and confirm RED before adding generator/models.
- [ ] Add `cryptography`, `crypto`, and direct `path` dependencies using pnpm/Flutter tooling conventions; implement strict parsing and purpose-bound verification with a compiled seed key plus debug/production network rings. Assert release configuration fails closed when the production network ring is absent.
- [ ] Generate the seed, visually inspect raster output, run focused tests GREEN, and verify the seed can be opened with network disabled.

### Task 6: Implement resumable staging, recovery, and atomic activation

**Files:**

- Create focused co-located runtime files under `apps/mobile/lib/features/pisocamp/data/` for the credential-free bundle client, store, repository, and sync controller
- Create Riverpod wiring under `apps/mobile/lib/features/pisocamp/presentation/providers/`
- Create focused unit/host-integration tests under `apps/mobile/test/features/pisocamp/data/`
- Modify `apps/mobile/lib/core/constants/api_constants.dart`
- Modify `apps/mobile/android/app/src/main/AndroidManifest.xml`

**Interfaces:**

- `BundleStore.bootstrap()`, `recover()`, `readActive()`, `hasVerifiedObject()`, `stage()`, and `activate()` operate only below the injected application-documents root.
- `BundleSyncController.sync(trigger)` is serialized and emits idle/checking/downloading/paused/failed/active states without replacing active content.

- [ ] Write failing real-temp-directory tests for seed bootstrap, corrupt pointer recovery, orphan staging cleanup/retention, active/previous retention, object reuse, full verification, atomic pointer swap, and reader snapshot pinning.
- [ ] Write a controllable local Range server and failing tests for changed-entry-only requests, correct 206 resume, disconnect/recreate/resume, changed ETag, unexpected 200 restart, malformed Content-Range, validated 416 completion, 304/no-op, cancellation, checksum/signature failure, disk full, permission denial, and crash injection immediately before/after pointer replacement.
- [ ] Assert every failure keeps the prior active manifest and partial staging where safe; assert a removed logical entry disappears only after successful activation.
- [ ] Run focused tests and confirm RED on missing store/sync interfaces.
- [ ] Implement the minimal credential-free Dio client, content-addressed object store, journals, same-parent temp writes, atomic pointer replacement/recovery, secure high-water mark, and serialized controller.
- [ ] Add Android release `INTERNET`, API URL helpers, bounded retry/backoff/concurrency, and privacy-safe structured failure codes.
- [ ] Run focused tests GREEN, then full Flutter test/analyze and release-manifest assertions.

### Task 7: Build guest offline currency lists and details

**Files:**

- Modify `apps/mobile/lib/core/navigation/app_router.dart` and generated router output
- Modify `apps/mobile/lib/features/pisocamp/presentation/screens/pisocamp_home_screen.dart`
- Create banknote/coin list and currency detail screens/widgets under the existing Piso CAMP presentation feature
- Create an injectable no-op content-view analytics bridge co-located with its provider/runtime use
- Create/modify route, provider, home, list, detail, semantics, and responsive widget tests

**Interfaces:**

- Routes are `/pisocamp/currency/banknotes`, `/pisocamp/currency/coins`, and `/pisocamp/currency/{kind}/{logicalId}` with validated route parameters.
- UI reads one pinned `ActiveCurrencyCatalog`; opening a detail calls `ContentViewAnalytics.recordOpen(logicalId)` whose CE-1 default is a no-op.

- [ ] Write failing guest-route tests proving only the Piso CAMP currency route family bypasses auth and malformed/other routes remain protected.
- [ ] Write failing widget tests for immediate seed/live rendering, 5 series/29 denominations, banknote/coin grouping, security-feature association, image alt semantics, safe links, empty/corrupt fallback, offline/paused/error/success announcements, retry behavior, and no full-screen sync spinner.
- [ ] Add accessibility tests for semantic headings, traversal order, screen-reader labels, non-color state, 48dp targets, keyboard operation, 320px width, landscape state retention, 200% text, reduced motion, and no horizontal overflow.
- [ ] Run focused tests and confirm RED on missing routes/screens.
- [ ] Implement the smallest Riverpod screens and widgets using existing theme/components. Keep saved content visible during sync and focus/announce meaningful changes.
- [ ] Run focused tests GREEN, full Flutter test/analyze, and rendered phone/landscape/200% acceptance with clean console/network diagnostics.

### Task 8: Prove CE-1 acceptance and complete independent review

**Files:**

- Create `docs/pisocamp/ce-1-acceptance-evidence.md`
- Update an existing RTM artifact if present; otherwise map CE-001, CE-002, UM-001, and UM-006 in the evidence document
- Maintain ignored reports under `.superpowers/sdd/2026-08-27-ce-1-offline-currency-bundle/`

- [ ] Run a fresh disposable PostgreSQL migration and composed backend matrix proving published-only input, monotonic build, exact pointers, lease recovery, anonymous manifest/range behavior, invalid build non-promotion, conditional pending clearing, and unpublish/removal after the next build.
- [ ] Run Node/Dart cross-language golden verification and adversarial signature, rollback, resource-limit, range, and privacy-leak suites.
- [ ] Run Flutter first-install offline seed, online sync, interrupted transfer/restart/resume, old-live-during-transfer, successful atomic activation, airplane-mode list/detail, and removal-after-sync tests using real temporary files and the controllable HTTP server.
- [ ] Run rendered mobile acceptance at 320px, landscape, and 200% text; inspect screenshots and verify semantics/focus, no overflow, no unexpected console/network/server errors or warnings, and saved-content availability throughout interruption.
- [ ] Run complete contracts, DB, backend, web regression, and Flutter suites; lint; typecheck/analyze; format checks; builds; workspace dependency lint; `git diff --check`; zero-skip/open-handle checks appropriate to each package.
- [ ] Dispatch the project code-reviewer across the complete cumulative CE-1 diff against `5948d9a`. Fix every Critical/Important/Major finding with a new RED/GREEN cycle and scoped re-review until clean.
- [ ] Audit the final unstaged scope and secret sentinels. Remove only exact labelled disposable services/processes and verify their owned ports are closed.

## Foundation Review Checkpoint and Commit

Present the complete CE-1 implementation, every acceptance-criterion proof, validation counts, screenshots, residual platform limitation, shared-code ownership, and reviewer verdict. Pause before staging or committing.

After explicit approval, rerun the fresh completion matrix, inspect `git diff --cached`, run credential/private-key/database-URI/session-token sentinels, then create exactly one local commit:

```powershell
git add -A
git commit -m "CE-1: deliver signed offline currency bundles"
```

Verify the commit, clean index/worktree, no push/PR/branch activity, and log CE-1 PASS before starting AN-1.

## Plan Self-Review

- CE-1 AC 1 maps to Tasks 1-4 and 8: published-only input, incremented ready bundle, signed manifest, per-entry checksums.
- CE-1 AC 2 maps to Tasks 5-6 and 8: online manifest check, changed-entry staging, verification, atomic activation.
- CE-1 AC 3 maps to Task 6 and 8: real interrupted Range transfer resumes while old live content remains readable.
- CE-1 AC 4 maps to Tasks 5 and 7-8: airplane-mode lists/details cover all series/denominations with approved descriptions and raster images.
- CE-1 AC 5 maps to Tasks 3, 6, and 8: authoritative full snapshot removes absent content only after a successful swap.
- CE-1 AC 6 maps to Task 7: an injectable no-op bridge preserves the AN-1 integration point without implementing analytics early.
- RF-1 and RF-6 failure ordering is explicit on both server and client. No partial or failed bundle can become current.
- CM-2 remains official asset lifecycle owner; CE-1 owns immutable delivery blobs/protocol only. AN-1 remains analytics owner.
- Plan scan must verify every shared file/interface pair before Task 1 dispatch; no placeholders or separate type-only application files are permitted.
