# AN-10 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `49d58f3` (AN-7)
Ticket: AN-10 — Demographic and cohort reports with small-group suppression

## Result

All five AN-10 acceptance criteria are **PASS**.

## What AN-10 adds

| Layer | Surface |
| --- | --- |
| Contract | `DemographicsSummarySchema`, `DemographicDrilldownSchema` |
| Backend | `DemographicsService`; two endpoints on `AnalyticsController` |
| Web | `/pisocamp/demographics`, with the §4.2-M drill-down behind its own permission |

No new table and no new column: the cuts are read from F3's profiles, F4's
consent records, AN-1's device-account links and AN-2's derived sessions.

## AC1 — the distributions and the cuts

**PASS.** Age-group, gender, region and city distributions display, along with
DAU by gender, session duration by gender, day-7 retention by every dimension,
and churn by region and city.

**Age groups come from the configuration**, not from numbers written into the
query: an age of 20 lands in `18-24` and 65 in `60+` because SA-3's
`age_group_buckets` says so.

Churn uses the same configured `churn_inactivity_days` as AN-4, so the two
reports cannot disagree about who has gone quiet.

## AC2 — a group below the minimum is suppressed and marked

**PASS**, and the rule is applied to every distribution and every measure, not
only the headline ones.

**A suppressed group keeps its label and loses its figures.** "Fewer than the
minimum" is itself the finding; dropping the row would read as nobody at all,
which is a different and false claim. Asserted directly on both a distribution
and a measure.

**The floor is the configured `suppression_minimum`**, not a hard-coded ten —
asserted by setting it and watching a group cross the line. With nothing
configured it defaults to **10**, also asserted.

## AC3 — no consent, no demographic cut

**PASS.** Consent is the **join**, not a filter somebody has to remember: only a
profile whose account granted `demographic_analytics` reaches any cut.

- A profile that never granted it is excluded — asserted.
- A profile that has **withdrawn** it is excluded — asserted.
- When somebody changed their mind twice, the **most recent** answer decides —
  asserted with a withdrawal followed by a later grant.

The summary also reports how many profiles are **not** counted, so a reader can
see how much of the population the cuts leave out without any of those people
appearing in one. Their activity still counts towards the ordinary KPIs, which
are not demographic cuts.

## AC4 — the PII drill-down

**PASS**, and it is a **separate endpoint** rather than a field on the summary:
row-level data should be unreachable without `reports.pii.view`, and a field
that is sometimes present is a field that can be forgotten. Asserted directly —
the serialised summary contains no account id and no email address.

The drill-down requires **both** `reports.dashboards.view` and
`reports.pii.view`. `analytics.authorization.spec.ts` proves all three branches
against the real guard:

- A dashboard reader **without** `reports.pii.view` is refused **403**, with the
  audit naming `reports.pii.view` as the missing permission.
- A holder of both reaches the handler.
- The refusal is recorded, targeted at
  `handler` / `AnalyticsController.demographicDrilldown`.

**Every successful drill-down is audited** (`pisocamp` /
`demographics.pii_view`) with the actor, the bucket and how many rows were
returned. Reading who is in a group is a different act from reading how many
people are in it, and only one of them has to be answerable for later.

The drill-down is also **consent-scoped**: somebody who withheld consent is not
reachable by opening a bucket either — asserted.

## AC5 — permission, both ways

**PASS.** The cuts themselves are gated on `reports.dashboards.view` through the
shared `RbacGuard`; a registered user without it is refused 403 and exactly one
handler-targeted `permission_denied` audit is written.

## Browser validation

`an10-demographics.authenticated.spec.ts` — **6 passed**: the page names how
many profiles consented and how many did not, shows every dimension §4.2-I asks
for and each cut, refuses an inverted range, has no horizontal overflow at
320 px with 44 px date fields, and redirects a user without
`reports.dashboards.view`. Console, page errors, failed requests and 4xx/5xx
responses asserted empty.

## Test evidence

| Suite | Result |
| --- | --- |
| backend jest `--runInBand` | 107 suites, 940 passed, 48 skipped |
| `apps/web` vitest | 52 files, 473 passed |
| `packages/contracts` vitest | 23 files, 377 passed |
| `packages/e2e-web` Playwright | 6 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The API log carries no error-level line; every `/analytics/demographics`
request answered 200. The only non-2xx are the deliberate 403s from the
permission case and better-auth's own sign-in rate limit.

## Shared code reused, not duplicated

- The **range control** extracted for AN-7 is reused here rather than copied a
  third time.
- SA-3's configuration registry supplies the age buckets, the suppression floor
  and the churn period — one place for each number.
- `RbacGuard` for both permissions and `AuditService` for the drill-down record.
- AN-2's `analytics_session` rows are the activity behind every cut, so
  demographics and engagement cannot disagree about who was active.

## Notes

- The web page decides whether to offer the drill-down from the same
  permissions it is gated on, and the server refuses it regardless — the browser
  is where it is convenient, not where it is enforced.
- Every seeded browser persona that can read this page also holds
  `reports.pii.view`, so the "no drill-down offered" branch is proven in the
  component test and against the real guard in the backend suite.
