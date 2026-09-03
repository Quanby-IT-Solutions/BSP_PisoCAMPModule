# AR-2 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `6c1158f` (SA-6)
Ticket: AR-2 — AR experience content admin

## Result

All four AR-2 acceptance criteria are **PASS**.

## What AR-2 adds

| Layer | Surface |
| --- | --- |
| Schema | `ar_experience_detail`; the `ar_experience` content type; the `ar_model` asset role |
| Contract | `ArExperienceDraftSchema`, `PisoCampArDeviceRequirementSchema` |
| Backend | Child-row write, read and carry-forward; the submit-time asset rule |
| Web | The AR fields in the content form |

Migration `20260903070000_ar2_experience_detail`, applied to all four local
databases.

## AC1 — an experience saves as a draft with its assets and requirements

**PASS.** An `ar_experience` item names its series and denomination, its device
requirement and its animation length, and saves as `draft` like every other
content type.

**The device requirement is the two things a device actually has to satisfy** —
an Android SDK level for ARCore and an iOS version for ARKit — rather than one
"minimum capability" word that would mean something different on each platform.
At least one must be given: an experience naming neither platform is one nobody
can run, enforced in the contract and by a database CHECK.

A **blank platform box means unsupported, not zero**: asserted in the form tests
and stored as null.

The denomination must exist: a foreign key to the currency catalogue and CM-1's
existing reference check both refuse an unknown one. The list shows what a
device needs, so a reviewer sees it without opening the item.

## AC2 — a missing mandatory asset blocks submission

**PASS.** An AR experience cannot be submitted for review without its **3D
model, its animation and its narration**. Asserted three ways: none attached,
two of three attached, and all three attached — with the message naming what is
missing.

The rule runs at **submission**, not at draft time, because an editor has to be
able to save work in progress, and it applies only to AR experiences — an
advisory still submits with no assets at all, asserted.

The list of required roles lives in the contract beside the content type it
describes, so the form's help text and the server's rule cannot drift apart.

## AC3 — CM-3's workflow rules apply unchanged

**PASS.** An experience goes draft → submitted → approved → published through
the same transitions, with the same optimistic concurrency (a stale
`expectedVersionNo` is a 409) and the same lifecycle rules (publishing a draft
is refused). Both asserted.

### A defect found and fixed

The workflow copies each content type's child row forward when it creates a new
version. The AR row was **not** in that list at first, so an approved experience
came back with a null device requirement and a null animation length — the
figures an approver had just reviewed silently disappeared on approval. Caught
by the "carries the experience through review to publication" case, fixed in
`copyChildDetails` beside the trivia and survey rows.

## AC4 — permission, both ways

**PASS**, on the same `content.items.edit` as every other content type, through
the shared `RbacGuard`. `ar-experience.authorization.spec.ts` proves both
branches against a real HTTP route: a holder creates one, a caller without it is
refused **403** with exactly one `permission_denied` audit and nothing written,
and a request with no session is refused 401 before any denial audit.

Assets are uploaded through CM-2's existing `content.assets.upload` path, which
AR-2 does not change.

## Browser validation

`ar2-experiences.authenticated.spec.ts` — **4 passed**: a person selects "AR
experience", fills the denomination, both platform requirements and the
animation length, and saves a draft that appears in the list; the form states
which assets are needed before review; and the page has no horizontal overflow
at 320 px with focusable 44 px controls.

`ev1-surveys.authenticated.spec.ts` — **6 passed** alongside it, so the shared
form still behaves as it did.

### A second defect, found by the 320 px case

The form's shared text field rendered at **32 px**, while its selects and the
survey inputs were 44 px. The AR fields inherited the smaller target, and the
accessibility case caught it. Fixed on the shared field rather than on the three
new ones: every text input in the content form is now 44 px, which is what the
rest of the form already promised.

## Test evidence

| Suite | Result |
| --- | --- |
| backend jest `--runInBand` | 113 suites, 1002 passed, 48 skipped |
| `apps/web` vitest | 54 files, 498 passed |
| `packages/contracts` vitest | 23 files, 377 passed |
| `packages/e2e-web` Playwright | 10 passed (AR-2 and EV-1) |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The API log carries no error-level line; the only non-2xx are the 403s from
another spec's deliberate denial case and better-auth's sign-in rate limit.

## Shared code reused, not duplicated

- The content type joins CM-1's existing draft union, CM-2's asset attachment
  and CM-3's workflow: no parallel pipeline for AR.
- The child row follows EV-1's `survey_detail` pattern exactly, including how it
  is written, read, joined and carried forward.
- The form reuses the currency series and denomination selects the banknote,
  coin and security-feature types already use.

## Notes

- **Rendering is AR-1's and AR-3's**, as the ticket says. This ticket is the
  admin side only: what an experience is, what it needs, and what has to be
  attached before anybody reviews it.
- `animationDurationMs` is stored now because AR-3 has to check the narration
  against the animation timeline to ±100 ms, and that check needs a number
  somebody entered deliberately rather than one read off a file at play time.
