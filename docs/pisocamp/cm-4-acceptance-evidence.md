# CM-4 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `07e59a7` (CM-5)
Ticket: CM-4 — Version history and restore a prior approved version

## Result

All four CM-4 acceptance criteria are **PASS**. Evidence comes from contract,
service and Nest-level integration suites against a live PostgreSQL 16
database, plus a Chromium run against production builds with real Better Auth
sessions and the shared `cm5_acceptance_test` database.

## What CM-4 adds

| Layer | Surface |
| --- | --- |
| Database | `content_version.restored_from_version_id` (nullable) + `content_version_restored_from_check`, migration `20260902014205_cm4_version_restore` |
| Contract | `version-history.schema.ts`, two procedures on `pisoCampContentContract`, subpath export `@repo/contracts/pisocamp-version-history` |
| Backend | `ContentWorkflowService.listVersionHistory` and `.restore`, two `ContentController` routes |
| Web | `api/versions.hooks.ts`, `components/content-version-history-view.tsx`, route `app/(site)/pisocamp/content/[itemId]/versions`, entry point on the review screen |

- `GET /v1/admin/pisocamp/content/{itemId}/versions`
- `POST /v1/admin/pisocamp/content/{itemId}/versions/{versionNo}/restore`

Both require `content.items.restore`. Restore lives inside CM-3's workflow
service and reuses its transaction, `copyVersionAssets`, related-link copying
and `AuditService`; no second workflow engine was introduced.

## AC1 — history shows number, creator, date, approver, status and a diff

**PASS.** `listVersionHistory` returns every version newest-first with its
creator, creation time, approver + approval time, publisher + publication time,
transition action and comments, whether it is the current working or currently
published version, whether it is restorable, and a field-level difference
against the current working version over title, summary, body, currency series,
denomination, link address, related links and attachments.

- `content-version-restore.spec.ts` builds a real revision cycle
  (draft → submit → reject → edit → submit → approve) and asserts the ordering,
  the actors on each version, and that version 1 differs from the current one
  in exactly `body` and `relatedLinks` — and *not* in `title` or `summary`,
  which were unchanged.
- Paging is proven newest-first with no repeats across two pages.
- Chromium shows the same on the real screen: `cm-4-version-history-desktop.png`
  and `cm-4-version-history-mobile.png` (320 px). Versions 1 and 2 render
  "Summary", "Body" and "Related links" differences with both sides labelled;
  the current version says so instead of diffing against itself.

## AC2 — restore creates a new approved copy; published state is not bypassed

**PASS.** `restore` appends a new immutable version in `approved` state that
copies the *source* version's content, related links and attachments, records
`restored_from_version_id`, and moves the item to `approved`. It never sets
`current_published_version_id`, never sets `bundle_pending`, and never enqueues
a bundle rebuild — publication remains CM-3's `publish` transition.

- Asserted in `content-version-restore.spec.ts`: the restored version's status,
  its `approval` metadata, its null `publication`, the source's links copied
  through, `restored_from_version_id` pointing at the source, and
  `current_published_version_id` and `bundle_pending` unchanged.
- A separate test then publishes the restored version through CM-3 and asserts
  the rebuild request appears only then.
- A dedicated test proves the copy comes from the **source**, not the working
  version, using a historical approved version with different copy and links.
- In the browser the restore response was `200` with `status: "approved"` and
  `publication: null`, and the acceptance database afterwards showed the item
  still pointing at published version 4 while versions 5–11 are `approved` with
  `restored_from_version_id` set.

Only `approved` and `published` versions are restorable, and only from an item
that is not `submitted_for_review` (a decision is pending) or `archived`
(read-only under BR-001). Both refusals are tested, and both leave no version
and no audit row behind.

## AC3 — a caller without `content.items.restore` is refused and audited

**PASS.** Both routes declare the permission and `RbacGuard` runs before the
handler.

- `content-restore.authorization.spec.ts` (real Nest app, real PostgreSQL):
  a holder reads history and restores successfully with one `content.restore`
  audit; a caller without the key gets 403 on *both* routes with two
  `rbac.permission_denied` audits and no new version; a deactivated holder gets
  401 before permission resolution with no audit at all.
