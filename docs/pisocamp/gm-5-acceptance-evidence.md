# GM-5 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `9dc1f9e` (GM-4)
Ticket: GM-5 — Registered user progress view

## Result

All three GM-5 acceptance criteria are **PASS**.

## What GM-5 adds

| Layer | Surface |
| --- | --- |
| Contract | `PisoCampProgressSchema`; `GET /pisocamp/me/progress` |
| Backend | `PisoCampProgressService` |
| Mobile | A Progress screen, with the last synced summary kept on the device |

## AC1 — topics, questions, accuracy, points and last activity

**PASS**, computed server-side from the two places the module records activity,
as the technical note says:

- **`trivia_response`** — keyed to the account, giving topics with questions,
  questions answered, correct, skipped and points.
- **`analytics_event` `content_view`** — keyed to the device pseudonym analytics
  uses, joined through F3's device-account link.

That join is the same link SA-7 deletes on erasure, which is exactly why
deleting it is what makes the analytics safe to keep.

The reconciliation fixture is four answers and three views, and every figure is
asserted against them by hand: two distinct items viewed though one was opened
twice, three distinct items put as questions, three answered, two correct, one
skipped, 30 points, and the last activity being the later of the two sources.

**Accuracy excludes skipped questions from the denominator.** Skipping is not
failing, and counting it as a wrong answer would tell somebody they are worse at
this than they are. Asserted directly: one correct answer and one skip reads
100%, not 50%.

Nobody else's activity is counted — asserted with a second account whose answers
and views are ignored.

## AC2 — no activity is zeros, without error

**PASS.** Every count is zero and `lastActivityAt` is **null**, not a fabricated
date: nothing has happened yet, and a timestamp would say something did. The
screen prints "Nothing yet" rather than leaving a blank.

An account that has never been linked to a device still gets its answers — only
the views need the link. Asserted.

## AC3 — offline shows the last synced summary, with an indicator

**PASS.** The repository writes each successful load to the device and falls
back to it when the request fails, marked offline so the screen can say so.
Figures somebody believes are current and are not are worse than no figures.

Asserted at both levels: the repository returns the cached summary with
`isOffline` set when the network fails, and the screen shows "Offline — showing
what was last synced" above the figures. A cache this build cannot read is
treated as no cache at all rather than shown as a summary.

Before the first successful load there is nothing to show, and the screen says
so instead of rendering zeros that would read as real.

## Permission

Being signed in is the whole of the requirement. A permission here would make
somebody ask an administrator what they themselves have done. A request with no
session is refused at 401 — asserted in the browser.

## Browser validation

`gm5-progress.authenticated.spec.ts` — **4 passed**: a signed-in person gets
their own progress with every field present, nothing in the response names
another person, and a session-less request is refused. Page errors asserted
clean.

## Test evidence

| Suite | Result |
| --- | --- |
| backend jest `--runInBand` | 102 suites, 887 passed, 48 skipped (+6) |
| `flutter test` | 701 passed, 1 skipped (+6) |
| `packages/e2e-web` Playwright | 4 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The server log carries no error-level line; the only 4xx are the deliberate
401 under test and denials from other specs.

## Notes

- **Cross-user analytics stay out of scope**, as the ticket says: this screen
  answers "what have I done", never "how do I compare". The one place a
  comparison appears is GM-4's leaderboard, which is a separate screen behind a
  separate switch.
- The mobile entry point only exists for a signed-in person: progress is about
  an account, so offering it to a guest would open onto an apology.
