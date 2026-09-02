# AN-4 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `ed43844` (AN-3)
Ticket: AN-4 — Retention, churn, lifetime, re-engagement and reactivation

## Result

All four AN-4 acceptance criteria are **PASS**.

## What AN-4 adds

| Layer | Surface |
| --- | --- |
| Contract | `RetentionSummarySchema`, `CohortRetentionSchema`, `GET /admin/pisocamp/analytics/retention`; the `churn_inactivity_days` setting |
| Backend | `RetentionService`, behind `reports.dashboards.view`; the config service now drives every setting off one declaration |
| Web | The Retention section of `/pisocamp/engagement`; the churn period on `/pisocamp/config` |

Qualifying activity is a **session on an Asia/Manila day** — what AN-2 already
materialises in `analytics_session`. Coming back is something people do on
days, not at instants, so days are the unit throughout.

## AC1 — D1, D7 and D30 retention per cohort

**PASS.** A cohort is everybody whose **first ever** activity fell on the same
day, not their first activity inside the range: counting a February user as new
in March would invent an acquisition that never happened. Asserted.

Day N retention is a return **on** day N, not on or after it. A fixture that
returns on days 2 and 8 reports 0% at D1 and D7 — asserted — because "came back
the next day" and "came back at some point" are different questions and only
the first is comparable between cohorts of different ages.

The worked cohort is three people: one back on D1, D7 and D30, one back on D1
only, one never back. D1 is 2 of 3 (66.67%), D7 and D30 are 1 of 3 (33.33%),
each computed by hand and asserted.

**A day that has not elapsed reports null, not zero.** A cohort formed
yesterday cannot have a 30-day figure, and 0% would report a failure it has not
had the chance to have. The screen prints "Not yet". Asserted.

Everything is bounded by the report end, so the same range answers the same way
tomorrow. A report whose figures drift as later data lands is not a report.
Asserted.

## AC2 — churn, re-engagement and reactivation at the configured period

**PASS.** `churn_inactivity_days` is a new administrator setting, default 30,
range 1–365, edited on the module configuration page and audited per key like
the settings beside it.

- **Churned**: quiet for **more than** the period, measured at the report end.
  The fixture has somebody exactly 30 days quiet at a 30-day setting who is
  *not* churned, and moving the setting to 60 drops the churn count to zero —
  both asserted, which is the setting doing its job rather than being decorative.
- **Re-engagement**: of the people who were quiet for at least a whole day but
  not yet churned at the range start, the share who came back during it.
  Somebody active the day before the range never went away and is in neither
  pool — asserted.
- **Reactivation**: of the people already churned at the range start, the share
  who came back.

The two are separated because "came back before we lost them" and "came back
after we lost them" are different outcomes with different causes.

An empty pool reports zero rather than dividing by nothing. Asserted.

The SRD text for these rates was not available in the repository; the
definitions above are stated in the schema, returned with the pools they were
computed from, and shown on screen as "N of M", so a reader can see exactly
what was divided by what and say if it is the wrong thing.

## AC3 — lifetime

**PASS.** Per person, last qualifying activity minus first, in whole days,
bounded by the report end. Activity after the report end belongs to a later
report — asserted with a session outside the range that does not extend the
lifetime.

Average and median are both reported. The fixture is 30, 10 and 0 days: the
average is 13.33 and the median is 10, by hand.

Nobody known reports **null**, not zero, and the screen says "No users yet":
"no users" and "every user lasted no time" are different facts.

## AC4 — 403 and an audit entry without `reports.dashboards.view`

**PASS.** Both branches on the retention handler itself, in
`analytics.authorization.spec.ts`: a holder passes, a registered user without
the permission is refused with 403 and exactly one `permission_denied` row
naming `AnalyticsController.retention`. The browser run adds the redirect for a
signed-in user without the permission.

## Browser validation

Against the local stack (backend :3000, web :3001):

- `an2-engagement.authenticated.spec.ts` — **9 passed**, including a new case
  for the Retention section: the heading, churn, reactivation and average
  lifetime figures, the "N of M quiet past N days" line, and the cohort table.
- `ev4-advisory-interval.authenticated.spec.ts` — **6 passed**, including a new
  case that saves the churn period, reloads, and finds it persisted.
- Console, page errors, failed requests and error responses asserted clean in
  every case. The backend log shows no error-level line from the retention
  area; the only 403s are the deliberate denials under test.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 22 files, 346 tests passed (+18) |
| backend jest `--runInBand` | 87 suites, 757 passed, 48 skipped (+16) |
| `web` vitest | 44 files, 397 passed (+8) |
| `packages/e2e-web` Playwright | 9 + 6 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

Flutter was not touched: the churn period is administrator configuration and
does not appear in the public configuration a device reads.

## Refactors this ticket made rather than copied

- **The admin config service** had one hand-written block per setting for
  reading, writing and auditing. A third setting would have been a third copy,
  so the settings are now declared once and the three operations are written
  over that list. A fourth setting is a line.
- **The module configuration form** had the same shape: one hand-written field,
  ref, validator and error per setting. It is now generated from one
  declaration, so every field keeps the same label, help text, focus-on-error
  and `aria-describedby` behaviour without three chances to get one wrong.

## Notes

- **No materialised view was added.** The ticket allows cohort tables or
  materialised views; `analytics_session` is already the materialisation, and a
  second one would need a refresh owner and a way to notice when it goes stale.
  The queries read the sessions directly.
- **The turbopack production build fails on this machine** with
  `failed to create junction point to ../../../../node_modules/require-in-the-middle`.
  It fails identically at `ed43844` with AN-4 stashed, so it predates this
  ticket; the browser validation used `next build --webpack`, which succeeds.
- Demographic cuts are AN-10, as the ticket says.
