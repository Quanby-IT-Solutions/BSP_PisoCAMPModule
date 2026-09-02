# AN-2 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `51910c9` (EV-4)
Ticket: AN-2 — Sessions and DAU/MAU/stickiness/session dashboard

## Result

All four AN-2 acceptance criteria are **PASS**.

## What AN-2 adds

| Layer | Surface |
| --- | --- |
| Database | `analytics_session` — one row per run of a subject's activity |
| Contract | `EngagementRangeInputSchema`, `EngagementSummarySchema`, `GET /admin/pisocamp/analytics/engagement` |
| Backend | `SessionizerService` (the job) and `EngagementService` (the figures), both behind `reports.dashboards.view` |
| Web | `/pisocamp/engagement` — the dashboard |

## The decision the ticket forces

**Sessions are derived, not taken from the client.** Every event already
carries a `session_id` the device generated. Using it would have been less
work and would have made every engagement figure something a device can move:
a client that resets its session id per event reports infinite sessions.

So the sessioniser groups a subject's events by time — cut wherever the gap
reaches `session_inactivity_minutes` — and the client's id is not read at all.
The cost is a job; the gain is a number nobody outside BSP can influence.

## AC1 — a session is a run of events with gaps under the inactivity

**PASS.** `engagement.spec.ts`:

- three events at 10:00, 10:20, 10:35 are one session and a fourth at 11:05
  starts a second, because that gap is exactly the 30-minute setting;
- the same 20-minute gap that is one session at 30 minutes is two at 10, which
  is the configured value doing the work rather than a constant;
- one subject's events never join another's session;
- a session that runs past local midnight is counted on the Manila day it
  **started** — cutting it at midnight would invent a visit nobody made;
- rebuilding a window after a late upload leaves one session, not two, so the
  job can be run again as often as it needs to be;
- rebuilding one day leaves the other days' sessions alone.

The rebuild reads a day of events before the window as well, so a session that
began the previous evening is rebuilt whole rather than beheaded.

## AC2 — the dashboard shows the figures for a range

**PASS.** DAU, MAU (rolling 30 days ending on the range's last day), DAU/MAU %,
sessions, active users, sessions per user, average session duration, screen
views per session, active users for **every** day in the range including the
empty ones, all 24 hours, and the busiest five-minute interval.

Concurrency is sessions **open** during an interval, not sessions started in
it: a long session is concurrent with every slot it spans. Asserted with a
fixture where one session starts inside another's span.

The dashboard reads the range from two date fields, refuses a backwards range
before asking the server, and shows the configured inactivity beside the
figures so a reader knows what "a session" meant.

## AC3 — the figures reconcile with the raw events

**PASS.** The fixture is five events across two subjects and two days, small
enough to compute by hand, and the expectations are those hand-computed
numbers with the arithmetic written beside them:

- 4 sessions ÷ 2 users = **2** sessions per user;
- (1200 + 0 + 0 + 0) seconds ÷ 4 = **300** average seconds;
- 5 screen views ÷ 4 sessions = **1.25**;
- DAU 1, MAU 2, ratio **50 %**;
- hours 9, 10 and 14 carry the sessions, and hour 3 carries none.

A period with no monthly users reports a ratio of zero rather than dividing by
nothing, and every per-something figure does the same. Asserted.

## AC4 — 403 and an audit entry without `reports.dashboards.view`

**PASS.** Both branches on the engagement handler itself
(`analytics.authorization.spec.ts`): a holder passes the guard; a registered
user without the permission is refused with 403 and exactly one
`permission_denied` audit row that names **`AnalyticsController.engagement`** —
an audit that could not tell the two dashboards apart would be no use. An
unauthenticated request is refused first, with nothing audited, and a
deactivated permission holder is refused before permissions are even resolved.

The browser run adds the redirect for a signed-in user without the permission.

## Browser validation

`an2-engagement.authenticated.spec.ts` — **7 passed** including setup. The
figures render, a backwards range is refused on the page, a changed range is
answered with a row per day, the screen has no horizontal overflow at 320 px
and its date fields are keyboard-focusable with 44 px targets, and a user
without the permission is redirected. Console, network and page errors are
asserted clean throughout.

## A flake this ticket fixed

`audit.service.spec.ts` read its entries unordered and asserted their order.
Two entries written in the same transaction share a timestamp, so the assertion
passed or failed on the database's whim; it failed on this run. The read is now
ordered by id, which is the order they were written in.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 21 files, 328 tests passed (+11) |
| `@repo/db` vitest | 16 files, 101 passed, 32 skipped |
| backend jest `--runInBand` | 87 suites, 729 passed, 48 skipped (+13) |
| `web` vitest | 42 files, 383 passed (+6) |
| `packages/e2e-web` Playwright | 7 passed |
| `flutter test` | 686 passed, 1 skipped (unchanged) |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

## Scope notes

- **The sessioniser has no scheduler yet.** It is a service with an idempotent
  `rebuild(from, to)`, exported from the analytics module and driven by the
  suite. CM-6's scheduled publication is the pattern a cron would follow, and
  wiring one is a deployment decision rather than a KPI one.
- **"Screen views" means screen changes.** There is no screen-view event in the
  catalog; the honest count is the first screen plus every change of it within
  the session, which is what a person would count watching over a shoulder.
- **Feature usage, retention and exports** are AN-3, AN-4 and AN-9.
