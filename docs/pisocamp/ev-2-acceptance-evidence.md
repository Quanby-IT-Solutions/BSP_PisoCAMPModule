# EV-2 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `94a7159` (EV-1)
Ticket: EV-2 — Consent-gated pop-up survey with offline queue

## Result

All five EV-2 acceptance criteria are **PASS**.

## What EV-2 adds

| Layer | Surface |
| --- | --- |
| Database | `survey_response`, `survey_answer`; the analytics catalog widened to every declared event |
| Contract | `PisoCampSurveyResponseSchema`, `POST /pisocamp/surveys/responses`, three `survey_*` events, published questions carrying their ids |
| Backend | `SurveyResponseService`, `SurveysController` behind `@RequireConsent("survey")`, `SurveysModule` |
| Mobile | `survey_document.dart`, `survey_response.dart`, `survey_response_queue.dart`, `survey_repository.dart`, `survey_sync_controller.dart`, `survey_prompt.dart`, `survey_provider.dart`, the topic-completion trigger, `encrypted_record_queue.dart` (extracted from AN-1) |

## RF-3: consent is declared, not remembered

The route carries `@RequireConsent("survey")` and the `ConsentGuard` refuses the
request before the handler runs. This is the first use of that decorator, which
has existed unused since F4 — EV-2 is the ticket it was written for.

The service then checks the *named* grant as well: it must exist, be the
subject's own, be for the survey purpose, and be granted. The guard proves
somebody has a current grant; the service proves the response references it.

## AC1 — the pop-up can be declined and the module carries on

**PASS.** `survey_prompt_test.dart`: "Not now" ends the prompt in one tap, with
no confirmation dialog and nothing collected. Cancelling half-way through, after
a score has been chosen, discards the answers too — asserted.

The prompt is a bottom sheet on the topic screen, so what a person was reading
stays where it was.

The seeded trigger is "after topic completion": the survey whose
`subjectContentItemId` is the topic just read. EV-3 owns trigger configuration,
frequency caps and priority; this is deliberately one rule, in one function,
asserted both ways.

## AC2 — the privacy notice comes first, and declining collects nothing

**PASS.** Four cases asserted in the widget, and the whole consent-negative path
asserted on the server.

Device: with no current grant, choosing to answer shows the notice and **no
question is rendered**. Declining it ends the prompt with no answers and records
the refusal as a refusal. Agreeing opens the questions. A consent that could not
be recorded starts nothing and says so. An existing grant skips the notice
entirely.

Server (`survey-response.spec.ts`) — the DoD's consent-negative test: a response
naming a **declined** grant is refused and **no row is written**, in
`survey_response` or `survey_answer`. The same for a withdrawn grant, a grant
for another purpose, another subject's grant, and a grant that does not exist.

Route (`surveys.consent.spec.ts`): a device that granted consent submits and the
row lands; a device that declined gets 412 with `state: "declined"` and nothing
is collected; a device never asked gets 412 with `state: "none"`; a request with
no device identity is refused with 400. The real controller is asserted to carry
the `survey` consent declaration.

## AC3 — a submission is stored with its grant, version and timestamp

**PASS.** The stored row carries `consent_record_id`, the survey's item **and
version** id, the subject, and `submitted_at` as the device recorded it — with
`received_at` kept separately, so a long offline stretch stays visible rather
than rewritten. Every answer is a row of its own.

An answer must fit the question it answers, and the server checks the pair
rather than trusting the client: a score on a written question, words on a
rating, a rating scored 8 (fine for an NPS, not for a rating), a question the
version does not ask, a half-answered survey, and a skipped **required**
question are each refused. Six cases asserted, each proving nothing was written.

That required the published survey to carry its question ids, which EV-1's
draft shape deliberately does not: an editor does not own a question's identity.
The bundle candidate now carries the id-bearing questions alongside the draft,
and `survey.spec.ts` asserts the rendered document's ids are the database's.

## AC4 — an offline response is queued encrypted and uploads once

**PASS.** The queue is `EncryptedSurveyQueue`: one AES-GCM file per response
under app support, keyed from secure storage, with the response id as the
filename and as the AAD.

