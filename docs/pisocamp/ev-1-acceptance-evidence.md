# EV-1 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `8359322` (GM-3)
Ticket: EV-1 — Manage surveys through the content workflow

## Result

All four EV-1 acceptance criteria are **PASS**.

## What EV-1 adds

| Layer | Surface |
| --- | --- |
| Database | `survey_detail` and `survey_question`; the three content-type CHECKs widened to admit `survey` |
| Contract | `survey` content type, `SURVEY_PURPOSES`, `SURVEY_SCALES`, `NPS_BANDS`, `npsBandFor`, the question union, the list filter and the summary |
| Backend | `toSurveyDetailValues` / `toSurveyQuestionValues`, `withChildDetails`, `copyChildDetails`, bundle rendering, purpose filter and question count |
| Web | Survey fields on the content form, survey rendering in the review view, purpose filter in the list |

## A survey is content

There is no survey workflow, no survey approval and no survey audit. A survey is
created, submitted, approved and published by CM-3's existing service, and this
ticket adds only what a survey has that other content does not: a purpose, a
subject, and questions.

The title is what a person is asked to take part in and the body is the
explanation, so both are versioned, diffed and audited by machinery that does
not need to know what a survey is.

## AC1 — a survey saves as a draft with purpose, questions and an optional link

**PASS.** `survey.spec.ts` (live PostgreSQL) asserts a new survey is `draft` at
both the item and the version, keeps its purpose, and stores its questions in
the order the editor arranged them at positions 0, 1, 2.

Position is the array index rather than an input: an editor moves a question by
moving it, and two questions claiming position 3 is a state the form should not
be able to express. The database refuses it anyway — asserted.

`subjectContentItemId` is the topic or feature the survey evaluates. A column
rather than a related link, because EV-3 has to find the survey for a topic that
was just completed, and searching a generic link list for that is a different
question than asking a survey what it is about. A survey about **itself** is
refused by CHECK, because that would make EV-3's trigger a loop; a subject that
does not exist is refused by the foreign key. Both asserted.

Questions are a child table rather than JSONB — unlike a trivia question's
choices — because EV-2's responses reference a question by id and AN-6 reports
one question at a time.

## AC2 — the NPS wording and grouping are stored per the SRD

**PASS.** A rating stores 1–5, an NPS stores 0–10 with promoter ≥ 9 and passive
≥ 7, and a text question stores no scale at all. Asserted on the stored rows,
and on `npsBandFor` at every boundary: 10 and 9 promoter, 8 and 7 passive, 6 and
0 detractor.

Storing the banding makes it data a report reads rather than arithmetic every
reader repeats, and `survey_question_shape_check` is what stops it drifting: the
constraint pins the scale and the bands to the kind. A row that tried to run a
rating 1–7, or an NPS whose promoter band started at 8, or a scale with one end
unworded, is refused even when the contract is bypassed — four such cases
asserted, plus an unknown kind, an out-of-range position and a marked-up prompt.

The scales are constants of the answer type rather than fields an editor fills
in. Two surveys that both asked "rate this 1 to N" with different N could not be
reported together, and an NPS that did not run 0–10 would not be an NPS. The
contract refuses an editor-supplied scale; asserted.

## AC3 — CM-3's workflow applies, and only published surveys bundle

**PASS.** Submit → approve → publish leaves four versions, each with its own
detail row and its own questions: a transition creates a new version row, and a
survey whose questions did not come with it would be a survey with nothing to
ask. Asserted by counting distinct versions in `survey_question`.

A draft survey is not a bundle candidate and a published one is. The rendered
document carries the purpose, the subject and the questions — a survey travels
with its questions because EV-2 presents it offline — and carries **none** of
the trivia keys, so a client checking its keys exactly can still tell the two
document shapes apart. Asserted.

Editing replaces the questions on the new version and leaves the previous
version's intact, and the audit trail names `purpose` and `questions` among the
changed fields. Asserted.

## AC4 — 403 and an audit entry without `content.items.edit`

**PASS.** Both branches, on the route that creates a survey
(`survey.authorization.spec.ts`): a holder of `content.items.edit` authors one
and the item is written; a caller without it gets 403, **nothing** is written,
and exactly one `permission_denied` audit row names the handler. An
unauthenticated request is refused with 401 before any denial is recorded.

The browser run adds the other half: a signed-in user without the permission
never reaches the form at all.

## Browser validation

`ev1-surveys.authenticated.spec.ts`, Playwright/Chromium against the built web
app and the running backend — **7 passed**, including the two setup projects.

- A survey is authored end to end and appears in the content list.
- The scale wording follows the answer type: 1 and 5 for a rating, 0 and 10 for
  an NPS, neither for a written answer.
- An NPS survey with no NPS question is refused, the reason is shown on the
  page, and the form stays put.
- At 320 px there is **no horizontal overflow**, the purpose select and the
  question prompt are keyboard-focusable with touch targets of at least 44 px,
  and "Add question" works from the keyboard.
- Every test asserts the console carries no errors or warnings, no request
  failed, and no response was 4xx or 5xx.

The backend log for the run carries nothing attributable to EV-1.

## A defect the browser found

**The content form's select triggers were 38 px tall at 320 px.**
`REFLOW_SELECT_TRIGGER_CLASS` set `min-h-8`, which with its padding came out
below the 44 px target the module holds elsewhere. Raised to `min-h-11` in both
places that define it, so every select on the content form and the related-links
editor is fixed, not only the two EV-1 adds. Re-verified in the browser.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 18 files, 281 tests passed (+10) |
| `@repo/db` vitest | 16 files, 101 passed, 32 skipped |
| backend jest `--runInBand` | 81 suites, 671 passed, 48 skipped (+2 suites, +16) |
| `web` vitest | 40 files, 366 passed (+8) |
| `packages/e2e-web` Playwright | 7 passed |
| `flutter test` | 592 passed, 1 skipped (unchanged) |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

`pisocamp-currency-catalog.spec.ts` pinned the content vocabulary at six types
and now pins seven. That is the test doing its job: the vocabulary is frozen on
purpose, and widening it is a deliberate act recorded here.

## Notes on the migration

Drizzle does not diff CHECK constraint changes, so the three constraints that
enumerate the content types (`content_item_type_check`,
`content_version_type_check`, `content_version_fields_check`) are dropped and
recreated by hand in `20260902100000_ev1_survey_content`. Applied to all four
local databases and verified by reading the constraint back.

## Scope notes

- **Presentation is EV-2 and triggers are EV-3.** The survey document is in the
  bundle, and the mobile catalog reader ignores it: both of its parse loops
  swallow a document they cannot read, so a survey resource is inert on the
  device until EV-2 adds a reader for it.
- **The subject is validated as an existing content item, not as a topic.** The
  ticket says "topic/feature link"; which kinds may be a subject is a judgement
  EV-3 is better placed to make, and the foreign key already refuses anything
  that is not content.
- **The e2e environment needed seeding.** The local app database had no users
  and the seeded System Administrator held no content permission, so no
  content-admin browser test could have run against it. Seeded, and the admin
  granted Content Administrator and Content Approver.
