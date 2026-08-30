# CE-1 acceptance evidence

Date: 2026-08-28 (Asia/Singapore)

Status: implementation acceptance ready for cumulative CE-1 review

## Scope under acceptance

CE-1 closes the published-content-to-offline-reader loop with a PostgreSQL-coordinated immutable bundle builder, a signed public manifest and digest-addressed range API, a verified/resumable Flutter store, and guest banknote/coin list and detail screens backed by a complete packaged seed.

No repository RTM artifact exists. Searches across the documentation found requirement references in the PRD, domain model, tickets, plans, and the earlier CM-3 evidence, but no maintained RTM to update. The required traceability is therefore recorded here without creating a parallel RTM.

## Requirements traceability

| Requirement | CE-1 implementation and acceptance evidence                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CE-001      | The guest Currency Education flow exposes Banknotes and Coins list/detail routes. One pinned, verified catalog groups the five required series and all 29 mandatory denominations; strictly parsed published content and associated security-feature descriptions project over the approved packaged baseline.                                                                                                      |
| CE-002      | Each denomination has approved baseline descriptive copy and a project-owned neutral raster illustration. Published descriptions can replace the corresponding denomination without exposing workflow/private fields; verified seed imagery remains available when a published-only network snapshot contains no replacement image. Interactive 3D and advanced visual effects remain assigned to later CE tickets. |
| UM-001      | Version 0 installs from a signed packaged seed without network access. Later bundles are signature-checked, content-addressed, checksum-verified, staged outside the live reader, and activated through a small atomic pointer. Readers pin immutable snapshots so an update cannot mix versions.                                                                                                                   |
| UM-006      | Guest routes are limited to `/pisocamp` and exact valid `/pisocamp/currency/...` locations. Saved Banknotes and Coins content remains readable in offline/paused states, with plain-language status and without requiring an account.                                                                                                                                                                               |

## Ticket acceptance criteria

| `docs/TICKETS.md` CE-1 criterion                                                       | Current evidence                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published items produce an incremented, checksummed, published-only bundle.            | Fresh PostgreSQL migration and builder integration passed. The live matrix covers exact current-published selection, coherent snapshots, strictly increasing versions with valid gaps, deterministic resources, signed manifests, ready-only monotonic pointer promotion, failed-build rollback, conditional pending clearing, lease recovery, and removal after the next successful full snapshot. |
| Online module open checks, stages, verifies, and atomically swaps changed entries.     | Focused real-files/controller tests passed. They cover manifest verification, unchanged 304, exact-origin resources, changed-only downloads, digest/length/MIME/magic checks, staging invisibility, crash recovery, and atomic activation.                                                                                                                                                          |
| Interrupted transfer resumes while the previous live bundle remains usable.            | Focused disconnect/restart/range tests passed and prove 206 resume with `If-Range`, malformed fallback handling, and old-live preservation. The load-sensitive cancellation cleanup defect and fix4 exhaustion gap were made deterministic and corrected; fresh fix5 stress and complete-suite verification passed as described below.                                                              |
| Airplane-mode Banknotes/Coins lists and details show all mandatory content and images. | Focused catalog and rendered widget tests passed for the verified packaged seed: five series, 29 denominations (15 banknotes and 14 coins), strict descriptions, neutral verified raster images, offline status, and guest list/detail rendering.                                                                                                                                                   |
| Unpublished content disappears after the next successful bundle and sync.              | The live PostgreSQL builder matrix proves authoritative full-snapshot removal. Store/catalog tests prove a newly activated published-only snapshot drops the absent published override and returns that denomination to the approved seed baseline while an already-open reader remains pinned.                                                                                                     |
| Item open provides the AN-1 analytics integration point.                               | Detail screens call an injectable `ContentViewAnalytics.recordOpen(logicalId)` once for a valid item. The default bridge is a no-op; slow or failing analytics never gates verified content. AN-1 remains the owner of event delivery.                                                                                                                                                              |

## Fresh PostgreSQL and public HTTP evidence

Acceptance used one exact, labelled PostgreSQL 16 Alpine container with a loopback-only published port. Database URLs and credentials are deliberately omitted from this document.

