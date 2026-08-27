# CM-3 acceptance evidence

Date: 2026-08-27 (Asia/Singapore)

## Scope proved

CM-3 adds the governed `draft -> submitted_for_review -> approved -> published` lifecycle and the `submitted_for_review -> draft` rejection path. Every transition appends an immutable snapshot, copies version-scoped links, advances the stable item pointers atomically, records a complete audit entry, and is protected by active-account, permission, optimistic-version, and idempotency checks. Publishing also marks the item for bundle work and writes one durable rebuild request; the CE-1 bundle builder itself remains out of scope.

No repository RTM artifact exists. Searches across the documentation found requirement references in the PRD, domain model, tickets, and plans, but no maintained RTM to update. The required traceability is therefore recorded here without creating a parallel RTM.

## Requirements traceability

| Requirement | CM-3 evidence                                                                                                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CM-002      | The transition table permits only submit, approve, reject, and publish from their exact source states. Illegal and stale transitions return conflicts with no partial writes. The bundle-candidate seam excludes draft, submitted, approved, stale, and pointer-mismatched versions.                                                  |
| CM-003      | Each accepted transition creates a new immutable version and a same-transaction audit containing actor, timestamp, action, from/to state, comments, and source/target version identifiers. Approval and publication metadata is retained on the snapshot.                                                                             |
| CM-006      | Publish is allowed only from `approved`; it appends the published snapshot, sets both current pointers to it, records publication actor/date, sets `bundle_pending`, and creates exactly one pending rebuild request. Only exact current published snapshots are bundle candidates.                                                   |
| CM-007      | Version and related-link immutability remains enforced. Submit, approve, reject, and publish append snapshots rather than rewriting history; rejection returns the item to an editable draft while preserving its workflow comments and lineage. Transaction and idempotency failure tests prove rollback without history corruption. |
| BR-002      | An editor/submission role cannot approve or publish. Approval and publication require their separate permissions, denials are audited, and no unapproved snapshot is eligible for public bundle construction.                                                                                                                         |

## Ticket acceptance criteria

| `docs/TICKETS.md` CM-3 criterion                                                                       | Result and evidence                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft submit appends a snapshot, changes status, and enters the review queue.                          | Passed in the PostgreSQL service matrix, composed authenticated HTTP E2E, and real editor browser flow.                                                                                                                |
| Approve records comments, approver, and approval date; reject returns to draft with comments.          | Passed in the service matrix and composed HTTP E2E. The browser approver flow visibly required and recorded approval comments. Rejected content remained editable and its immutable history retained the rejection.    |
| Approved publish produces the current published version, publication date, and bundle rebuild trigger. | Passed in the service matrix, composed HTTP E2E, and browser flow. The browser-created item ended with equal working/published pointers, `bundle_pending = true`, one outbox row, and publication actor/date.          |
| Edit/submit-only users receive 403 for approve/publish and the denials are audited.                    | Passed through real authenticated authorization and composed HTTP E2E. Direct editor access to the review route redirected to `/dashboard`, and the editor had no Content Review navigation or approver controls.      |
| Every transition writes a complete audit entry.                                                        | Passed in service and HTTP tests. The browser-created item had submit, approve, and publish success audits with actors, from/to states, source/target versions, timestamps, and the approval comment.                  |
| Draft or submitted content is excluded from a bundle.                                                  | Passed in the published-source database seam: only an exact `current_published_version_id` whose item and version are both published is returned; draft, submitted, approved, stale, and mismatched rows are excluded. |

## Disposable database and migration verification

Acceptance used an exact PostgreSQL 16 Alpine container named `cm3-task7-acceptance-db`, labelled `codex.task=cm3-task7-acceptance`, with only `127.0.0.1:55447` published. The primary disposable database was `cm3_acceptance`; `cm3_task7_test` was used for normal test fixtures and the migration suite's required guarded administrative database was `cm3_task2_admin`.

`pnpm.cmd --filter @repo/db migrate` applied the migration to a fresh database and a second invocation completed cleanly. After the final review fix added the nullable request-fingerprint column and constraint to the same additive CM-3 migration, fresh apply/reapply passed again and `drizzle-kit generate` reported no schema changes. The complete DB suite was then run with `RUN_CM3_DB_MIGRATION_TESTS=true` against the exact guarded administrative database and passed 82 / 82 with zero skips. An earlier run without that opt-in passed 71 tests and reported nine intentional skips; that run was not accepted as completion evidence. A first opt-in attempt against the wrong database name correctly stopped at its destructive guard before any destructive action, after which the required isolated database was created inside the exact owned container.

