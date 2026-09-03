# SA-7 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `1f0c322` (SA-4)
Ticket: SA-7 — Consent withdrawal and data-subject export/delete

## Result

All four SA-7 acceptance criteria are **PASS**.

## What SA-7 adds

| Layer | Surface |
| --- | --- |
| Contract | `withdrawn` as a consent decision; `DataSubjectExportSchema`; `GET /pisocamp/me/data-export`; `POST /admin/pisocamp/accounts/{id}/data-deletion` |
| Backend | `PisoCampDataSubjectService` |
| Mobile | A Privacy screen, one tap from the module, that withdraws a purpose |
| Web | A deletion dialog on `/pisocamp/accounts` |

## AC1 — withdrawing writes a `withdrawn` record and stops collection at once

**PASS**, with **no change to the guard at all**.

The trail is append-only, so a withdrawal is a new record rather than an edit:
the grant that was true at the time is still there, which is what proves
collection was lawful while it happened. `getStatus` reads the newest record,
and `ConsentGuard` admits only `granted` — so the moment the withdrawal lands,
the next consent-dependent request is refused. Asserted end to end.

**Withdrawal is now a decision, not only a state.** It used to be reported as a
`declined`, which is wrong: declining is never having agreed, withdrawing is
having agreed and changed your mind, and only the second obliges anybody to stop
what they were already doing. The contract, the service and the mobile client
now all say which happened.

On the device it queues and retries like any other consent decision, so it
survives being made offline — the moment somebody changes their mind is rarely
the moment they have a signal, and a right that only works on Wi-Fi is a weaker
right. Asserted offline and online.

The Privacy screen confirms before withdrawing, says what stops and what is
kept, and reports a failure out loud rather than showing it as done: a
withdrawal somebody believes happened and did not is the worst outcome here.

## AC2 — the export is readable and documented

**PASS.** `GET /pisocamp/me/data-export` returns the account, profile, consent
decisions (withdrawals included), survey answers and trivia answers, with a
`documentation` section describing every part.

It is **JSON, not a rendered page**: the point of a data-subject export is that
it can be taken somewhere else, and a picture of an answer is not portable. Each
section carries its own line of prose so it reads without a schema to hand.

Analytics are **explained rather than omitted**: they are recorded against a
device pseudonym never linked back to an account, so there is nothing in them to
give — and silence would read as something withheld. Asserted.

The endpoint requires a session and **no permission at all**. A right you have to
ask somebody else to exercise for you is a weaker right. Asserted by reading the
handler's metadata: it carries no permission requirement, and it is not marked
anonymous.

## AC3 — deletion removes what identifies, keeps what must be kept

**PASS**, under `admin.accounts.manage`, in one transaction, audited with the
BSP approval reference it was carried out under.

| Removed | Kept, and why |
| --- | --- |
| Profile (age, gender, region, city) | **The account row**, name and address replaced — deleting it would take the audit trail's actor with it, and an entry that cannot say who acted is not evidence |
| Device↔account links — the re-identification path | **Consent records** — the proof collection was lawful while it happened; destroying them destroys the defence, not the exposure |
| Sessions | **Analytics** — keyed to a device pseudonym, never to an account; deleting the link is what makes the aggregates safe to keep |
| Trivia answers | |
| Survey answers **unlinked**, not deleted | |

The last row is a real distinction and it is stated in the contract: a survey
response can exist without a person, so it is kept and unlinked; a trivia
response cannot, because **GM-3 keys it to an account** and SA-7 does not rewrite
another ticket's schema to make room. Those rows are deleted, and the
pseudonymous analytics events for the same activity are untouched.

The account is left deactivated with the approval reference as its reason, so
the person cannot sign in and anybody looking later can see why. Every one of
these is asserted separately, including that an export of the deleted account
comes back carrying nothing personal.

**The result is counted, not claimed.** The response and the audit entry both
carry how many of each thing were removed or kept: "we deleted your data" is
something somebody has to be able to check.

## AC4 — 403 and an audit entry without `admin.accounts.manage`

**PASS.** Both branches on the deletion handler, with the denial audited naming
the handler and the permission. The denied user deliberately holds
`admin.audit.view`: being trusted to read the trail is not being trusted to
delete somebody out of it. The browser run adds a direct 403 from the endpoint.

## Browser validation

`sa7-data-subject.authenticated.spec.ts` — **6 passed**: a signed-in person
gets their own documented export; the deletion dialog says what it keeps as well
as what it removes and refuses to proceed without the approval reference; the
endpoint refuses a user without the permission; and the dialog has no horizontal
overflow at 320 px with a 44 px control.

The deletion itself is reconciled in the backend suite against a database it
owns — deleting a seeded account in the browser run would take the rest of the
suite's fixtures with it.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 23 files, 377 tests passed |
| backend jest `--runInBand` | 99 suites, 860 passed, 48 skipped (+19) |
| `web` vitest | 48 files, 446 passed (+4) |
| `flutter test` | 689 passed, 1 skipped (+2) |
| `packages/e2e-web` Playwright | 6 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The server log carries no error-level line; the only 4xx are the deliberate
denials under test.

## Notes

- **Automated request intake stays out of scope**, as the ticket says: the
  deletion takes a BSP approval reference and refuses without one, which is the
  seam where that process meets this code.
- The withdrawal screen deliberately says that withdrawing **does not delete
  what was already collected** — that is the deletion request, and conflating
  the two would leave somebody believing they had asked for something they had
  not.
