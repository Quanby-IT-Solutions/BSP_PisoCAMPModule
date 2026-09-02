# GM-1 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `0398db8` (F6)
Ticket: GM-1 — Manage trivia questions through the content workflow

## Result

All four GM-1 acceptance criteria are **PASS**.

The ticket's own framing is the design: *questions are content*. There is no
trivia workflow, no trivia approval, no trivia audit. A question is created,
submitted, approved and published by CM-3's existing service, and what GM-1 adds
is only what a question has that other content does not.

## What GM-1 adds

| Layer | Surface |
| --- | --- |
| Database | `trivia_question` content type; `trivia_question_detail` keyed by `content_version_id`; two immutable helper functions so the choice rules are enforceable as CHECKs; migration `20260902070829_gm1_trivia_questions` |
| Contract | `TriviaQuestionDraftSchema`, `TRIVIA_DIFFICULTIES`, category and difficulty list filters |
| Backend | Child row written on create and edit, carried through every transition and restore; inactive questions withheld from the bundle; questions rendered into the bundle with their choices |
| Web | Question fields on the draft form, choices shown to reviewers, category and difficulty filters on the list |

## Design decisions worth recording

**The question text is the version's title and the explanation is its body.**
Both are then versioned, diffed, searched and audited by machinery that already
exists and does not need to know what a question is. Only category, difficulty,
choices and the active flag live in the child table.

**Choices are JSONB, not a second child table.** A question's choices are
meaningless apart from it and are always read, written and versioned together —
and "exactly one is correct" becomes one check on one row instead of a
constraint spanning rows. A PostgreSQL `CHECK` cannot contain a subquery, so two
immutable functions do the counting and the label validation.

**The correct answer travels to the device.** Selection and marking both happen
offline, so the bundle document carries `correct` on each choice. Asserted in the
rendered bytes.

**An inactive question is withheld exactly as a second-level security feature
is.** Both are published items the bundle must not carry, so both go through the
same exclusion at the one place that decides what a bundle contains, and both
are reported by reason. The build warning CE-3 added now names either cause.

## AC1 — a question with 2–6 choices, one correct, saves as a draft

**PASS.** `trivia-question.spec.ts` creates a question through the real service
against live PostgreSQL and asserts it lands as `draft` with its category,
difficulty, active flag and all three choices intact and in order.

The bounds are proven from both ends: 2, 3, 4, 5 and 6 choices are accepted; 1
and 7 are refused; no-correct and two-correct are refused; and after the
refusals `trivia_question_detail` is asserted **empty**, so a rejected question
leaves nothing behind.

The contract states the same rules — 8 tests covering the counts, the single
correct answer, repeated, empty and marked-up labels, the catalog-shaped
category, the known difficulties, and the explicit active flag. A padded label is
**normalised** rather than refused, and that is pinned too, because the database's
`btrim(label) = label` check is the backstop and the two must not disagree.

The database enforces it independently, and the tests name **which** constraint
refused each write rather than merely that something did: the 2–6 shape, the
single correct answer, duplicate/empty/marked-up labels, and a category that is
not a catalog code.

On the web, the choice editor makes the invalid states hard to reach rather than
merely reportable: it starts with the two choices a question needs, will not let
either be removed, will not add a seventh, and marks the correct answer with a
**radio** — a control that cannot express two correct answers at all. Seven tests.

## AC2 — an inactive question is excluded from selection even when published

**PASS.** A question published and then marked inactive:

- does not appear among the bundle candidates;
- is reported as `{ itemId, versionId, reason: "inactive_trivia_question" }`;
- **remains `published`** — checked explicitly, because it is withheld, not
  withdrawn;
- leaves nothing in the rendered bytes: the bundle is asserted not to contain its
  title.

The form's toggle carries the flag, and the reviewer's screen states it in words
("Inactive — withheld from the app") rather than as a bare boolean.

## AC3 — it follows CM-3 exactly, and only published + active questions enter the bundle

**PASS.** The suite drives a question through submit → approve → publish using
CM-3's service unchanged, and asserts CM-3's own guards still apply to it: an
approve before submission is refused, a stale `expectedVersionNo` is refused, and
a rejection returns the item to `draft`.

Because a transition creates a **new version row**, the child row is copied with
it — otherwise a submitted question would have no answers. Asserted directly:
after create → submit → approve → publish there are four detail rows, each
carrying all three choices. The restore path copies from the **source** version
for the same reason CE-1's assets do: restoring copy while keeping the current
choices would produce a combination nobody approved.

## AC4 — a caller without `content.items.edit` gets 403 and an audit

**PASS**, both branches, on the route that creates a question:

- a holder of `content.items.edit` authors one, and the item is written;
- a caller without it gets **403**, **nothing** is written, and exactly one
  `rbac.permission_denied` row names the handler;
- an unauthenticated request is refused **before** any permission denial is
  recorded, so an unauthenticated probe cannot fill the audit log.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 17 files, 254 tests passed |
| `@repo/db` vitest (live PostgreSQL, migration opt-in) | 16 files, 101 passed, 32 skipped |
| `@repo/backend` jest (live PostgreSQL, `--runInBand`) | 76 suites passed, 2 skipped; 642 passed, 48 skipped, 0 failed |
| `@repo/web` vitest | 40 files, 358 tests passed |
| `flutter test` | 509 passed, 1 skipped |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

Sibling changes, all because GM-1 legitimately changed what they assert: the
content-type vocabulary grew by one in the contract and `@repo/db` tests, and the
admin list's own type filter gained the new type (a real bug caught by the new
list tests — without it the question filters never appeared).

## A note on the mobile client

A published question now reaches the bundle, and the mobile catalog reader
ignores it: `parsePublished` requires an exact key set, a question's keys differ,
and the catalog load already discards documents it cannot read. That is the
correct behaviour for GM-1 — the pool exists on the device without being shown —
and GM-2 is the ticket that reads it.

## Scope note

The list filter for `active` was built and then removed. `z.stringbool()` splits
the schema's input and output types, which propagated a `string` vs `boolean`
mismatch into every caller of the list query; the ticket asks for
"category/difficulty filters", so the third filter was not worth that cost. The
`active` flag is shown on each question and enforced everywhere it matters.