## Production-like database and API matrix

The PostgreSQL service and composed authenticated HTTP suites exercised the complete workflow matrix:

- submit, review queue inclusion, approve metadata/comments, reject-to-editable-draft, publish pointer movement, `bundle_pending`, and exactly one outbox request;
- every invalid source/action pair, stale expected version, missing item, and concurrent row-lock behavior with transactional rollback;
- forced audit and forced outbox failures with unchanged item, version, link, audit, idempotency, and outbox counts;
- permission denials for the edit/submit-only role and their awaited denial audits;
- complete success audits with actor, action, state pair, comments, and both version identifiers;
- exact rich-response replay and concurrent same-key replay with invariant version/link/audit/outbox row counts; different idempotency keys correctly meet the stale-write conflict;
- deterministic SHA-256 replay binding across the normalized operation and validated input: a live key reused by the same actor for a different action, item, or comments returns a typed conflict before the handler runs; exact requests still replay, different actors remain independent, live legacy/null rows fail closed, and expired rows are replaced with a new fingerprint;
- exact-current-published bundle candidates only, with draft, submitted, approved, stale, and pointer-mismatched snapshots excluded.

The focused service suite contains nine lifecycle tests. The workflow transaction idempotency suite contains seven tests, and the generic interceptor database suite contains 40 tests. They are included in the fresh 377-test backend result below. The production-composed HTTP test passed 1 / 1 with real Better Auth sessions, RBAC, PostgreSQL, request headers, controllers, and transaction services, including changed-comment, cross-action, and cross-item key reuse returning 409 with invariant row counts.

The final controller review fix also records each unexpected content failure once through the injected pino-backed Nest logger with a static operation label and the original error object, preserving stack/cause for diagnostics. The client continues to receive only `Content operation failed`; typed oRPC errors pass through unchanged and are not redundantly logged. No request input, actor, key, or other PII is included in the log context.

## Real authenticated browser acceptance

Chromium acceptance used the production backend build at `127.0.0.1:4327` and the production Next standalone build at `127.0.0.1:4328`. The ignored Playwright harness used real Better Auth sessions and database state, not mocked data or authorization.

- `alex@turbo-template.local` had canonical Content Administrator plus User roles and performed the editor side: create/save a draft, reopen edit, keyboard-open and confirm Submit, observe pending/success feedback, and reach the submitted read-only state.
- `admin@turbo-template.local` had canonical Content Approver plus the seeded administrative role and performed the approver side: open the live review queue/detail, enter required approval comments, keyboard-approve, observe the polite pending announcement and focused success alert, then keyboard-publish and verify the published state.
- The editor's direct review-route attempt redirected to `/dashboard`; Content Review navigation and approve/publish controls were absent.
- Desktop 1440 x 900, mobile 320 x 800, keyboard-only actions, and 200% document zoom at 640 x 900 all completed without horizontal overflow. Dialog focus trapping, predictable success focus, visible state changes, and live pending announcements passed.
- Final result: 1 / 1 Playwright test passed in 13.2 seconds against the standalone build.

The final browser-created item had four immutable versions and three successful workflow audits. Its item status and version status were `published`; working and published pointers matched version 4; `bundle_pending` was true; publication and approval actors/dates were present; and exactly one outbox row existed. Submit was attributed to the editor, while approve/publish were attributed to the approver. The approval audit retained `Evidence and source verified`.

Harness diagnostics did not expose a product defect: strict locator ambiguity was narrowed to semantic targets, expected aborted Next prefetch/query requests were classified separately, service workers were allowed rather than blocked, and the generated standalone package was supplied its generated `.next/static` and `public` assets before the final clean run. These changes remained in ignored/generated acceptance tooling only.

## Fresh verification matrix

