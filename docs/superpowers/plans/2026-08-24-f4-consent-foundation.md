# F4 Privacy Notice and Consent Foundation

## Scope

Implement the F4 contracts, PostgreSQL model and additive migration, idempotent approved-notice import seam, and NestJS consent API/guard. The Flutter client remains separately owned; SA-3 owns notice authoring and active-version administration/audit.

## Frozen interface

- Purposes: `registration`, `survey`, `demographic_analytics`.
- Decisions: `granted`, `declined` (`withdrawn` is reserved for SA-7 storage/state compatibility only).
- Derived states: `none`, `granted`, `declined`, `withdrawn`, `requires_reconsent`.
- `GET /api/v1/pisocamp/consent/:purpose` returns the active approved notice and the current subject state.
- `POST /api/v1/pisocamp/consent` records an immutable decision. The body contains a client UUID, purpose, notice ID, notice version, decision, and `respondedAt`; `Idempotency-Key` must equal the client UUID.
- Account identity is derived only from the verified Better Auth session. Guests send `X-Device-Pseudo-Id`, exactly 22 Base64URL characters, matching F1.
- A stale notice is rejected with a safe conflict and the old decision is preserved. Reconsent is derived, never written back into historical records.

## Ordered TDD work

1. Add failing contract tests for strict schemas, exact routes, literals, UUID/header invariants, timestamps, and response shapes; implement the schemas and contract exports.
2. Add failing schema/catalog tests for immutable notice versions, append-only consent records, XOR subjects, checks, FKs, indexes, and the active-version configuration key; implement the Drizzle schema and seed catalog.
3. Add a single additive migration and disposable PostgreSQL tests for a pre-F4 upgrade, migration reapply, migration-only state, approved-notice fixture import, and seed idempotency.
4. Add failing service tests for active-notice fail-closed behavior, anonymous/authenticated identity, grant/decline, stale-version conflict, reconsent after a fixture version bump, spoof prevention, replay, and transaction rollback; implement the consent subject resolver and service using the shared transaction context.
5. Extend the shared idempotency interceptor under test so anonymous consent requests are scoped by a validated guest identity, while authenticated routes retain account scoping. Persist consent and the replay row in one transaction.
6. Add an inert `@RequireConsent(purpose)` guard under tests, then wire strict public GET/POST controller procedures. Do not add permission or Admin bypasses and do not duplicate consent evidence into the privileged audit log.
7. Run focused RED/GREEN suites, package tests/typechecks/lint/format/build, disposable PostgreSQL migration/seed smoke, and live HTTP positive/negative/stale/replay acceptance. Record exact evidence in the ignored SDD report.

## Approved-body prerequisite

The authoritative metadata is the BSP Mobile App Privacy Notice at `https://www.bsp.gov.ph/Pages/AboutTheBank/MobileAppPrivacyNotice.aspx`, last updated `2024-12-26`. Its full approved legal body is deliberately not copied or invented in source. Deployment must provide the body through the documented import seam with an independently approved SHA-256 digest. Until an exact body is imported and matches the configured active version, the consent GET/POST paths fail closed and no consent-dependent collection may proceed. Tests and disposable acceptance use an unmistakable non-production fixture.

## Ownership boundary

F4 owns storage, subject resolution, current-state calculation, record creation, and reusable enforcement. SA-3 later owns approved notice authoring/import authorization, active-version changes under `admin.config.manage`, and the corresponding privileged audit. SA-7 owns withdrawal and retention/deletion policy.
