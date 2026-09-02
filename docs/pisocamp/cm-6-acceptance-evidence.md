# CM-6 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `3ee23d9` (CM-4)
Ticket: CM-6 — Unpublish, deactivate, archive and scheduled publication

## Result

All five CM-6 acceptance criteria are **PASS**. Evidence comes from contract,
service and Nest-level integration suites against a live PostgreSQL 16
database, plus a Chromium run against production builds with real Better Auth
sessions.

## What CM-6 adds

| Layer | Surface |
| --- | --- |
| Database | `content_item.publish_at` + `publish_at_by` with a paired check, a partial index, and both `content_version` transition checks extended for the three new actions; migration `20260902021945_cm6_lifecycle_and_schedule` |
| Contract | Three withdrawal inputs, a schedule input, `publishAt` on the review detail, and the workflow-action enum extended from four to seven |
| Backend | Three transitions in CM-3's allowed-transition table, `schedulePublication`, `publishDueScheduled`, `ContentScheduleWorker` |
| Web | `ContentLifecycleActions` on the review screen: confirmed withdrawal buttons and a scheduled-publication field |

Routes, all gated by `content.items.publish`:

- `POST /v1/admin/pisocamp/content/{itemId}/unpublish`
- `POST /v1/admin/pisocamp/content/{itemId}/deactivate`
- `POST /v1/admin/pisocamp/content/{itemId}/archive`
- `PUT  /v1/admin/pisocamp/content/{itemId}/schedule`

All three withdrawals go through CM-3's existing `transition` method — the same
locking, the same immutable version append, the same audit write. No second
workflow engine was introduced, and the allowed-transition table remains the
single place that says what is legal.

## AC1 — unpublish removes content at the next bundle build, audited

**PASS.** `unpublish` moves `published → unpublished`, appends the version,
clears `current_published_version_id`, sets `bundle_pending`, and enqueues a
rebuild request so the next build actually runs.

- `content-lifecycle.spec.ts` asserts the item leaves
  `listPublishedBundleCandidates` (the exact set the bundle builder reads),
  that `current_published_version_id` becomes null, that a second rebuild
  request appears keyed on the version this transition created, and that one
  `content.unpublish` audit records `fromState: published` and
  `toState: unpublished`.
- In Chromium the confirmed action returned `unpublished` at version 5 and the
  item was absent from the signed bundle manifest read straight from
  `GET /v1/pisocamp/bundle/manifest`.

The CE-1 trigger that guarded the rebuild queue (`only a published transition
version can be enqueued`) was widened to the four bundle-affecting transitions,
because a withdrawal changes bundle contents exactly as a publication does.

## AC2 — deactivate stops the content being presented at all

**PASS.** `deactivate` accepts both `published` and `unpublished` as origins, so
an obsolete note can be pulled out of circulation in one step. It also clears
the published pointer and enqueues a rebuild, and the item is gone from the
published candidate set — which is the single source every end-user surface
reads, trivia selection included, because only `published` items ever enter a
bundle.

Proven for both origins in `content-lifecycle.spec.ts` and end-to-end in
Chromium, where a live item was deactivated in one step.

## AC3 — archive is read-only, retained, and out of the default lists

**PASS.** `archive` is only legal from `deactivated` (asserted: archiving a
published or unpublished item is refused with no version and no audit written).
Every version stays in the database — the archive test counts them — because
`content_version` has an immutability trigger and nothing deletes rows.
`archived` is outside the review queue's status filter and outside the bundle
candidate set. In Chromium, an archived item offers no further lifecycle
control at all.

## AC4 — an approved item with `publish_at` is published by a scheduled job

**PASS.** `schedulePublication` records `publish_at` and `publish_at_by` on an
approved item and audits `content.schedule` with before/after. It publishes
nothing itself. `publishDueScheduled` then finds approved items whose instant
has passed and promotes each through the same `transition("publish", …)` an
approver would use.

