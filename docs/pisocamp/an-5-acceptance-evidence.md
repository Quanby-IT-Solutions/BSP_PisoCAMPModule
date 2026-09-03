# AN-5 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `8a95050` (AN-4)
Ticket: AN-5 — Gamification and trivia metrics

## Result

All five AN-5 acceptance criteria are **PASS**.

## What AN-5 adds

| Layer | Surface |
| --- | --- |
| Contract | `GamificationSummarySchema`; `GET /admin/pisocamp/analytics/gamification` |
| Config | `leaderboard_top_group_percent` (1–50, default 10) |
| Backend | `GamificationService` |
| Web | A Gamification section on `/pisocamp/engagement` |

Nothing new was written to the database. The figures are read from GM-4's
`leaderboard_entry`, GM-2's `trivia_response` and AN-1's `analytics_event`.

## AC1 — participation and rank movement

**PASS.** Participation is participating registered ÷ **eligible** registered,
where eligible is every registered account rather than only the accounts already
on the board. Dividing by the players alone would report a rate that could never
fall, which is the opposite of what the KPI is for.

Rank movement is read from GM-4's stored `rank_movement`, so the dashboard and
the leaderboard cannot disagree about who moved. Asserted with four players: one
up, one down, one unchanged and one new entrant, out of five accounts — 80%.

A **new entrant is counted apart from "unchanged"**: having nobody to be
compared with is not the same as having held station.

An empty board reports 0%, not a division by zero. Asserted.

## AC2 — retention of the configured top group

**PASS**, against the configured `leaderboard_top_group_percent`, not a
hard-coded 10. The group size is `ceil(entries × percent / 100)`, floored at one
person, so a small board still has a top.

Asserted three ways on a ten-person board: the order holding gives 100%, the
order reversing gives 0%, and setting the share to 50% moves the group from one
person to five. The last of those is the setting doing the work rather than a
coincidence.

The two periods compared are the two most recent in the range, so "retained"
means still in the top group in the following period.

## AC3 — trivia participation, reconciled with the responses

**PASS**, and reconciled as the definition of done requires: **shown** comes
from the `trivia_prompt_shown` events, but **answered, skipped, correct and
incorrect come from `trivia_response`** — the answers people actually gave, not
the reports of them.

Asserted on four prompts and four responses: 4 shown, 3 answered, 1 skipped,
2 correct, 1 incorrect, a 75% completion rate and 66.67% accuracy.

**Skipped questions stay out of the accuracy denominator.** A skip is not a
wrong answer, and counting it as one would understate how well people are doing.

**Repeat participation is answering on more than one Asia/Manila day.** Asserted
with a person who answered twice in one day (not a repeat) beside a person who
came back on a later day (a repeat).

Answers outside the range are left out. Asserted.

## AC4 — re-engagement in learning after trivia

**PASS.** A session counts as re-engaged when a `content_view` or a `link_open`
happens **after** the first trivia event of that session. After, because the
question is whether the trivia sent somebody back, and something that happened
first cannot have been caused by it — asserted directly with a view before the
trivia that is not counted.

The criterion also names the engagement prompt. `account_prompt_shown` after
trivia is **counted and displayed but deliberately kept out of the rate**: being
asked to register is something the app did, not a return to the learning
content. Asserted with a session whose only post-trivia event is a prompt, which
still counts as a session that did not come back.

No trivia at all reports 0%, not a division by zero. Asserted.

## AC5 — permission, both ways

**PASS**, on the same `reports.dashboards.view` as the rest of the analytics
dashboards, through the shared `RbacGuard` — no second permission mechanism.

`analytics.authorization.spec.ts` proves both branches on the real guard:

- A holder of Reports & Analytics reaches `AnalyticsController.gamification`.
- A registered user without it is refused **403** and exactly one
  `permission_denied` audit is written, targeted at
  `handler` / `AnalyticsController.gamification` and naming the missing
  permission.

Also asserted there: a deactivated holder is refused before permission
resolution can grant access, and an unauthenticated request is refused without
writing a permission-denied audit — nobody to attribute it to.

## Reading a zero honestly

GM-4's leaderboard ships switched off. A participation rate of 0% then means
nobody *could* play, which is a different claim from nobody choosing to. The
summary carries `leaderboardEnabled` and the dashboard says so above the
figures. Asserted at both levels.

## Browser validation

`an2-engagement.authenticated.spec.ts` — the AN-5 case signs in as a holder,
finds the Gamification section, and checks that each headline figure names the
pool it came from (`… of N registered`, `… in the top N%`). Console, page
errors, failed requests and 4xx/5xx responses all asserted empty.

The section reuses the page's existing range controls, so the 320 px overflow
and keyboard cases already on that page cover it.

## Test evidence

| Suite | Result |
| --- | --- |
| backend jest `--runInBand` | 103 suites, 899 passed, 48 skipped, 2 suites skipped |
| `apps/web` vitest | 49 files, 452 passed |
| `packages/contracts` vitest | 23 files, 377 passed |
| `packages/e2e-web` Playwright | 10 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The API log carries no error-level line. Every
`/admin/pisocamp/analytics/gamification` request answered 200. The only non-2xx
are the deliberate 403s from the permission case and better-auth's own sign-in
rate limit, which the sign-in fixture retries.

## Defects found and fixed on the way

- **A new admin-only setting reached the public configuration fixture.** Adding
  `leaderboard_top_group_percent` to the shared config fixtures put it into the
  *expected* public config of two specs as well. The public config is a
  deliberate allowlist — a device has no business knowing how the top group is
  sized — and the expectation is what proves it. Removed from both public
  expectations, kept in the administrator ones.
- **`AnalyticsController`'s unit spec did not know about the new service.** Nest
  could not resolve the constructor, which failed four tests that have nothing
  to do with gamification. Provided the stub alongside its siblings.
- **An unused import in `data-subject.authorization.spec.ts`** was the only
  backend lint warning; removed, so the touched area lints clean.

## Notes

- The KPI queries reuse the Manila-day range handling every other analytics
  service uses, and the top-group share reuses SA-3's admin configuration
  registry rather than introducing a second place to keep a number.
- Two full backend runs earlier in this session reported unrelated failures
  because a second `jest` run was started against the same `pisocamp_test`
  database while the first was still going; each suite truncates the tables it
  owns, so the two runs pulled the rows out from under each other. Connection
  sampling during a clean run stayed at one, ruling out pool exhaustion.
