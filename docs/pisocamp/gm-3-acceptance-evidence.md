# GM-3 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `327178c` (GM-2)
Ticket: GM-3 — Answer tracking and progress (local for guests, synced for registered)

## Result

All five GM-3 acceptance criteria are **PASS**.

## What GM-3 adds

| Layer | Surface |
| --- | --- |
| Database | `trivia_response` — client `response_id` as the primary key, five CHECK constraints, two indexes |
| Contract | `PisoCampTriviaResponseSchema`, `POST /pisocamp/trivia/responses`, `TRIVIA_POINTS` |
| Backend | `TriviaService.ingest` (account-state gate, `on conflict do nothing`, acknowledgement), `TriviaController`, `TriviaModule` |
| Mobile | `trivia_response.dart` (the record + scoring), `trivia_response_store.dart` (local store), `trivia_repository.dart` (upload + failure classification), `trivia_sync_controller.dart` (drain, retry, merge), provider wiring, `retry_waiter.dart` (extracted from AN-1) |

## The shape of the whole ticket

The client owns the identifier. `response_id` is minted on the device and is
the server's primary key, so a batch re-sent after a dropped connection lands
once. That single decision is what makes AC2, AC3 and AC5 the same mechanism
rather than three, and it is RF-2's pattern, which AN-1 already uses.

The order is always: record locally, upload, then mark. Nothing is deleted or
marked on the strength of anything but an acknowledgement naming it, so every
interruption leaves the answer pending and re-sending it is safe.

## AC1 — every answer and skip is stored locally

**PASS.** `trivia_response_store_test.dart` asserts a correct answer, a skip and
a wrong answer with a link are each stored with question, version, category,
difficulty, correct flag, skipped flag, link-opened flag, points and timestamp,
and that they survive a restart.

Scoring is on the device (`TRIVIA_POINTS`: easy 1, medium 2, hard 3) because
marking is: a guest offline has already been told they were right, and the
server would only be repeating the arithmetic. The table is stated once in the
contract and mirrored in `kTriviaPoints`, and both are asserted.

`TriviaResponseRecord.fromPrompt` derives every dependent field from the
outcome, so a caller cannot record a skipped question that scored or a correct
answer that opened a link. The same combinations are refused again when reading
storage, so one hand-edited row cannot poison every batch it joins, and again
by the contract, and again by the database — four layers, asserted at each.

## AC2 — a registered active user online syncs idempotently

**PASS.** `trivia.service.spec.ts` (live PostgreSQL):

- a replayed batch returns the same acknowledgement and leaves one row per id;
- an overlapping batch — the mid-sync reconnect case — stores three rows for
  three ids, not four;
- a replay carrying *different* content for a known id does not rewrite the
  stored answer. The row is the record of what happened.

On the device, `trivia_sync_controller_test.dart` asserts the drain uploads
what is pending, marks only what came back acknowledged, and keeps the rest
pending when the server acknowledges part of a batch.

An id already recorded for **another** account is refused with `CONFLICT`
rather than silently dropped: `do nothing` would otherwise acknowledge an
answer that was never stored. Asserted, including that the original row is
untouched.

## AC3 — a guest who registers merges their responses once

**PASS.** The responses are already on the device with their ids, so the merge
is an upload, not a rewrite — the ids do not change, which is asserted
explicitly, and that is why the merge cannot double-count.

"Once" is a recorded fact: the store keeps the account that claimed the
backlog. `trivia_sync_controller_test.dart` asserts a repeated merge uploads
nothing further, and that a **second** account registered on the same device
does not inherit the first account's answers.

`trivia_sync_provider_test.dart` proves the wiring end to end: a guest records
an answer and nothing is uploaded; the account then appears mid-session and the
backlog goes up under it, with the merge marker set. The merge is driven by the
account appearing rather than by the sign-up screen, so a registration that is
interrupted still merges on the next launch — asserted as its own case.

## AC4 — a deactivated account is rejected and the local data retained

**PASS.** Both branches, at both ends.