| Gate                                                                     | Result                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Complete serial database suite with CE-1 and CM-3 live-migration opt-ins | 13 files, 110 / 110 passed, zero skips                               |
| Live PostgreSQL bundle-builder integration                               | 1 suite, 12 / 12 passed with `--runInBand` and open-handle detection |
| Production-bootstrap anonymous bundle HTTP E2E                           | 1 suite, 5 / 5 passed with clean shutdown and open-handle detection  |
| Complete backend suite with all database opt-ins                         | 53 suites, 448 / 448 passed, zero skips, no open-handle warning      |

The composed HTTP run proved safe empty-current behavior, anonymous manifest/resource access, a strong exact-body ETag and 304 handling, immutable caching, exact content length/type, GET and HEAD behavior, valid and invalid byte ranges, opaque invalid/unknown 404s, and bounded production HTTP/Pino output under an induced repository failure.

After the server-side matrix, the exact disposable container was removed. Exact-name inspection reported it absent and the owned loopback port reported free.

## Cross-language, storage, and rendered mobile evidence

The full Node contracts suite passed 10 files and 158 / 158 tests. A focused Dart CE-1 suite passed 87 / 87 tests. Against the final fix5 tree, the complete default-concurrency Flutter suite passed 212 / 212 and the reduced two-file concurrency reproducer passed five consecutive runs of 35 / 35 (175 / 175 total). Together they covered:

- the same exact-byte Task 1 Ed25519 vector in Node and Dart;
- purpose-bound keys, altered payload/signature, unknown-key/algorithm, rollback/equal-version conflict, unsafe path/origin/redirect, manifest/resource bounds, MIME/magic, and privacy-safe failures;
- real temporary filesystem bootstrap, object reuse, recovery, staging, pointer replacement, and published-content removal;
- a controllable loopback HTTP server exercising disconnection, restart, 206 resume, 200 fallback, 304, 416, wrong ETag/range/MIME/length/digest, cancellation, retry, disk-full, and permission failures;
- offline list/detail rendering, pinned snapshots, semantic headings/images/status/control cardinality, keyboard activation, 48 dp controls, 320 px width, landscape, 200% text, reduced motion, and exception-free layout.

There is no deterministic screenshot/golden capture harness for these screens in the repository, so no screenshot artifact is claimed. The rendered widget assertions are the available deterministic proof. There is also no `apps/mobile/ios` host project, so iOS entitlement/device evidence is unavailable by approved design rather than simulated. Android release configuration declares `INTERNET` and denies cleartext traffic.

## Mobile acceptance defect and resolution

A fresh normal-concurrency complete Flutter run reproduced the previously unpreserved aggregate exactly: `+209 -1`. The sole failure was `bundle_review_fixes_test.dart:312`, `mid-stream cancellation retains only a safe resumable partial`: the partial file remained, but its resume journal did not.

Systematic isolation established:

- the single test passed five sequential reruns;
- the complete suite passed 210 / 210 with `--concurrency=1`;
- a reduced two-file `--concurrency=2` stress reproduced the same line-312 failure on the third iteration after two passes.

The evidence supported a cancellation/Windows handle-release race between visible partial bytes, atomic journal publication, response-stream cancellation, sink close, and suppressed best-effort deletion. A dedicated RED then held the real Windows file handle at the pre-journal cancellation point. The fix replaced suppressed deletion with bounded exact-path deletion, verified nonexistence, and a privacy-safe fail-closed error after exhaustion. When cleanup succeeds, terminal disk state is a valid part/journal pair or neither. If an operating-system lock exhausts all four attempts, synchronization fails closed with `partial_cleanup_failed`, preserves the old active bundle, explicitly surfaces the orphan, and recovery removes it after the lock is released.

Fresh Task 8 verification against the fix4 tree passed the reduced two-file reproducer five consecutive times at `--concurrency=2` (34 / 34 each, 170 / 170 total), then passed the complete default-concurrency Flutter suite 211 / 211. The original failure is retained here because it was a real CE-1 defect, not reclassified as unrelated.

