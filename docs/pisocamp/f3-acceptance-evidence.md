# F3 Acceptance Evidence

## PSA catalog provenance

- Version: `PSGC-2Q-2026`, official publication as of 30 June 2026.
- Landing page: `https://psa.gov.ph/classification/psgc/summary`.
- Normalized catalog SHA-256: `d346ceb5d7ecc4f6ead8471e4b498542c5ce91ae37b179904893ef2ec7f4667c`.
- Source pages: `https://psa.gov.ph/classification/psgc/cities/{regionCode}` for `0100000000`, `0200000000`, `0300000000`, `0400000000`, `0500000000`, `0600000000`, `0700000000`, `0800000000`, `0900000000`, `1000000000`, `1100000000`, `1200000000`, `1300000000`, `1400000000`, `1600000000`, `1700000000`, `1800000000`, and `1900000000`.
- Reconciled per-page city counts: `9, 4, 15, 22, 7, 3, 10, 7, 5, 9, 6, 4, 16, 2, 6, 2, 19, 3` = 149. No row was inferred or taken from a community source.

## Automated evidence

- Contracts: 6 files, 70 tests passed; strict public catalog and authenticated profile paths. The profile output is a discriminated union: `complete` requires an empty `missingFields` array and a populated profile, while `missing` requires at least one missing field and a null profile.
- Database: 8 files, 47 tests passed; fresh/reapplied migration and twice-reapplied seed path retain exactly 18 regions and 149 cities.
- Backend: 38 suites, 324 tests passed, including service, controller, exact consent-link, idempotency, transaction rollback, deactivation, and subject-precedence regressions.
- Contracts, database, and backend lint, typecheck, and production build passed. The backend build compiled 106 files with zero type issues.
- The F3 migration suite executes against PostgreSQL when available. A local unavailable database is explicitly reported as two skipped tests rather than false passes; CI fails clearly when its PostgreSQL prerequisite is unavailable.

## Live HTTP acceptance

A production-built NestJS backend ran against a freshly migrated disposable PostgreSQL database with only test fixture identities and an unmistakably test-only privacy notice.

- `GET /api/v1/pisocamp/locations` returned 200 with `PSGC-2Q-2026`, the pinned catalog digest, exactly 18 regions, and exactly 149 cities.
- Unauthenticated `GET /api/v1/pisocamp/profile` returned 401. An active signed-up account initially returned 200 / `missing`; after completion it returned 200 / `complete` with name and email composed from Better Auth.
- Guest registration consent followed by Better Auth signup and authenticated profile completion returned 200. Same-key replay returned the stored 200 result without creating another profile, device link, idempotency row, or `Registered End User` membership; each persisted exactly once.
- Missing and mismatched idempotency keys returned 400. A client-supplied `accountId`, a mismatched city/region pair, and malformed subject input returned 400 without profile creation.
- After account deactivation, both profile GET and a stored-key POST replay returned 401.
- Captured runtime logs contained none of the fixture name, email, age/gender/location values, or raw device pseudo-identifiers.

## Android QA

Android QA used only disposable accounts, an explicit test-only notice, and the production-built API:

- A guest accepted the current registration notice exactly once and reached the blank registration form. Before signup, the database gained one guest consent row and one idempotency row, with no user, profile, link, or role mutation.
- Valid signup and profile submission linked that exact pre-signup consent evidence and atomically created one profile, one device link, one profile idempotency row, and one `Registered End User` membership. Consent history did not duplicate.
- An existing authenticated account returned 200 / `missing` with a null profile and all four demographic fields absent. Its later completion from a fresh device produced the same exact-once profile/link/idempotency/role result while retaining its account-scoped current registration grant.
- Client-side validation and city filtering completed against the live 18-region/149-city catalog. No raw account or device identifier is retained in this evidence.

Cleanup is complete. The exact fixture process tree was stopped, port 3000 had zero listeners, and PostgreSQL confirmed the disposable database no longer existed.
