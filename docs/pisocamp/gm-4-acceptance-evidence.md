# GM-4 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `d0232fd` (SA-7)
Ticket: GM-4 — Leaderboard with config flag, aliases, periods and rank movement

## Result

All six GM-4 acceptance criteria are **PASS**.

## What GM-4 adds

| Layer | Surface |
| --- | --- |
| Database | `leaderboard_entry`; `leaderboard_alias` on the profile |
| Contract | `LeaderboardSchema`; `GET /pisocamp/leaderboard`, `PUT /pisocamp/leaderboard/alias` |
| Backend | `PisoCampLeaderboardService` — the scoring job and the board |
| Mobile | A Leaderboard screen, and the entry point that appears only when the flag is on |

The `leaderboard_enabled` key already existed: SA-3 added it to the
configuration registry, so GM-4 turns a switch rather than building one.

## AC1 — rank, score and the top by alias, per period

**PASS**, reconciled against `trivia_response` as the definition of done
requires. The fixture is three people in one week — 10 + 20, 25 and 25 — and the
board is asserted as 30/first, 25/second and 25/**also second**: equal scores
share a rank and the next rank skips, so two people in second place means nobody
is third.

All three periods work and are asserted separately:

- **Weekly** starts on the Monday of the Asia/Manila day — what "this week"
  means to the people reading it, not what the epoch implies. Sunday belongs to
  the week that began six days earlier; asserted at both boundaries.
- **Monthly** starts on the first Manila day of the month.
- **All time** is pinned to one day so it never rolls over.

Answers from another week are excluded, and all-time counts everything.
Somebody who scored nothing is left off entirely: a board place for nought
points is not a place anybody earned.

## AC2 — a guest is told registration is required

**PASS.** Neither handler is anonymous, so a guest never reaches the API; the
screen shows the notice instead of an empty list. "No data" and "this is not for
you yet" are different messages, and only the second tells somebody what to do
next. Asserted in the Flutter test, including that no standing is rendered.

## AC3 — the flag hides the entry point and closes the API

**PASS**, both halves:

- The service **refuses outright** with 404 when the flag is off. A disabled
  feature that still answered would be a feature, and the flag would be
  decoration. Asserted in the backend suite and again in the browser.
- The device learns the flag from the **public configuration** SA-3 already
  serves, so the entry point disappears without the app being rebuilt. The
  parser defaults it when a server predates it, rather than refusing a
  configuration it could otherwise use.

## AC4 — rank movement against the previous interval

**PASS.** Two consecutive weeks with the order reversed: the person who went
from second to first records `+1`, the one who went the other way `-1`.

Somebody with **no previous period reports null, not zero** — nobody to compare
with is not "held station", and a board that said "no change" for a newcomer
would be stating something it does not know.

## AC5 — only an alias is ever shown

**PASS.** The board carries the chosen alias, or a generated one, and nothing
else. The test serialises the whole response and asserts it contains neither the
account's email address nor its name.

The generated alias is derived from the account id by hash, so it is **stable
across periods** — a board where the same person appeared under a different name
each week would be unreadable — and carries nothing of the account it came from.

## AC6 — 403 and an audit entry without `admin.config.manage`

**PASS.** The flag is a configuration key, so this is F2's gate — and this
ticket is where that gate finally gets proven rather than assumed. Before GM-4
only the *declaration* was tested; there is now a spec that exercises both
branches on both configuration handlers, with the denial written to the audit
log naming `PisoCampController.updateAdminConfig` and the missing permission.
A deactivated manager is refused at 401 before the permission is reached.

## The scoring job is idempotent

The job derives a whole period from the trivia responses in it and replaces what
it wrote before. Asserted twice over:

- running it twice leaves the same scores rather than doubling anybody;
- running it again after a late upload lands picks the upload up.

That is what makes it safe to schedule, and safe to re-run after a failure.

## Browser validation

`gm4-leaderboard.authenticated.spec.ts` — **4 passed**: turning the flag off in
the configuration screen closes the API with a 404 and shows `false` in the
public configuration; turning it on opens the API, and whatever is on the board
is aliases with no address anywhere in the response. Page errors asserted clean.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 23 files, 377 tests passed |
| backend jest `--runInBand` | 101 suites, 881 passed, 48 skipped (+21) |
| `web` vitest | 48 files, 446 passed |
| `flutter test` | 695 passed, 1 skipped (+6) |
| `packages/e2e-web` Playwright | 4 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The server log carries no error-level line; the only 4xx are the deliberate
404 under test and the denials from other specs.

## Notes

- **The alias lives on F3's profile**, which GM-4's in-scope list sanctions. The
  column is nullable because F3's profiles predate it, and the generated alias
  covers everybody who has not chosen one.
- **Leaderboard KPIs are AN-5**, as the ticket says; this ticket produces the
  `leaderboard_entry` rows those will report on.
- The scoring method is "sum of the points GM-3 already awards", which keeps one
  definition of a point rather than inventing a second.