Server (`trivia.service.spec.ts`): the deactivated account is refused with
`401 Account is deactivated` — the wording and status the module already uses
in `RbacGuard`, `IdempotencyInterceptor` and the profile service, reusing
`AccountAccessService` rather than re-reading the table — and **no rows are
written**. The same batch from an active account is accepted. The rejection is
therefore the account state, not the batch.

Device (`trivia_sync_controller_test.dart`, `trivia_repository_test.dart`):
401 and 403 classify as `rejected`, which stops the run without retrying — a
deactivated account will be deactivated a second later too — and marks nothing
synced. Answers recorded after the rejection are still kept. The pending count
reported to the caller stays at what the device is holding.

## AC5 — offline responses upload without duplicates when connectivity returns

**PASS.** Answers recorded offline are stored and nothing is attempted
(`reasonCode: 'offline'`). On reconnect the backlog uploads in one batch; a
second reconnect uploads nothing, because everything is acknowledged.

The interrupted-acknowledgement case is asserted directly: the server stores
the batch and the device never hears so. The retry sends the same ids, the
server holds one row each, and the device marks them synced.

A transient failure retries with the shared backoff and gives up after the cap;
a permanent one does not retry; neither loses an answer.

## Two defects found and fixed while proving this

**A reconnect landing mid-run was swallowed.** Joining a run already in flight
is right for concurrency, but that run may already have read its batch or
decided it was offline. The controller now records that a request arrived
during a run and drains again — without it, a device that opens the module
before the radio settles would hold its backlog until the next trigger. Found
by `trivia_sync_provider_test.dart`, which drives the real provider wiring
rather than the controller directly.

**Riverpod pauses a provider nothing is listening to.** A paused controller
never hears the connectivity change it exists to react to. `App` now watches
`triviaSyncControllerProvider` at the root, for the same reason it watches the
consent controller, and the test helper keeps it alive the same way and says
why. The controller's store and uploader are resolved lazily so watching it at
the root does not build an HTTP client at launch — which is also what
`widget_test.dart` proved by failing.

## Reuse rather than re-implementation

The retry waiter, the doubling backoff and the secure jitter were AN-1's
private helpers. They are now `lib/core/utils/retry_waiter.dart`, and
`AnalyticsSyncController` uses them under typedefs that keep its published
names. No behaviour changed and AN-1's suite is untouched and green.

`AccountAccessService` and the module's existing deactivation wording are
reused rather than restated. The repository follows the analytics uploader's
acknowledgement-validation shape: an id nobody sent is refused, because
deleting on the strength of one would lose an answer.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 18 files, 271 tests passed (+17) |
| `@repo/db` vitest | 16 files, 101 passed, 32 skipped |
| backend jest `--runInBand` | 77 suites, 655 passed, 48 skipped (+1 suite, +13) |
| `web` vitest | 40 files, 358 passed |
| `flutter test` | 592 passed, 1 skipped (+52) |
| `flutter analyze` | 0 errors; 40 pre-existing infos/warnings |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The one non-auth lint warning present at the start of this ticket — an unused
destructured binding in GM-1's `content.schema.test.ts` — is fixed here rather
than left, since it is in the trivia area this ticket touches.

## Scope notes

- **Progress UI is GM-5 and ranking is GM-4.** The store keeps acknowledged
  responses rather than deleting them, so the device already holds the history
  those tickets will show; nothing renders it yet.
- **The store is shared preferences, not the encrypted analytics queue.** A
  response names a question, an outcome and a moment; it identifies nobody
  until it is uploaded, and what identifies it then is the account it is
  uploaded under. The analytics queue is encrypted because it carries a subject
  pseudo-id and a session id, and this carries neither. It sits beside GM-2's
  sighting history for the same reason.
- **Consent is not a second gate on sync.** The ticket's acceptance criteria
  name the account state, and withdrawal of registration consent is what
  deactivates an account. `RequireConsent` exists and is unused across the whole
  module; making trivia its first user would be a decision for the ticket that
  applies it everywhere.
- **Topic completion as a trivia trigger** is still unwired, as GM-2 recorded.