| Gate                   | Command                                                                     | Result                                                                                  |
| ---------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Contracts tests        | `pnpm.cmd --filter @repo/contracts test`                                    | 8 files, 145 / 145 passed                                                               |
| Database tests         | `pnpm.cmd --filter @repo/db test` with guarded CM-3 migration opt-in        | 11 files, 82 / 82 passed, zero skips                                                    |
| Backend tests          | `pnpm.cmd --filter @repo/backend exec jest --runInBand --detectOpenHandles` | 45 suites, 377 / 377 passed, zero skips, no open handle detected                        |
| Web tests              | `pnpm.cmd --filter @repo/web test`                                          | 28 files, 230 / 230 passed                                                              |
| Composed HTTP E2E      | focused `content-routes.e2e-spec.ts` with development JSON mail transport   | 1 suite, 1 / 1 passed with handle detection and clean shutdown                          |
| Rendered browser       | Playwright against production builds and real sessions                      | 1 / 1 passed in 13.2 seconds                                                            |
| Lint                   | package `lint` for contracts, db, backend, and web                          | all passed                                                                              |
| TypeScript             | package `typecheck` for contracts, db, backend, and web                     | all passed                                                                              |
| Builds                 | package builds for contracts, db, backend, and web                          | all passed; backend 120 files / 0 issues; web emitted 24 routes and 77 precache entries |
| Workspace dependencies | `pnpm.cmd lint:ws`                                                          | no issues found                                                                         |
| Formatting             | package format checks plus targeted CM-3 evidence/report checks             | passed                                                                                  |
| Patch integrity        | `git diff --check --`                                                       | passed; Git emitted only line-ending conversion advisories                              |

The web build's only notice was the repository's expected source-map upload skip when `SENTRY_AUTH_TOKEN` is absent. The initially used `pnpm ... test -- --runInBand` form passed a literal separator to Jest and found no tests; the corrected direct Jest invocation above is the accepted backend result.

## Logs, security, and interface review

The final backend browser log contained no level 40/50/60 records, unhandled rejection, exception, database URL, password, session cookie, seeded email, or secret marker. Backend stderr and web stderr were empty. The standalone web log contained only startup/readiness messages. After the expected route-guard observation described below, the CM-3 browser lifecycle recorded zero unexpected console errors/warnings, page errors, non-abort failed requests, or HTTP failures. The post-review composed HTTP run added only expected informational request records, including the three deliberate 409 conflicts; it emitted no error-level application diagnostic.

Credential and PII sentinels were run over the exact working-tree diff from `def204a` and repository status was checked for added `.env`, key, certificate, or credential files. Deterministic test-only passwords/cookie names in test fixtures are not deployable secrets; no live credential, private key, database URL, session value, or browser-created content was added to the diff.

The final sentinel enumerated 40 changed/untracked, non-ignored files. Its only email literals were reserved `.test` addresses and the seeded `.local` browser identities; its only session-cookie match was an assertion for the cookie name, not a value. A case-insensitive unfinished-marker probe matched the existing exported `Todo` type/comment rather than a `TODO`, `FIXME`, or `HACK`. No Philippine mobile number, debug statement, sensitive filename, credential marker, or personal identity was found.

A fresh Web Interface Guidelines review of the CM-3 source found semantic controls, labels, headings, keyboard behavior, visible focus, live announcements, 44px actions, responsive wrapping, and no zoom restriction, paste blocking, clickable navigation div, hidden-overflow workaround, `outline-none`, or `transition-all` violation.

## Teardown

The exact backend and web process trees were stopped, and ports 4327 and 4328 were confirmed free. Before removal, Docker inspection verified the exact container name, `codex.task=cm3-task7-acceptance` label, PostgreSQL 16 Alpine image, and loopback-only port 55447 binding. The exact acceptance container and ignored harness/results directories were then removed. Final checks confirmed no listeners on 4327, 4328, or 55447 and no exact container named `cm3-task7-acceptance-db`.

The final review fixes used a second exact PostgreSQL 16 Alpine container named `cm3-final-fix-db`, labelled `codex.task=cm3-final-fix`, bound only to `127.0.0.1:55448`. Its dedicated databases were `cm3_final_fix_test` and the migration suite's required `cm3_task2_admin`. Identity was inspected before database recreation and teardown; the exact container was removed after all verification, and final checks confirmed the container absent and port 55448 free.

## Residual limitations and handoff

The editor route-guard check correctly redirected to `/dashboard`. The existing dashboard overview subsequently probes administrative roles/users endpoints, producing two expected 403 responses and Chromium's generic failed-resource console line for an editor. The harness attributed and cleared those expected denials before requiring a clean CM-3 lifecycle. This is a legacy dashboard observation outside the CM-3 workflow, not a CM-3 failure.

CE-1's rebuild worker, manifest, bundle creation, and mobile consumption are intentionally not implemented here; acceptance proves only the durable trigger and published-only candidate seam. Browser coverage is local Chromium on Windows, not the complete cross-browser/device fleet. The final full-diff review found and closed the request-binding and diagnostic-logging defects through recorded RED/GREEN cycles. Browser acceptance was not rerun because those fixes changed no product UI behavior. The complete diff remains unstaged and uncommitted pending the foundation checkpoint.
