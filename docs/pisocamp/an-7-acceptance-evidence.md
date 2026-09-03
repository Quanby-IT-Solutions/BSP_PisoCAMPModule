# AN-7 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `5f980b0` (AN-6)
Ticket: AN-7 — Technical metrics: crash, load time, API, network failures, size/battery

## Result

All six AN-7 acceptance criteria are **PASS**.

## What AN-7 adds

| Layer | Surface |
| --- | --- |
| Schema | `crash_snapshot`, `api_endpoint_metric`, `performance_test_result`; two new catalog events |
| Contract | `TechnicalMetricsSummarySchema`, the §12 import and the performance-test entry |
| Backend | `TechnicalMetricsService`, `MonitoringImportService`, `MonitoringController` |
| Mobile | `module_load` and `network_failure` in the analytics SDK |
| Web | `/pisocamp/technical`, with AN-025's manual entry form |
| Docs | `docs/pisocamp/an-7-monitoring-interface.md`, the event catalog |

Migration `20260903040000_an7_technical_metrics`, applied to all four local
databases.

## Two sources, kept apart on purpose

Crashes and API traffic are **imported** from the monitoring tool: a process
that has died cannot report its own death, and a request that never arrived
leaves nothing in the API's own logs. Load times and network failures come from
the **device**, because only the device knows how long it waited and what it
could not reach. Mixing the two would produce figures nobody could source.

## AC1 — crash figures for the period

**PASS.** Crash count, users affected, sessions affected, crashes per session
and the crash-free session rate all display. Asserted against an import of 12
crashes over 1,000 sessions: 0.012 crashes per session and a 99% crash-free
rate.

**Nothing imported reads as nothing imported, not as nothing having crashed** —
`crashes` is null and the dashboard says so. Zero crashes and no data are
different claims, and only one of them is good news.

**A re-import replaces the period rather than adding to it.** A retried import
after a dropped connection cannot double a crash count. Asserted by importing
the same payload twice and reading 12, not 24.

**A period that only half overlaps the range is left out**: half a period's
crashes against a full period's sessions is not a rate.

## AC2 — load-time percentiles

**PASS**, from the module's own `module_load` events: p50, p95 and max, computed
in the database with `percentile_cont`. Asserted on ten known durations —
p50 550 ms, p95 3,155 ms, max 5,000 ms.

Cold and warm starts are counted apart, because a cold start pays for the
process as well as the module and one figure would hide which of them got
slower.

**No loads reads as null, not as 0 ms.** A zero-millisecond load is a claim the
module was instant.

## AC3 — API figures per endpoint

**PASS.** Request count, error count and rate, timeouts, auth failures and
latency p50/p95 display per endpoint, ordered by traffic.

Across several imported periods the **latency shown is the worst period, not an
average**: percentiles do not add, and averaging them would report a latency
nobody ever saw. Asserted with two periods whose p95s differ.

## AC4 — network failures by type

**PASS**, counted from `network_failure` events and reported by kind, with
**every kind listed including the ones nothing reported**: a missing row reads
as a failure that cannot happen. Asserted on a fixture of four failures across
three kinds.

`network_failure` is the one event in the catalog whose status is `failed`. It
exists because something did not work, so reporting it as a completion would be
a lie — the mobile decoder now checks the envelope's status against the event's
own declared status, and refuses a `network_failure` claiming to have completed.

## AC5 — the performance test run

**PASS.** App size, module size increase, downloaded asset size, local storage
and battery impact are recorded as an entry with the build, platform, device and
date, through a manual entry form on `/pisocamp/technical`.

Each row records **who entered it** and writes an audit entry
(`pisocamp` / `performance_test.record`): these figures come from a measured
build on real hardware, and a number nobody stands behind cannot be checked by
anybody later.

The form refuses an app size of zero and a battery impact above a full charge
before sending anything, and the database refuses the same through CHECK
constraints — the browser is where it is convenient, not where it is enforced.

## AC6 — permission, both ways

**PASS**, and the two sides are deliberately different permissions:

- **Reading** the dashboard is `reports.dashboards.view`, through the shared
  `RbacGuard`. `analytics.authorization.spec.ts` proves both branches for
  `AnalyticsController.technical`, including the single handler-targeted
  `permission_denied` audit.
- **Writing** — the §12 import and the performance-test entry — is
  `admin.integrations.manage`. `monitoring.authorization.spec.ts` proves both
  branches with a denied user who *does* hold `reports.dashboards.view`: being
  allowed to read a dashboard is no reason to be allowed to feed it.
  A session-less request is refused 401 with no audit, because there is nobody
  to attribute a denial to.

The web page hides the entry form from anybody without
`admin.integrations.manage`, decided on the server from the same permissions the
page itself is gated on.

## Browser validation

`an7-technical.authenticated.spec.ts` — **7 passed**: the page shows the crash,
load, API and network sections; every failure kind is listed including the quiet
ones; an inverted range is refused in the form; a run recorded through the form
appears in the table above it; the page has no horizontal overflow at 320 px and
its date fields are focusable at 44 px; and a user without
`reports.dashboards.view` is redirected away. Console, page errors, failed
requests and 4xx/5xx responses asserted empty throughout.

`an2-engagement.authenticated.spec.ts` — **11 passed** after the range control
was extracted and reused, so the older dashboards still behave identically.

## Test evidence

| Suite | Result |
| --- | --- |
| backend jest `--runInBand` | 106 suites, 928 passed, 48 skipped |
| `flutter test` | 705 passed, 1 skipped |
| `apps/web` vitest | 51 files, 467 passed |
| `packages/contracts` vitest | 23 files, 377 passed |
| `packages/e2e-web` Playwright | 7 + 11 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The API log carries no error-level line. Every `/analytics/technical` and
`/monitoring/performance-tests` request answered 200; the only non-2xx are the
deliberate 403s from the permission case and better-auth's own sign-in rate
limit, which the sign-in fixture retries.

One full backend run failed a single suite on an `afterAll` hook timeout
(`pisocamp-profile.service.spec.ts`, which creates and drops its own database);
it passes on its own and is a load-related flake, not an AN-7 regression.

## Shared code reused, not duplicated

- The **range control** on every analytics dashboard is now one component
  (`analytics-range-card.tsx`), used by both the engagement page and the new
  technical page. The validation, the labelling and the 44 px targets are the
  same requirement each time, and a second copy is a second place for them to
  drift.
- `RbacGuard` and `AuditService` for both permissions and both audit trails.
- The Manila-day range handling and rate helpers follow the sibling analytics
  services.
- The mobile SDK's existing envelope validation, forbidden-data defence and
  encrypted queue carry the two new events unchanged.

## Notes

- **Alerting stays out of scope**, as the ticket says: this reports health, it
  does not page anybody.
- The monitoring connector is an **import interface**, documented at
  `docs/pisocamp/an-7-monitoring-interface.md`. The module holds no credentials
  for the monitoring tool; whatever runs the export authenticates as a user with
  `admin.integrations.manage`. There is no live connection to Sentry from this
  environment, and inventing one would have been a fake.
- Every browser persona that can read the technical page also holds
  `admin.integrations.manage`, so the hidden-form branch is proven against the
  real guard in the backend suite rather than in the browser.