Independent fix4 review nevertheless returned NEEDS CHANGES. `_retainOnlyValidPartial` caught the first `partial_cleanup_failed` and ran a second four-attempt cleanup sequence, so the claimed per-path bound was eight rather than four on that path. The notification-only retry observer could also interrupt repair if it threw, and the transient-lock test did not prove exhaustion.

Fix5 separated strict resume validation from cleanup, lets `partial_cleanup_failed` propagate without a second cleanup sequence, and contains observer exceptions. A deterministic real persistent-handle test proves exact notifications 1 through 4, stable privacy-safe `partial_cleanup_failed`, the prior version 0 remains readable, the physically locked orphan is surfaced rather than treated as success, and recovery removes it after the handle is released. Fresh Task 8 verification then passed five consecutive 35 / 35 reduced-concurrency runs and the complete 212 / 212 suite.

## Non-mobile regression and quality matrix

| Gate                                                     | Result                                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts tests                                          | 10 files, 158 / 158 passed                                                                                                                         |
| Database tests                                           | 13 files, 110 / 110 passed, zero skips                                                                                                             |
| Checked-in seed validator                                | Passed; the frozen signed manifest, resource index, content, and raster bytes reproduced exactly                                                   |
| Backend tests                                            | 53 suites, 448 / 448 passed, zero skips, no open-handle warning                                                                                    |
| Web tests                                                | 28 files, 230 / 230 passed                                                                                                                         |
| Read-only ESLint: contracts, DB, backend source/E2E, web | Exit 0. Backend reported four existing warning-level findings in unrelated legacy E2E files; zero errors.                                          |
| Workspace TypeScript                                     | 14 / 14 tasks passed                                                                                                                               |
| Direct production builds                                 | Contracts, DB, backend, and web passed; backend compiled 136 files with zero issues; web emitted 24 routes and 77 service-worker precache entries. |
| Workspace dependency lint                                | No issues found                                                                                                                                    |
| Relevant package formatting                              | Contracts, DB, backend source, and web all passed                                                                                                  |
| Aggregate workspace formatting                           | Exit 1 on the existing baseline only: 17 auth, 6 ESLint-tooling, and 3 Prettier-tooling files. Relevant CE-1 packages passed.                      |
| Complete Flutter tests                                   | 212 / 212 passed at default concurrency after fix5                                                                                                 |
| Mobile CE-1 analysis                                     | 6 scoped inputs, no issues                                                                                                                         |
| Mobile CE-1 formatting                                   | 25 files, zero changes                                                                                                                             |
| Complete mobile analysis                                 | Existing baseline only: 40 diagnostics outside CE-1; no CE-1 diagnostic                                                                            |
| Complete mobile formatting                               | Existing baseline only: 37 files outside CE-1; all 25 CE-1 files passed                                                                            |
| Android executable build                                 | Debug APK compiled successfully; main manifest has one `INTERNET` permission and denies cleartext                                                  |

The web build emitted only the expected notice that source-map upload is skipped without a Sentry upload token. No upload was attempted.

A production-artifact sentinel found no private-key PEM, database URI, assigned session token, or database credential in the CE-1 backend/contracts/generator/seed surfaces (test-only signature fixtures were excluded deliberately). A second scan of every packaged seed JSON resource found no actor, approval/publication identity, workflow comment, storage path, cookie, credential, private key, or database URL field.

The final disposable-index audit contains 105 approved CE-1 paths and zero unexpected paths, credential-like filenames, production-secret hits, or production unfinished markers. `git diff --check` passed and the real Git index remained empty. Exact cleanup checks found no labelled PostgreSQL container, no listener on the owned loopback port, and no remaining Dart/Flutter test or build process.

## Review contingencies

All implementation acceptance gates are green against fix5, and the focused independent fix5 review passed with zero Critical, Important, or Minor findings. This evidence is ready for cumulative CE-1 review, not foundation approval: a final code-reviewer verdict over the exact cumulative CE-1 diff from prerequisite `5948d9a` remains required. The earlier Task 7 tree was not used as cumulative authority because it omitted six tracked Task 1/2 modifications; Task 8 instead constructs the review tree directly from `HEAD` plus every current tracked and untracked CE-1 file through a disposable index. Nothing is placed in the real Git index.