- In Chromium the editor identity was redirected off the page, and direct API
  calls returned 403 for both routes. The acceptance database recorded
  `ContentController.listContentVersions` and
  `ContentController.restoreContentVersion` denials, each with
  `requiredPermissions: ["content.items.restore"]`.

## AC4 — the restore is audited with the source version id

**PASS.** One `content.restore` audit per restore, `outcome: success`,
`targetType: content_item`, with `oldValue` carrying `sourceVersionId`,
`sourceVersionNo`, `sourceState` and the item's `fromState`, and `newValue`
carrying the new version id and number, `toState: approved` and the reason.
The reason is mandatory in the contract: a restore approves content without a
fresh review, so the justification is on the record.

Six `content.restore` audits accumulated across the browser runs, each naming
its source version.

## Design decisions worth recording

- **A restore is an approval.** The restored version is stored with
  `transition_action = 'approve'` and approver metadata, so it satisfies the
  existing lifecycle and transition check constraints without weakening them.
  `restored_from_version_id` is what distinguishes it in history, guarded by a
  check constraint that only allows the column on an approved, approve-action
  version.
- **No foreign key on `restored_from_version_id`,** matching the existing
  `parent_version_id`: a self-referential composite key makes the table's own
  Drizzle type circular. Same-item scoping is enforced by the service, which
  only ever looks the source up by `(itemId, versionNo)`.
- **The new version number is `max(version_no) + 1`,** not
  `current.version_no + 1`. A restore source is any historical version, so
  history can legitimately hold a number above the working pointer, and the
  naive form would collide with the unique constraint. CM-3's transitions are
  unchanged; in the normal flow the two are identical.
- **Live content stays live.** Restore moves the item to `approved` but leaves
  `current_published_version_id` alone and enqueues no rebuild, so reverting a
  bad publication never blanks the app before the replacement is published.

**Reachability note.** With only CM-1 and CM-3 transitions an item cannot yet
hold two *approved* versions whose copy differs: editing requires a draft, and
a published item has no transition back to draft until CM-6 adds unpublish. The
service copies from the source regardless, and that is proven with a historical
approved version seeded directly. The end-to-end reverting-a-bad-publication
journey becomes fully reachable with CM-6.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 15 files, 221 tests passed |
| `@repo/db` vitest (live PostgreSQL, migration opt-in) | 15 files, 91 passed, 32 skipped |
| `@repo/backend` jest (live PostgreSQL) | 69 suites passed, 2 skipped; 590 passed, 48 skipped, 0 failed |
| `@repo/web` vitest | 37 files, 310 tests passed |
| Playwright `cm4-versions-authenticated` | 3 passed, repeated 4× green |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

Three sibling tests were updated because CM-4 legitimately changed what they
assert: the contract-surface list gained `versions` and `restore`, the schema
column list gained `restoredFromVersionId`, and CM-2's "exactly one migration
after AN-1" check now scopes itself to CM-2's own migration rather than
forbidding every later one.

## Console, network and server-log cleanliness

The browser run asserts zero page errors, zero console errors or warnings, zero
failed requests and zero error responses, with the same two documented
exceptions as CM-5: aborted RSC prefetches, and — in the denial test only — the
dashboard shell prefetching `/user-management` for an identity that may not read
it. Backend logs show no ERROR lines from the CM-4 routes.

One Playwright interaction note: driving the confirmation dialog needs
`focus()` + `Enter` after `waitForLoadState("networkidle")`, because the
dashboard shell keeps route prefetches in flight and Playwright's click
actionability blocks on them. That is a test-harness detail, not a defect —
keyboard operation of the dialog is also the accessibility evidence.

## Accessibility and responsiveness

Verified in Chromium and in component tests: one `h1` with `h2` per version and
`h3` per difference block, a labelled `region` per version's differences, a
labelled required reason field with help text and a focused `alert` when it is
missing, a confirmation dialog before the destructive restore, a polite status
region on success and an assertive focused alert on conflict, no horizontal
overflow at 320 px, and a ≥44 px back control.