`survey_response_queue_test.dart` asserts a queued response survives a restart,
that the file contains **neither** the written answer nor the consent field in
the clear, that a response id is stored once however many times it is offered,
that acknowledging deletes only what was acknowledged, that a corrupt file is
quarantined without costing its neighbour, that a batch is capped at the server's
limit, and that a queue whose key has gone is refused rather than silently
re-keyed. It uses its own directory, key and AAD prefix — asserted, because
sharing them with analytics would let one queue read the other.

`survey_sync_controller_test.dart` asserts the offline case end to end: two
responses queued with no connection, nothing attempted; on reconnect one batch
uploads and a second reconnect uploads nothing. The interrupted-acknowledgement
case — the server stored the batch and the device never heard so — re-sends the
same ids and the server holds one row each. On the server,
`survey-response.spec.ts` asserts a replayed batch returns the same
acknowledgement, leaves one row, and cannot rewrite answers already stored.

A refused submission (412 or 403) stops without retrying and **deletes nothing**:
a consent that is not there will not be there a second later.

## AC5 — shown, declined and submitted events

**PASS.** `survey_prompt_shown`, `survey_declined` and `survey_submitted`, in
the shared catalog, with vectors in the fixture both TypeScript and Dart read.

`survey_declined` carries the **stage**: declining the prompt and declining the
notice are different refusals, and only the second means a notice was read.
`survey_submitted` carries how many questions were answered and never what any
answer was — an answer is the person's own words, and analytics carries none.

The coordinator emits shown on presentation and exactly one of
declined/submitted on completion; all three asserted, including that a
submission with no grant to name is reported as a decline rather than a
submission, and stores nothing.

## A defect this ticket found and fixed

**The database rejected five events the contract had been declaring.**
`analytics_event_name_check` still listed AN-1's four names, so `feature_use`,
`link_open` and the three `trivia_prompt_*` events — added by CE-4, CE-5 and
GM-2 — would have had their whole batch refused on ingest. EV-2's three new
events would have been the sixth, seventh and eighth.

Both constraints are widened, and `analytics-catalog.spec.ts` is the thing that
would have caught it: it states the catalog independently, asserts it equals the
contract's `ANALYTICS_EVENT_NAMES`, and **inserts one of every event**. An event
added to the contract and not to the database now fails there.

## Reuse rather than re-implementation

AN-1's encrypted queue is now `EncryptedRecordQueue<T>` — a codec, a layout and
the same one-file-per-record AES-GCM store. `EncryptedAnalyticsQueue` is a thin
face over it that keeps AN-1's method names and error codes, so nothing that
ticket published moved. **All 16 of AN-1's queue tests pass unchanged**, which
is what makes the extraction safe to claim.

Copying 350 lines of security-critical storage code for surveys would have been
a second place for a mistake to live.

The retry waiter, backoff and jitter come from `core/utils/retry_waiter.dart`,
extracted in GM-3. Consent policy is F4's `ConsentService`, not restated:
`SurveyConsentCoordinator` asks it for the standing and records decisions
through it, so a withdrawal or a re-consent is handled in one place.

## Accessibility

The prompt is registered in F6's audit as its own surface — a checklist that
audits screens should audit a surface a person meets, whether or not it is a
route. It passes the tap-target, label and contrast guidelines, 200 % text,
320 px width and rotation, like every other registered surface.

Each score on a scale is a 48 px target named for a screen reader as
"<prompt>: <score>" and marked as one of a mutually exclusive group; errors are
announced in a live region; every text field is labelled.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 19 files, 296 tests passed (+15) |
| `@repo/db` vitest | 16 files, 101 passed, 32 skipped |
| backend jest `--runInBand` | 84 suites, 698 passed, 48 skipped (+3 suites, +27) |
| `web` vitest | 40 files, 366 passed |
| `flutter test` | 647 passed, 1 skipped (+55) |
| `flutter analyze` | 0 errors; 40 pre-existing infos/warnings |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

## Scope notes

- **No browser validation applies.** EV-2 adds no web surface: the admin side of
  surveys was EV-1's and was validated in a real browser there. The device
  surface is covered by widget tests and by F6's audit.
- **A grant the device cannot name asks again.** If the server says a grant
  exists but the device holds no record of it — a reinstall, say — the notice is
  shown rather than a response submitted with no reference. Nothing is collected
  on the strength of a grant nobody can point to.
- **Trigger configuration, frequency caps and priority are EV-3.** One seeded
  trigger is built here, as the ticket asks.
- **Reading responses back is AN-6.** Nothing renders them yet.