- `content-lifecycle.spec.ts` proves: nothing happens before the instant; at the
  instant the item becomes `published` with a rebuild request; the published
  version's `published_by` is the **approver who scheduled it**, not a synthetic
  system account; a second run publishes nothing more and writes no further
  audit — the idempotency the ticket requires; and a hand-made transition clears
  the schedule so the worker cannot publish it twice.
- `ContentScheduleWorker` is opt-in (`PISOCAMP_SCHEDULE_WORKER_ENABLED`),
  polls rather than sleeping to a deadline, and never runs two passes at once.
  Both the disabled and enabled paths are asserted.
- In Chromium a schedule was saved and cleared through the real screen, with
  the instant sent as UTC and rejected when in the past.

## AC5 — a caller without `content.items.publish` is refused and audited

**PASS.** `content-lifecycle.authorization.spec.ts` (real Nest app, real
PostgreSQL) proves 403 plus one `rbac.permission_denied` audit on **each** of
the four routes, with no content version written, and 401 before permission
resolution for a deactivated holder. The permitted holder's withdrawal writes
exactly one `content.unpublish` success audit.

In the browser run the editor identity was refused on all four routes. The
acceptance database recorded denials naming
`ContentController.unpublishContent`, `deactivateContent`, `archiveContent` and
`scheduleContentPublication`, each with
`requiredPermissions: ["content.items.publish"]`.

## Design decisions worth recording

- **Withdrawal keeps provenance.** An unpublished, deactivated or archived
  version carries forward the approver and publisher of the version it
  withdraws. History has to keep saying who approved and who published the
  content that was live; the existing lifecycle check constraint already
  required it.
- **The scheduler acts as the approver who scheduled it.** `publish_at_by` is a
  real account, so a scheduled publication names an accountable person rather
  than a robot, and no synthetic system user has to be seeded.
- **A schedule belongs to the state it was set in.** Every transition clears
  `publish_at` in the same statement that changes status, and a check
  constraint refuses the column on anything but an approved item, so a stale
  schedule cannot survive a workflow move.
- **`deactivate` accepts two origins.** The allowed-transition table's `from`
  became a list rather than a single state; the audit records the state actually
  left, not the list.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 16 files, 227 tests passed |
| `@repo/db` vitest (live PostgreSQL, migration opt-in) | 15 files, 91 passed, 32 skipped |
| `@repo/backend` jest (live PostgreSQL) | 71 suites passed, 2 skipped; 609 passed, 48 skipped, 0 failed |
| `@repo/web` vitest | 38 files, 322 tests passed |
| Playwright `cm6-lifecycle-authenticated` | 5 passed, repeated 4× green |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

Sibling tests updated because CM-6 legitimately changed what they assert: the
contract-surface list gained four procedures, the `content_item` column list
gained `publishAt`/`publishAtBy`, and the CM-3 review-detail fixtures gained
`publishAt: null`.

The browser spec builds its own item through the real CM-1/CM-3 workflow on
every run rather than using a static fixture, because every CM-6 transition is
one-way — a seeded item would be spent after a single run and the suite would
stop being repeatable.

## Console, network and server-log cleanliness

The browser run asserts zero page errors, zero console errors or warnings, zero
failed requests and zero error responses, with the same two documented
exceptions as CM-4 and CM-5: aborted RSC prefetches, and — in the denial test
only — the dashboard shell prefetching `/user-management` for an identity that
may not read it. No ERROR lines appeared from the CM-6 routes.

## Accessibility and responsiveness

Every destructive step is behind a confirmation dialog whose text says what end
users will see ("removed from the app at the next bundle build", "never
presented to end users again — not in Currency Education, and not in trivia
selection"). The schedule field is a labelled `datetime-local` input with help
text and a focused `alert` when the time is in the past. Success is announced
in a polite status region, failure in an assertive focused alert. Verified in
Chromium at 320 px: no horizontal overflow, keyboard-operable controls, ≥44 px
targets.
