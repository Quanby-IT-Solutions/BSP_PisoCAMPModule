# CM-7 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `d3e864b` (CM-6)
Ticket: CM-7 — Content audit history view

## Result

All three CM-7 acceptance criteria are **PASS**. Evidence comes from contract,
service and Nest-level integration suites against a live PostgreSQL 16
database, plus a Chromium run against production builds with real Better Auth
sessions.

## What CM-7 adds

| Layer | Surface |
| --- | --- |
| Database | `audit_log_target_idx` on `(target_type, target_id, created_at desc)`; migration `20260902024557_cm7_content_audit_index` |
| Contract | `content-audit.schema.ts` with a closed action list, one procedure, subpath export `@repo/contracts/pisocamp-content-audit` |
| Backend | `ContentAuditService`, one `ContentController` route |
| Web | `api/audit.hooks.ts`, `components/content-audit-view.tsx`, route `app/(site)/pisocamp/content/[itemId]/audit`, entry point on the review screen |

`GET /v1/admin/pisocamp/content/{itemId}/audit`, gated by `content.audit.view`.

The view is a read over the append-only trail every content ticket already
writes to through the shared `AuditService`. No new audit table, no new writer,
and no write path of any kind: the trail is evidence precisely because the
screen that shows it cannot shape it.

## AC1 — every transition and edit with actor, timestamp, states and comments

**PASS.** `ContentAuditService.list` returns each entry with its action, the
`fromState`/`toState` of a workflow transition (null for an edit or an asset
action), the version the action produced, the comments, the actor, and a UTC
timestamp.

- `content-audit.service.spec.ts` drives a real create → edit → submit →
  approve → publish → unpublish sequence and asserts the exact six actions
  newest-first, that unpublish carries `published → unpublished` with its
  comments and actor, that approve carries `submitted_for_review → approved`
  with "Checked", and that an edit correctly carries **no** states.
- An item's trail includes entries recorded against its *versions* as well as
  against the item, so CM-5's version-scoped preview audit appears in the
  item's history. Asserted, along with strict scoping: a second item's history
  contains only its own single entry.
- Denials and other domains never appear: an `rbac.permission_denied` row and a
  denied `content.publish` row targeting the same item are both excluded while
  remaining in the table.
- In Chromium the page shows five entries for a freshly built item with
  "Approved → Published", both comment strings, "Edited", "Created" and the
  actor's name.

## AC2 — filters narrow the results

**PASS.** Actor, action and an inclusive date range are applied server-side, so
narrowing and paging agree with each other on a trail that keeps growing.

- `content-audit.service.spec.ts` asserts each filter alone and in combination:
  three entries for the editor, one for `content.approve`, zero for a range
  entirely in the future, zero for a range entirely in the past, all six for an
  open-ended past bound, and one for actor + action + range together.
- Paging is proven newest-first with no repeated entry across two pages.
- The screen resets to page 1 whenever a filter changes, offers a single Clear
  Filters control that is disabled when there is nothing to clear, and refuses
  an inverted range with a focused `alert` while suppressing the query entirely
  rather than sending a range the server would reject.
- In Chromium: filtering to Approved shows one entry, filtering to Rejected
  shows the empty-state explanation, and Clear Filters (operated by keyboard)
  restores the whole trail.

## AC3 — a caller without `content.audit.view` is refused and audited

**PASS.** `content-audit.authorization.spec.ts` (real Nest app, real
PostgreSQL) proves a holder reads the trail **without changing it** — the
audit table is byte-identical before and after — that a caller without the key
gets 403 with one `rbac.permission_denied` audit, and that a deactivated holder
gets 401 before permission resolution.

In the browser the editor identity was redirected off the page and received 403
from the API directly. The acceptance database recorded four
`ContentController.listContentAudit` denials across the runs.

## Design decisions worth recording

- **A closed action list.** The contract enumerates the sixteen actions this
  view knows how to explain. A row with an unknown action is dropped rather
  than rendered as an unlabelled mystery, and the filter is a dropdown rather
  than free text.
- **Scoped to item *and* its versions.** Preview and other version-scoped
  actions belong to the item's history; reading only item-targeted rows would
  quietly hide them.
- **Successes only.** Denials are the system-wide audit viewer's business
  (SA-4). A per-item governance history that mixed refused attempts with what
  actually happened would be harder, not easier, to verify against.
- **An index before the first target-scoped read.** `audit_log` had indexes for
  time and actor but none for target; CM-7 is the first reader that filters by
  one.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 17 files, 232 tests passed |
| `@repo/db` vitest (live PostgreSQL, migration opt-in) | 15 files, 91 passed, 32 skipped |
| `@repo/backend` jest (live PostgreSQL) | 73 suites passed, 2 skipped; 618 passed, 48 skipped, 0 failed |
| `@repo/web` vitest | 40 files, 339 tests passed |
| Playwright `cm7-audit-authenticated` | 4 passed, repeated 4× green |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

Two sibling tests updated because CM-7 legitimately changed what they assert:
the contract-surface list gained `audit`, and `ContentController`'s unit spec
gained the new injected service.

The browser spec builds its own item through the real workflow on every run, as
CM-6's does, so the suite stays repeatable against a cumulative acceptance
database.

## Console, network and server-log cleanliness

The browser run asserts zero page errors, zero console errors or warnings, zero
failed requests and zero error responses, with the same two documented
exceptions as CM-4 to CM-6: aborted RSC prefetches, and — in the denial test
only — the dashboard shell prefetching `/user-management` for an identity that
may not read it.

One Playwright note: the filter test waits for `networkidle` before touching
the native `<select>`. A rendered page is not a hydrated one, and a select
changed before hydration updates the DOM value while reaching no React handler —
a test-harness detail, not a defect.

## Accessibility and responsiveness

Labelled `select` and `datetime-local` controls, a focused `alert` for an
inverted range wired through `aria-describedby`, a labelled `navigation`
landmark for paging with a `status` describing the current page, an accessible
loading region, and a focused retryable error. Verified in Chromium at 320 px:
no horizontal overflow, keyboard-operable filters, ≥44 px targets. A component
test asserts the page offers exactly one button — Clear Filters — so nothing on
the screen can alter the history it shows.
