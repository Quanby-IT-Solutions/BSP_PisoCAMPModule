# F4 privacy notice and consent acceptance evidence

Date: 2026-08-24 (Asia/Singapore)

## Scope proved

F4 establishes immutable privacy-notice versions, append-only consent evidence, account-or-guest subject resolution, active-version and reconsent semantics, transactional idempotency, and the mobile consent gate. The client never submits an account ID: authenticated identity comes from the verified Better Auth session, while guests use the validated pseudonymous device header.

## Automated validation

| Gate      | Result                                             |
| --------- | -------------------------------------------------- |
| Contracts | 6 files, 62 tests passed                           |
| Database  | 6 files, 40 tests passed                           |
| Backend   | 35 suites, 307 tests passed                        |
| Mobile F4 | 61 tests passed                                    |
| Mobile    | full application suite, 104 tests passed           |
| Static    | affected lint, format, typecheck and builds passed |

The database suite includes migration-only, upgrade, migration reapplication, approved-body import, seed idempotency, constraints, and transaction regressions. The backend suite covers guest and authenticated subjects, spoof prevention, grant/decline, stale versions, derived reconsent, replay, rollback, deactivated-account replay rejection, and the inert reusable consent guard.

## Live HTTP acceptance

A production-built backend ran against a migrated disposable PostgreSQL database with an explicit test-only notice fixture:

- `GET /api/v1/pisocamp/consent/registration` returned 200 / `none`; omitting a valid guest identity returned 400.
- `POST /api/v1/pisocamp/consent` without `Idempotency-Key` returned 400 / `BAD_REQUEST`; a header/body UUID mismatch also returned 400 / `BAD_REQUEST`.
- A valid guest POST returned 200, its same-key replay returned the identical 200 response, and the next GET returned 200 / `granted`.
- Activating a newer test notice changed GET to 200 / `requires_reconsent`; submitting the stale notice returned 409 without changing historical evidence.
- Real Better Auth signup and authenticated consent each returned 200. After that account was deactivated, replaying its stored key returned 401 / `UNAUTHORIZED` instead of the stored success.
- The final harness contained exactly two consent rows and two idempotency rows. F1's anonymous configuration endpoint remained 200 with exactly `account_prompt_enabled`, `config_version`, and `module_enabled`.

Captured application logs did not contain the raw device pseudonymous ID. The shared observability redaction suite passed 35/35 tests and includes the device header in the canonical redaction policy.

## Android offline, restart and reconnect evidence

Acceptance used an Android emulator and a test-only notice version. The app fetched and cached the full notice online, then displayed it while airplane mode made the backend unreachable. Accepting offline showed the explicit saved-offline/registration-blocked state, created no server POST, and survived a force-stop and cold restart without exposing registration.

After one reconnect, with no manual refresh or second reconnect, the pending choice produced exactly one immutable consent record and one matching idempotency record. GET then returned `granted`; the Offline indicator cleared after validated configuration reload, and Create Account opened the registration fields. A final recount remained exact-once with no additional POST.

Automated accessibility evidence verifies semantic labels for Accept and Decline, an announced save-error region, at least 48-pixel action targets, and a long notice at 200% text scaling in a narrow landscape viewport without a layout exception. Manual screen-reader announcement behavior remains a later dedicated accessibility-ticket concern.

## Notice provenance and production prerequisite

The authoritative metadata source is the [BSP Mobile App Privacy Notice](https://www.bsp.gov.ph/Pages/AboutTheBank/MobileAppPrivacyNotice.aspx), last updated `2024-12-26`.

No purported approved legal body is embedded in production source. Before production activation, an authorized deployment must supply the exact approved body through `PISOCAMP_PRIVACY_NOTICE_BODY_FILE` and its independently approved SHA-256 digest through `PISOCAMP_PRIVACY_NOTICE_SHA256`, then run the idempotent import path. The API fails closed if the body is absent or its digest does not match. All automated and runtime acceptance used content unmistakably marked `TEST FIXTURE ONLY`; it is not approved legal copy.

## Cleanup

The acceptance backend and fixture process tree were stopped, the host port was verified closed, and every disposable database was dropped after evidence collection. No live test fixture or test consent data remains.
