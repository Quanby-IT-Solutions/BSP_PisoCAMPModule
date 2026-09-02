# AN-3 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `4d3d2ff` (AN-2)
Ticket: AN-3 — Feature usage, activation and time-to-first-key-action

## Result

All four AN-3 acceptance criteria are **PASS**.

## What AN-3 adds

| Layer | Surface |
| --- | --- |
| Contract | The `profile_created` event; `ADOPTION_FEATURES`, `KEY_ACTION_EVENTS`, `AdoptionSummarySchema`, `GET /admin/pisocamp/analytics/adoption` |
| Backend | `AdoptionService`, behind `reports.dashboards.view` |
| Mobile | `ProfileCreatedIntent`, emitted when a registration actually completes |
| Web | The Adoption section of `/pisocamp/engagement` |

## AC1 — account creation rate

**PASS.** Distinct subjects with `profile_created` ÷ distinct subjects with
`account_prompt_shown` × 100. Three prompted and one registered gives 33.33 %,
and a person prompted twice counts once — asserted.

`profile_created` did not exist; AN-3 adds it, and the mobile app emits it on
the path where the profile has actually been created, not where registration
was attempted. The event carries **no properties at all**: how many people
registered is analytics' business, and who they are is not.

Nobody prompted reports zero rather than dividing by nothing.

## AC2 — time to first key action, and first-day activation

**PASS.** Per person: the seconds from their first `module_entry` in the range
to their first key action. Median and p95 come from `percentile_cont`.

The fixture is three people at 600, 1800 and 57 600 seconds, and the median is
asserted as 1800 — the middle one, by hand.

First-day activation is a key action **within 24 hours** of the first entry. A
person who acted 25 hours later is not activated — asserted — but their timing
is still reported, because it did take that long. An action that predates the
first entry in the range belongs to an earlier visit and is not counted as a
time-to-action at all.

Nobody acting reports **null**, not zero: "nobody acted" and "acted instantly"
are different facts, and the screen prints "No key action yet" for the first.

The key actions are named in the response and shown on the screen, so a reader
knows what was counted.

## AC3 — usage per AN-013 feature

**PASS.** All fifteen features are reported, **including the ones nothing emits
yet** — leaderboard, AR, recognition, zoom and pan. A feature missing from a
report reads as a feature nobody used, and "not built" and "not used" are
different answers. Each is a zero until its ticket lands, and the screen says
so under the table.

Uses and users are separate columns: one person using the 3D viewer three times
is three uses and one user. Asserted.

Banknotes and coins are separated from general currency education by the
content the view named; external and internal links by the link type the event
carried. Asserted.

## AC4 — 403 and an audit entry without `reports.dashboards.view`

**PASS.** Both branches on the adoption handler itself: a holder passes, a
registered user without it is refused with 403 and exactly one
`permission_denied` row naming `AnalyticsController.adoption`. The browser run
adds the redirect for a signed-in user without the permission.

## Browser validation

`an2-engagement.authenticated.spec.ts` grew a case and now runs **8 passed**:
the Adoption heading, the account-creation and first-day-activation figures, and
the full AN-013 list including Leaderboard and Recognition, all with console,
network and page errors asserted clean.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 21 files, 328 tests passed |
| backend jest `--runInBand` | 88 suites, 741 passed, 48 skipped (+12) |
| `web` vitest | 43 files, 389 passed (+6) |
| `packages/e2e-web` Playwright | 8 passed |
| `flutter test` | 686 passed, 1 skipped |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

## Scope notes

- **The key-action list is a contract constant, not yet a config row.** The
  ticket calls it config; it is stated once in `KEY_ACTION_EVENTS`, returned in
  every response so a reader can see what was counted, and moving it into
  `module_configuration` is a small change on top of that. It is called out
  rather than left implied.
- **Feature attribution reads the event, not a registry.** `feature_use` names
  its own feature; the rest are attributed by what the event is. A new feature
  needs a line in one `case` expression.
- **Cohorts are AN-10** and retention is AN-4.
